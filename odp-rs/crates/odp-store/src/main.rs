//! ODP store writer — consume `odp.ingest.raw`, batch insert Postgres, publish `odp.record.committed`.

mod writer;

use std::time::Duration;

use anyhow::Context;
use odp_bus::redis_streams::BusConfig;
use odp_bus::RedisBus;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,odp_store=debug".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = std::env::var("ODP_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .context("ODP_DATABASE_URL or DATABASE_URL required")?;

    let batch_size: usize = std::env::var("ODP_STORE_BATCH_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(500);

    let pool = writer::connect_pool(&database_url).await?;
    writer::migrate(&pool).await?;

    let bus_cfg = BusConfig::from_env()?;
    let bus = RedisBus::connect(bus_cfg).await?;
    bus.ensure_consumer_group(&bus.config.streams.ingest_raw)
        .await?;

    tracing::info!(batch_size, "odp-store started");

    loop {
        let messages = bus.read_ingest_batch(batch_size, 2000).await?;
        if messages.is_empty() {
            continue;
        }

        let (inserted, ack_ids) = writer::persist_batch(&pool, &bus, &messages).await?;
        bus.ack_ingest(&ack_ids).await?;
        tracing::info!(
            read = messages.len(),
            inserted,
            acked = ack_ids.len(),
            "batch committed"
        );

        // Tight loop when backlog exists; back off when idle.
        if messages.len() < batch_size {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}