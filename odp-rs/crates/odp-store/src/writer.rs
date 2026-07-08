use anyhow::{Context, Result};
use odp_bus::redis_streams::StreamMessage;
use odp_bus::RedisBus;
use odp_contracts::{IngestMode, RecordEvent};
use sqlx::{Acquire, PgPool, Postgres, Transaction};
pub async fn connect_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPool::connect(database_url).await?;
    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS odp_records (
            id BIGSERIAL PRIMARY KEY,
            schema_version INT NOT NULL,
            provider TEXT NOT NULL,
            source_id UUID NOT NULL,
            event_id TEXT NOT NULL,
            ingest_mode TEXT NOT NULL,
            source_ts TIMESTAMPTZ NOT NULL,
            cursor TEXT,
            payload JSONB NOT NULL,
            raw_data JSONB,
            trace_id UUID,
            task_id UUID,
            committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_odp_source_event UNIQUE (source_id, event_id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_odp_records_source_ts
            ON odp_records (source_id, source_ts DESC)
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS odp_dlq (
            id BIGSERIAL PRIMARY KEY,
            stream_id TEXT NOT NULL,
            provider TEXT,
            source_id UUID,
            event_id TEXT,
            error TEXT NOT NULL,
            delivery_count INT NOT NULL,
            payload JSONB,
            failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Batch insert with one Postgres SAVEPOINT per message. A single bad event
/// (real DB error, not the dedup ON CONFLICT path) used to abort the whole
/// shared transaction — every later message in the same batch would then
/// fail the same way, get left unacked, and come right back on the next
/// read, retrying forever. The savepoint contains the damage to that one
/// message; everything else in the batch still commits.
pub async fn persist_batch(
    pool: &PgPool,
    bus: &RedisBus,
    messages: &[StreamMessage],
) -> Result<(usize, Vec<String>)> {
    let mut tx: Transaction<'_, Postgres> = pool.begin().await?;
    let mut inserted = 0usize;
    let mut ack_ids = Vec::with_capacity(messages.len());
    // Only published after `tx.commit()` below succeeds — publishing inline
    // (the old behaviour) could tell downstream consumers a record was
    // committed when the enclosing transaction had not landed yet (or never
    // would, if the process died first).
    let mut to_publish: Vec<(i64, RecordEvent)> = Vec::new();

    for msg in messages {
        if let Err(e) = msg.event.validate() {
            tracing::warn!(stream_id = %msg.id, error = %e, "skip invalid event");
            ack_ids.push(msg.id.clone());
            continue;
        }

        let mut savepoint = tx.begin().await?;
        match insert_one(&mut savepoint, &msg.event).await {
            Ok(Some(record_id)) => {
                savepoint.commit().await?;
                inserted += 1;
                ack_ids.push(msg.id.clone());
                to_publish.push((record_id, msg.event.clone()));
            }
            Ok(None) => {
                // duplicate — still ack so we do not poison the group
                savepoint.commit().await?;
                ack_ids.push(msg.id.clone());
            }
            Err(e) => {
                savepoint.rollback().await.ok();
                tracing::error!(stream_id = %msg.id, error = %e, "insert failed — will retry");
                // left unacked: the reap loop's XPENDING scan will retry it,
                // and eventually DLQ it once delivery_count crosses the cap.
            }
        }
    }

    tx.commit().await?;

    for (record_id, event) in to_publish {
        if let Err(e) = bus.publish_committed(&event, record_id).await {
            tracing::warn!(record_id, error = %e, "committed publish failed");
        }
    }

    Ok((inserted, ack_ids))
}

/// Move a poison message to the DLQ table. Called once its delivery count
/// crosses the reap loop's cap — nothing will ever XCLAIM it again after
/// this, so the caller must XACK the stream id right after.
pub async fn dead_letter(
    pool: &PgPool,
    msg: &StreamMessage,
    delivery_count: i64,
    error: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO odp_dlq (stream_id, provider, source_id, event_id, error, delivery_count, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(&msg.id)
    .bind(&msg.event.provider)
    .bind(msg.event.source_id)
    .bind(&msg.event.event_id)
    .bind(error)
    .bind(delivery_count as i32)
    .bind(&msg.event.payload)
    .execute(pool)
    .await
    .context("insert odp_dlq")?;
    Ok(())
}

/// Move a poison message to the DLQ table when its stream entry exists but
/// could not be parsed into a `RecordEvent` at all (invalid JSON, or a
/// missing/garbled `event` field) — so there is no `RecordEvent` to hand to
/// `dead_letter`. `provider`/`source_id`/`event_id` are NULL since none of
/// that could be extracted; `payload` stores the raw string wrapped so the
/// column stays valid jsonb regardless of what the raw bytes look like.
/// Same caller contract as `dead_letter`: only XACK the stream id after this
/// returns `Ok`.
pub async fn dead_letter_raw(
    pool: &PgPool,
    stream_id: &str,
    raw_payload: &str,
    delivery_count: i64,
    error: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO odp_dlq (stream_id, provider, source_id, event_id, error, delivery_count, payload)
        VALUES ($1, NULL, NULL, NULL, $2, $3, to_jsonb($4::text))
        "#,
    )
    .bind(stream_id)
    .bind(error)
    .bind(delivery_count as i32)
    .bind(raw_payload)
    .execute(pool)
    .await
    .context("insert odp_dlq (raw/unparseable)")?;
    Ok(())
}

async fn insert_one(
    tx: &mut Transaction<'_, Postgres>,
    event: &RecordEvent,
) -> Result<Option<i64>> {
    let ingest_mode = match event.ingest_mode {
        IngestMode::Snapshot => "snapshot",
        IngestMode::Stream => "stream",
    };
    let raw_data = if event.raw_data.is_null() {
        None
    } else {
        Some(event.raw_data.clone())
    };

    let row: Option<(i64,)> = sqlx::query_as(
        r#"
        INSERT INTO odp_records (
            schema_version, provider, source_id, event_id, ingest_mode,
            source_ts, cursor, payload, raw_data, trace_id, task_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (source_id, event_id) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(event.schema_version as i32)
    .bind(&event.provider)
    .bind(event.source_id)
    .bind(&event.event_id)
    .bind(ingest_mode)
    .bind(event.source_ts)
    .bind(&event.cursor)
    .bind(&event.payload)
    .bind(raw_data)
    .bind(event.trace_id)
    .bind(event.task_id)
    .fetch_optional(&mut **tx)
    .await
    .context("insert odp_records")?;

    Ok(row.map(|r| r.0))
}