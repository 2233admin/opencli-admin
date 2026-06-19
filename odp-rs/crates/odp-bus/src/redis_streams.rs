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

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::BulkString(bytes) => String::from_utf8(bytes.clone()).ok(),
        Value::SimpleString(s) => Some(s.clone()),
        Value::Okay => Some("OK".into()),
        Value::Int(i) => Some(i.to_string()),
        _ => None,
    }
}