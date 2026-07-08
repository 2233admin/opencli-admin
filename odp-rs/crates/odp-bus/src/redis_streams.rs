use anyhow::{Context, Result};
use odp_contracts::RecordEvent;
use redis::aio::ConnectionManager;
use redis::{AsyncCommands, RedisResult, Value};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct StreamNames {
    pub ingest_raw: String,
    pub record_committed: String,
}

impl Default for StreamNames {
    fn default() -> Self {
        Self {
            ingest_raw: "odp.ingest.raw".into(),
            record_committed: "odp.record.committed".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct BusConfig {
    pub redis_url: String,
    pub streams: StreamNames,
    pub consumer_group: String,
    pub consumer_name: String,
}

impl BusConfig {
    pub fn from_env() -> Result<Self> {
        let redis_url = std::env::var("ODP_REDIS_URL")
            .or_else(|_| std::env::var("REDIS_URL"))
            .context("ODP_REDIS_URL or REDIS_URL required")?;
        Ok(Self {
            redis_url,
            streams: StreamNames::default(),
            consumer_group: std::env::var("ODP_BUS_GROUP").unwrap_or_else(|_| "odp-store".into()),
            consumer_name: std::env::var("ODP_BUS_CONSUMER").unwrap_or_else(|_| {
                format!("{}-{}", hostname(), std::process::id())
            }),
        })
    }
}

fn hostname() -> String {
    std::env::var("HOSTNAME").unwrap_or_else(|_| "odp".into())
}

#[derive(Clone)]
pub struct RedisBus {
    conn: ConnectionManager,
    pub config: BusConfig,
}

impl RedisBus {
    pub async fn connect(config: BusConfig) -> Result<Self> {
        let client = redis::Client::open(config.redis_url.as_str())?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self { conn, config })
    }

    pub async fn ensure_consumer_group(&self, stream: &str) -> Result<()> {
        let mut conn = self.conn.clone();
        let group = &self.config.consumer_group;
        let created: RedisResult<Value> = redis::cmd("XGROUP")
            .arg("CREATE")
            .arg(stream)
            .arg(group)
            .arg("$")
            .arg("MKSTREAM")
            .query_async(&mut conn)
            .await;
        match created {
            Ok(_) => Ok(()),
            Err(e) if e.to_string().contains("BUSYGROUP") => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn publish_ingest(&self, event: &RecordEvent) -> Result<String> {
        let payload = serde_json::to_string(event)?;
        let mut conn = self.conn.clone();
        let id: String = conn
            .xadd(
                &self.config.streams.ingest_raw,
                "*",
                &[("event", payload.as_str())],
            )
            .await?;
        Ok(id)
    }

    pub async fn publish_committed(&self, event: &RecordEvent, record_id: i64) -> Result<String> {
        let body = CommittedMessage {
            record_id,
            event: event.clone(),
        };
        let payload = serde_json::to_string(&body)?;
        let mut conn = self.conn.clone();
        let id: String = conn
            .xadd(
                &self.config.streams.record_committed,
                "*",
                &[("committed", payload.as_str())],
            )
            .await?;
        Ok(id)
    }

    /// Read up to `count` pending messages for the consumer group.
    pub async fn read_ingest_batch(&self, count: usize, block_ms: u64) -> Result<Vec<StreamMessage>> {
        let mut conn = self.conn.clone();
        let stream = &self.config.streams.ingest_raw;
        let group = &self.config.consumer_group;
        let consumer = &self.config.consumer_name;

        let reply: RedisResult<Value> = redis::cmd("XREADGROUP")
            .arg("GROUP")
            .arg(group)
            .arg(consumer)
            .arg("COUNT")
            .arg(count)
            .arg("BLOCK")
            .arg(block_ms)
            .arg("STREAMS")
            .arg(stream)
            .arg(">")
            .query_async(&mut conn)
            .await;

        parse_xreadgroup(reply, stream)
    }

    pub async fn ack_ingest(&self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.clone();
        let stream = &self.config.streams.ingest_raw;
        let group = &self.config.consumer_group;
        let _: i64 = redis::cmd("XACK")
            .arg(stream)
            .arg(group)
            .arg(ids)
            .query_async(&mut conn)
            .await?;
        Ok(())
    }

    /// Pending entries idle at least `min_idle_ms`, with their delivery counts.
    /// A crashed/restarted consumer leaves its deliveries stuck here forever
    /// unless something reclaims them — this is that "something"'s data source.
    pub async fn pending_summary(&self, min_idle_ms: u64, count: usize) -> Result<Vec<PendingSummary>> {
        let mut conn = self.conn.clone();
        let stream = &self.config.streams.ingest_raw;
        let group = &self.config.consumer_group;

        let reply: RedisResult<Value> = redis::cmd("XPENDING")
            .arg(stream)
            .arg(group)
            .arg("IDLE")
            .arg(min_idle_ms)
            .arg("-")
            .arg("+")
            .arg(count)
            .query_async(&mut conn)
            .await;

        parse_xpending(reply)
    }

    /// Reassign `ids` to this consumer (resetting their idle timer and
    /// bumping delivery count) and return their current field data.
    pub async fn claim(&self, min_idle_ms: u64, ids: &[String]) -> Result<Vec<StreamMessage>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut conn = self.conn.clone();
        let stream = &self.config.streams.ingest_raw;
        let group = &self.config.consumer_group;
        let consumer = &self.config.consumer_name;

        let reply: RedisResult<Value> = redis::cmd("XCLAIM")
            .arg(stream)
            .arg(group)
            .arg(consumer)
            .arg(min_idle_ms)
            .arg(ids)
            .query_async(&mut conn)
            .await;

        parse_entry_array(reply)
    }

    /// Read entries by id straight off the stream — does not touch the PEL,
    /// consumer ownership, or delivery count. Used to pull the payload of
    /// entries that are past the DLQ threshold and must not be claimed again.
    pub async fn read_entries_by_id(&self, ids: &[String]) -> Result<Vec<StreamMessage>> {
        let stream = &self.config.streams.ingest_raw;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let mut conn = self.conn.clone();
            let reply: RedisResult<Value> = redis::cmd("XRANGE")
                .arg(stream)
                .arg(id)
                .arg(id)
                .query_async(&mut conn)
                .await;
            out.extend(parse_entry_array(reply)?);
        }
        Ok(out)
    }

    /// Read entries by id as raw field maps, WITHOUT parsing the `event` field
    /// as a `RecordEvent`. This is what lets a caller tell "present but the
    /// stored JSON doesn't deserialize" apart from "genuinely absent (already
    /// trimmed)" — `read_entries_by_id` silently drops the former, so it alone
    /// cannot distinguish the two cases. Absent ids simply do not appear in
    /// the result; this method never errors just because a payload is not
    /// valid JSON.
    pub async fn read_raw_entries_by_id(&self, ids: &[String]) -> Result<Vec<RawStreamEntry>> {
        let stream = &self.config.streams.ingest_raw;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            let mut conn = self.conn.clone();
            let reply: RedisResult<Value> = redis::cmd("XRANGE")
                .arg(stream)
                .arg(id)
                .arg(id)
                .query_async(&mut conn)
                .await;
            out.extend(parse_raw_entry_array(reply)?);
        }
        Ok(out)
    }
}

#[derive(Debug, Clone)]
pub struct PendingSummary {
    pub id: String,
    pub delivery_count: i64,
}

fn parse_xpending(reply: RedisResult<Value>) -> Result<Vec<PendingSummary>> {
    let value = match reply {
        Ok(v) => v,
        Err(e) if e.kind() == redis::ErrorKind::TypeError => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let entries = match value {
        Value::Nil => return Ok(vec![]),
        Value::Array(entries) => entries,
        other => anyhow::bail!("unexpected XPENDING reply: {other:?}"),
    };

    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let parts = match entry {
            Value::Array(p) if p.len() == 4 => p,
            _ => continue,
        };
        let Some(id) = value_as_string(&parts[0]) else { continue };
        let delivery_count = match &parts[3] {
            Value::Int(n) => *n,
            other => value_as_string(other).and_then(|s| s.parse().ok()).unwrap_or(0),
        };
        out.push(PendingSummary { id, delivery_count });
    }
    Ok(out)
}

fn parse_entry_array(reply: RedisResult<Value>) -> Result<Vec<StreamMessage>> {
    let value = match reply {
        Ok(v) => v,
        Err(e) if e.kind() == redis::ErrorKind::TypeError => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let entries = match value {
        Value::Nil => return Ok(vec![]),
        Value::Array(entries) => entries,
        other => anyhow::bail!("unexpected reply: {other:?}"),
    };
    Ok(entries.into_iter().filter_map(|e| parse_stream_entry(&e)).collect())
}

/// Same XRANGE/XCLAIM reply shape as `parse_entry_array`, but keeps the raw
/// `event` field string instead of deserializing it — an entry is included
/// here as long as it exists and has an `event` field, regardless of whether
/// that field is valid JSON.
fn parse_raw_entry_array(reply: RedisResult<Value>) -> Result<Vec<RawStreamEntry>> {
    let value = match reply {
        Ok(v) => v,
        Err(e) if e.kind() == redis::ErrorKind::TypeError => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let entries = match value {
        Value::Nil => return Ok(vec![]),
        Value::Array(entries) => entries,
        other => anyhow::bail!("unexpected reply: {other:?}"),
    };
    Ok(entries
        .into_iter()
        .filter_map(|e| parse_raw_stream_entry(&e))
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommittedMessage {
    pub record_id: i64,
    pub event: RecordEvent,
}

#[derive(Debug, Clone)]
pub struct StreamMessage {
    pub id: String,
    pub event: RecordEvent,
}

/// A stream entry's raw payload, read without attempting `RecordEvent`
/// deserialization — the `payload` field is whatever raw string was stored
/// under the `event` field key by `publish_ingest`, valid JSON or not.
#[derive(Debug, Clone)]
pub struct RawStreamEntry {
    pub id: String,
    pub payload: String,
}

fn parse_xreadgroup(reply: RedisResult<Value>, stream: &str) -> Result<Vec<StreamMessage>> {
    let value = match reply {
        Ok(v) => v,
        Err(e) if e.kind() == redis::ErrorKind::TypeError => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };

    let entries = match value {
        Value::Nil => return Ok(vec![]),
        Value::Array(streams) => streams,
        other => anyhow::bail!("unexpected XREADGROUP reply: {other:?}"),
    };

    let mut out = Vec::new();
    for stream_block in entries {
        let (name, messages) = match stream_block {
            Value::Array(parts) if parts.len() == 2 => {
                let name = value_as_string(&parts[0]).unwrap_or_default();
                let msgs = match &parts[1] {
                    Value::Array(m) => m.clone(),
                    _ => vec![],
                };
                (name, msgs)
            }
            _ => continue,
        };
        if name != stream {
            continue;
        }
        for msg in messages {
            if let Some(parsed) = parse_stream_entry(&msg) {
                out.push(parsed);
            }
        }
    }
    Ok(out)
}

fn parse_stream_entry(value: &Value) -> Option<StreamMessage> {
    let parts = match value {
        Value::Array(p) if p.len() == 2 => p,
        _ => return None,
    };
    let id = value_as_string(&parts[0])?;
    let fields = match &parts[1] {
        Value::Array(f) => f,
        _ => return None,
    };
    let mut event_json = None;
    let mut i = 0;
    while i + 1 < fields.len() {
        let key = value_as_string(&fields[i])?;
        let val = value_as_string(&fields[i + 1])?;
        if key == "event" {
            event_json = Some(val);
        }
        i += 2;
    }
    let json = event_json?;
    let event: RecordEvent = serde_json::from_str(&json).ok()?;
    Some(StreamMessage { id, event })
}

/// Like `parse_stream_entry`, but returns the raw `event` field string as-is
/// — no `serde_json::from_str` — so a present-but-malformed payload is still
/// returned instead of silently becoming `None`.
fn parse_raw_stream_entry(value: &Value) -> Option<RawStreamEntry> {
    let parts = match value {
        Value::Array(p) if p.len() == 2 => p,
        _ => return None,
    };
    let id = value_as_string(&parts[0])?;
    let fields = match &parts[1] {
        Value::Array(f) => f,
        _ => return None,
    };
    let mut payload = None;
    let mut i = 0;
    while i + 1 < fields.len() {
        let key = value_as_string(&fields[i])?;
        let val = value_as_string(&fields[i + 1])?;
        if key == "event" {
            payload = Some(val);
        }
        i += 2;
    }
    Some(RawStreamEntry { id, payload: payload? })
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::BulkString(bytes) => String::from_utf8(bytes.clone()).ok(),
        Value::SimpleString(s) => Some(s.clone()),
        Value::Okay => Some("OK".into()),
        Value::Int(i) => Some(i.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bulk(s: &str) -> Value {
        Value::BulkString(s.as_bytes().to_vec())
    }

    fn sample_event_json() -> String {
        r#"{"schema_version":1,"provider":"rss/feed","source_id":"550e8400-e29b-41d4-a716-446655440000","event_id":"e1","ingest_mode":"stream","source_ts":"2026-06-18T12:00:00Z","payload":{"title":"t"}}"#.to_string()
    }

    #[test]
    fn parse_xpending_extracts_id_and_delivery_count() {
        // XPENDING ... IDLE ... reply shape: [[id, consumer, idle_ms, delivery_count], ...]
        let reply: RedisResult<Value> = Ok(Value::Array(vec![
            Value::Array(vec![
                bulk("1700000000000-0"),
                bulk("consumer-a"),
                Value::Int(45_000),
                Value::Int(2),
            ]),
            Value::Array(vec![
                bulk("1700000000001-0"),
                bulk("consumer-b"),
                Value::Int(60_000),
                Value::Int(7),
            ]),
        ]));

        let out = parse_xpending(reply).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id, "1700000000000-0");
        assert_eq!(out[0].delivery_count, 2);
        assert_eq!(out[1].id, "1700000000001-0");
        assert_eq!(out[1].delivery_count, 7);
    }

    #[test]
    fn parse_xpending_empty_reply_is_empty_vec() {
        let reply: RedisResult<Value> = Ok(Value::Nil);
        assert!(parse_xpending(reply).unwrap().is_empty());

        let reply: RedisResult<Value> = Ok(Value::Array(vec![]));
        assert!(parse_xpending(reply).unwrap().is_empty());
    }

    #[test]
    fn parse_xpending_skips_malformed_entries_without_failing() {
        let reply: RedisResult<Value> = Ok(Value::Array(vec![
            Value::Array(vec![bulk("bad-shape")]), // wrong arity, must be skipped not error
            Value::Array(vec![
                bulk("1700000000002-0"),
                bulk("consumer-a"),
                Value::Int(30_000),
                Value::Int(1),
            ]),
        ]));
        let out = parse_xpending(reply).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "1700000000002-0");
    }

    #[test]
    fn parse_entry_array_decodes_xclaim_and_xrange_shaped_replies() {
        // XCLAIM/XRANGE reply shape: [[id, [field, value, ...]], ...] — same
        // wire shape XREADGROUP uses per-stream, minus the outer stream-name
        // wrapper, so this reuses parse_stream_entry.
        let json = sample_event_json();
        let reply: RedisResult<Value> = Ok(Value::Array(vec![Value::Array(vec![
            bulk("1700000000000-0"),
            Value::Array(vec![bulk("event"), bulk(&json)]),
        ])]));

        let out = parse_entry_array(reply).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "1700000000000-0");
        assert_eq!(out[0].event.event_id, "e1");
        assert_eq!(out[0].event.provider, "rss/feed");
    }

    #[test]
    fn parse_entry_array_empty_reply_is_empty_vec() {
        let reply: RedisResult<Value> = Ok(Value::Nil);
        assert!(parse_entry_array(reply).unwrap().is_empty());
    }

    #[test]
    fn parse_raw_entry_array_returns_payload_even_when_json_is_invalid() {
        // The key property under test: an entry whose `event` field is
        // present but is NOT valid JSON must still come back from the raw
        // parser (unlike parse_entry_array/parse_stream_entry, which would
        // silently drop it via serde .ok()?).
        let reply: RedisResult<Value> = Ok(Value::Array(vec![Value::Array(vec![
            bulk("1700000000000-0"),
            Value::Array(vec![bulk("event"), bulk("{not valid json")]),
        ])]));

        let out = parse_raw_entry_array(reply).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "1700000000000-0");
        assert_eq!(out[0].payload, "{not valid json");
    }

    #[test]
    fn parse_raw_entry_array_returns_payload_for_valid_json_too() {
        let json = sample_event_json();
        let reply: RedisResult<Value> = Ok(Value::Array(vec![Value::Array(vec![
            bulk("1700000000001-0"),
            Value::Array(vec![bulk("event"), bulk(&json)]),
        ])]));

        let out = parse_raw_entry_array(reply).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "1700000000001-0");
        assert_eq!(out[0].payload, json);
    }

    #[test]
    fn parse_raw_entry_array_truly_missing_id_is_absent() {
        // A truly-missing id means Redis returns an empty array for that
        // XRANGE call (nothing between id and id) — nothing to include.
        let reply: RedisResult<Value> = Ok(Value::Array(vec![]));
        assert!(parse_raw_entry_array(reply).unwrap().is_empty());

        let reply: RedisResult<Value> = Ok(Value::Nil);
        assert!(parse_raw_entry_array(reply).unwrap().is_empty());
    }

    #[test]
    fn parse_raw_entry_array_skips_entries_without_an_event_field() {
        let reply: RedisResult<Value> = Ok(Value::Array(vec![Value::Array(vec![
            bulk("1700000000002-0"),
            Value::Array(vec![bulk("other_field"), bulk("value")]),
        ])]));
        assert!(parse_raw_entry_array(reply).unwrap().is_empty());
    }
}