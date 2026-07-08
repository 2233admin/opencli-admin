//! ODP ingest service — enterprise hot path entry.
//!
//! Phase 0: validate + in-memory dedup + 202 accept (bus/store wired in Phase 1).

mod dedup;
mod handlers;
mod state;

use std::net::SocketAddr;

use axum::{routing::get, routing::post, Router};
use state::AppState;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,odp_ingest=debug".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let state = AppState::from_env().await?;
    if state.bus.is_none() {
        // Without a bus, every "accepted" ingest event vanishes: the dedup
        // index is in-memory only and nothing durable ever receives the
        // event. That is a silent black hole — refuse to start rather than
        // serve 202s that lie about persistence. ODP_INGEST_ALLOW_NO_BUS=1 is
        // the explicit, deliberate opt-in for an in-memory dev/test mode;
        // even then, handlers::process_events additionally refuses to count
        // no-bus events as accepted (defense in depth — see handlers.rs).
        let allow_no_bus = std::env::var("ODP_INGEST_ALLOW_NO_BUS")
            .map(|v| v == "1")
            .unwrap_or(false);
        if !allow_no_bus {
            anyhow::bail!(
                "odp-ingest refusing to start with no Redis bus configured (ODP_REDIS_URL/REDIS_URL unset or unreachable) — \
                 every ingested event would be silently lost. Set ODP_INGEST_ALLOW_NO_BUS=1 to run in explicit no-bus dev/test mode."
            );
        }
        tracing::warn!(
            "ODP_INGEST_ALLOW_NO_BUS=1 set — starting with NO bus. All events will be rejected as unpersisted (see handlers::process_events); this is a deliberate dev/test-only mode."
        );
    }
    let app = Router::new()
        .route("/health", get(handlers::health))
        .route("/v1/ingest/batch", post(handlers::ingest_batch))
        .route("/v1/ingest/events", post(handlers::ingest_ndjson))
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    let host = std::env::var("ODP_INGEST_HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("ODP_INGEST_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8040);
    let addr: SocketAddr = format!("{host}:{port}").parse()?;

    tracing::info!(%addr, "odp-ingest starting");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}