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