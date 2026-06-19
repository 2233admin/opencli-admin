use std::sync::Arc;

use odp_bus::RedisBus;
use tokio::sync::RwLock;

use crate::dedup::DedupIndex;

#[derive(Clone)]
pub struct AppState {
    pub dedup: Arc<RwLock<DedupIndex>>,
    pub bus: Option<RedisBus>,
}

impl AppState {
    pub async fn from_env() -> anyhow::Result<Self> {
        let bus = match odp_bus::redis_streams::BusConfig::from_env() {
            Ok(cfg) => {
                let bus = RedisBus::connect(cfg).await?;
                bus.ensure_consumer_group(&bus.config.streams.ingest_raw)
                    .await?;
                tracing::info!("odp-ingest connected to Redis bus");
                Some(bus)
            }
            Err(_) => {
                tracing::warn!("ODP_REDIS_URL unset — ingest accepts in-memory only (no bus)");
                None
            }
        };
        Ok(Self {
            dedup: Arc::new(RwLock::new(DedupIndex::new())),
            bus,
        })
    }
}