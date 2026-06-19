use anyhow::{Context, Result};
use odp_bus::redis_streams::StreamMessage;
use odp_bus::RedisBus;
use odp_contracts::{IngestMode, RecordEvent};
use sqlx::{PgPool, Postgres, Transaction};
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
        );
        CREATE INDEX IF NOT EXISTS idx_odp_records_source_ts
            ON odp_records (source_id, source_ts DESC);
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn persist_batch(
    pool: &PgPool,
    bus: &RedisBus,
    messages: &[StreamMessage],
) -> Result<(usize, Vec<String>)> {
    let mut tx: Transaction<'_, Postgres> = pool.begin().await?;
    let mut inserted = 0usize;
    let mut ack_ids = Vec::with_capacity(messages.len());

    for msg in messages {
        if let Err(e) = msg.event.validate() {
            tracing::warn!(stream_id = %msg.id, error = %e, "skip invalid event");
            ack_ids.push(msg.id.clone());
            continue;
        }

        match insert_one(&mut tx, &msg.event).await {
            Ok(Some(record_id)) => {
                inserted += 1;
                ack_ids.push(msg.id.clone());
                if let Err(e) = bus.publish_committed(&msg.event, record_id).await {
                    tracing::warn!(record_id, error = %e, "committed publish failed");
                }
            }
            Ok(None) => {
                // duplicate — still ack so we do not poison the group
                ack_ids.push(msg.id.clone());
            }
            Err(e) => {
                tracing::error!(stream_id = %msg.id, error = %e, "insert failed — will retry");
            }
        }
    }

    tx.commit().await?;
    Ok((inserted, ack_ids))
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