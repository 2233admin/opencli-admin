//! Stale-consumer recovery + DLQ.
//!
//! `persist_batch` only ever sees messages a live consumer just pulled via
//! XREADGROUP. If a consumer dies between delivery and XACK (crash, OOM kill,
//! deploy), those messages sit in its PEL entry forever — nobody else is
//! looking for them. This sweep is that "somebody else": it lists pending
//! entries idle past a threshold, retries the ones still worth retrying, and
//! DLQs the ones that have failed too many times to keep cycling.

use anyhow::Result;
use odp_bus::RedisBus;
use sqlx::PgPool;

use crate::writer;

/// A message that has failed this many delivery attempts is treated as
/// poison, not transient — it goes to `odp_dlq` instead of being retried
/// again. Chosen to tolerate a couple of consumer crashes mid-processing
/// without giving genuinely-broken events an unbounded retry budget.
const MAX_DELIVERIES: i64 = 5;

/// Only reclaim entries idle at least this long. Must comfortably exceed one
/// full `persist_batch` cycle for a full-size batch, or a live consumer's own
/// in-flight work would get claimed out from under it.
const STALE_IDLE_MS: u64 = 30_000;

const REAP_SCAN_LIMIT: usize = 500;

pub async fn reap_stale(bus: &RedisBus, pool: &PgPool) -> Result<()> {
    let pending = bus.pending_summary(STALE_IDLE_MS, REAP_SCAN_LIMIT).await?;
    if pending.is_empty() {
        return Ok(());
    }

    let mut dlq_ids = Vec::new();
    let mut retry_ids = Vec::new();
    for p in &pending {
        if p.delivery_count > MAX_DELIVERIES {
            dlq_ids.push(p.id.clone());
        } else {
            retry_ids.push(p.id.clone());
        }
    }

    if !dlq_ids.is_empty() {
        // XRANGE, not XCLAIM: these ids must not re-enter anyone's PEL —
        // reading by id leaves ownership and delivery count untouched.
        //
        // Every dlq_id falls into exactly one of three buckets, and only one
        // of them may be acked without writing a DLQ row first:
        //
        //   1. PARSEABLE — present in the stream AND its `event` field
        //      deserializes into a RecordEvent. Goes through `dead_letter`
        //      (structured columns). Ack only if that write succeeds.
        //   2. PRESENT-BUT-UNPARSEABLE — present in the stream, but the
        //      `event` field is not valid JSON (or the entry is otherwise
        //      malformed). This is genuine data: dropping it silently would
        //      be permanent, invisible data loss. Goes through
        //      `dead_letter_raw` (raw payload, NULL structured columns). Ack
        //      only if THAT write succeeds.
        //   3. GENUINELY ABSENT — no stream entry at all (already trimmed
        //      away by Redis, e.g. MAXLEN). Nothing left to dead-letter —
        //      this is the ONLY bucket that may be acked without a DLQ row,
        //      because there is nothing left to lose.
        //
        // A failed dead_letter / dead_letter_raw write must NEVER be acked,
        // or the event's payload (structured or raw) is lost for good —
        // evicted from the PEL with no odp_dlq row to show for it.
        let parsed_entries = bus.read_entries_by_id(&dlq_ids).await?;
        let raw_entries = bus.read_raw_entries_by_id(&dlq_ids).await?;

        let parsed_ids: std::collections::HashSet<&str> =
            parsed_entries.iter().map(|m| m.id.as_str()).collect();
        let raw_by_id: std::collections::HashMap<&str, &str> = raw_entries
            .iter()
            .map(|r| (r.id.as_str(), r.payload.as_str()))
            .collect();

        // Bucket 3: absent from both the parsed AND the raw read.
        let mut ack_ids: Vec<String> = dlq_ids
            .iter()
            .filter(|id| !parsed_ids.contains(id.as_str()) && !raw_by_id.contains_key(id.as_str()))
            .cloned()
            .collect();

        // Bucket 1: parseable — structured dead_letter.
        for msg in &parsed_entries {
            let delivery_count = pending
                .iter()
                .find(|p| p.id == msg.id)
                .map(|p| p.delivery_count)
                .unwrap_or(MAX_DELIVERIES + 1);
            match writer::dead_letter(
                pool,
                msg,
                delivery_count,
                "exceeded max delivery attempts (odp-store reap sweep)",
            )
            .await
            {
                Ok(()) => ack_ids.push(msg.id.clone()),
                Err(e) => {
                    tracing::error!(stream_id = %msg.id, error = %e, "failed to write DLQ row — leaving pending, will retry next sweep");
                }
            }
        }

        // Bucket 2: present but unparseable — raw dead_letter, never dropped.
        for (id, payload) in raw_by_id.iter() {
            if parsed_ids.contains(id) {
                continue; // already handled as bucket 1
            }
            let delivery_count = pending
                .iter()
                .find(|p| p.id == *id)
                .map(|p| p.delivery_count)
                .unwrap_or(MAX_DELIVERIES + 1);
            match writer::dead_letter_raw(
                pool,
                id,
                payload,
                delivery_count,
                "unparseable event payload — exceeded max delivery attempts (odp-store reap sweep)",
            )
            .await
            {
                Ok(()) => ack_ids.push((*id).to_string()),
                Err(e) => {
                    tracing::error!(stream_id = %id, error = %e, "failed to write raw DLQ row for unparseable event — leaving pending, will retry next sweep");
                }
            }
        }

        if !ack_ids.is_empty() {
            bus.ack_ingest(&ack_ids).await?;
            tracing::warn!(count = ack_ids.len(), "moved stale messages to DLQ");
        }
    }

    if !retry_ids.is_empty() {
        let claimed = bus.claim(STALE_IDLE_MS, &retry_ids).await?;
        if !claimed.is_empty() {
            let (inserted, ack_ids) = writer::persist_batch(pool, bus, &claimed).await?;
            bus.ack_ingest(&ack_ids).await?;
            tracing::info!(
                claimed = claimed.len(),
                inserted,
                acked = ack_ids.len(),
                "reclaimed stale messages from a dead/slow consumer"
            );
        }
    }

    Ok(())
}
