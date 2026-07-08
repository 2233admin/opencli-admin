//! ODP store writer — consume `odp.ingest.raw`, batch insert Postgres, publish `odp.record.committed`.

mod reap;
mod writer;

use std::time::{Duration, Instant};

use anyhow::Context;
use odp_bus::redis_streams::BusConfig;
use odp_bus::RedisBus;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// How often the reap sweep (stale-consumer recovery + DLQ) runs. It's a
/// cheap XPENDING call when there's nothing stale, so this can be frequent
/// without meaningfully loading Redis.
const REAP_INTERVAL: Duration = Duration::from_secs(15);

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

    let mut last_reap = Instant::now();

    loop {
        if last_reap.elapsed() >= REAP_INTERVAL {
            if let Err(e) = reap::reap_stale(&bus, &pool).await {
                tracing::error!(error = %e, "reap sweep failed — will retry next interval");
            }
            last_reap = Instant::now();
        }

        // Steady-state loop body: a transient Redis/PG error here must not
        // crash the whole process (that would drop every consumer/PEL entry
        // this instance owns and require an external restart). Log and
        // `continue` — the same message stays pending and gets retried on
        // the next iteration (or eventually reaped by reap_stale), matching
        // reap.rs's existing log-and-continue idiom. Only genuinely
        // unrecoverable startup errors above (connect_pool, migrate, connect
        // bus, ensure_consumer_group) stay fatal `?`.
        let messages = match bus.read_ingest_batch(batch_size, 2000).await {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(error = %e, "read_ingest_batch failed — will retry next iteration");
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        if messages.is_empty() {
            continue;
        }

        let (inserted, ack_ids) = match writer::persist_batch(&pool, &bus, &messages).await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(error = %e, "persist_batch failed — messages remain pending, will retry next iteration");
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
        };
        if let Err(e) = bus.ack_ingest(&ack_ids).await {
            tracing::error!(error = %e, "ack_ingest failed — inserted rows are durable, ack will be retried (dup-safe via ON CONFLICT) next sweep");
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        }
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