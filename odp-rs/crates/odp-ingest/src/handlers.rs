use axum::{
    body::Bytes,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use odp_contracts::{IngestBatchRequest, IngestBatchResponse, IngestReject, RecordEvent};
use serde_json::json;

use crate::state::AppState;

pub async fn health() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "service": "odp-ingest",
        "schema_version": odp_contracts::SCHEMA_VERSION
    }))
}

pub async fn ingest_batch(
    State(state): State<AppState>,
    Json(body): Json<IngestBatchRequest>,
) -> impl IntoResponse {
    let result = process_events(&state, body.events).await;
    (StatusCode::ACCEPTED, Json(result))
}

/// NDJSON: one RecordEvent per line (high-throughput clients).
pub async fn ingest_ndjson(
    State(state): State<AppState>,
    body: Bytes,
) -> impl IntoResponse {
    let mut events = Vec::new();
    let text = String::from_utf8_lossy(&body);
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<RecordEvent>(line) {
            Ok(ev) => events.push(ev),
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(IngestBatchResponse {
                        accepted: 0,
                        duplicates: 0,
                        rejected: 1,
                        errors: vec![IngestReject {
                            index: i,
                            event_id: None,
                            reason: e.to_string(),
                        }],
                    }),
                )
                    .into_response();
            }
        }
    }
    let result = process_events(&state, events).await;
    (StatusCode::ACCEPTED, Json(result)).into_response()
}

async fn process_events(state: &AppState, events: Vec<RecordEvent>) -> IngestBatchResponse {
    let mut accepted = 0usize;
    let mut duplicates = 0usize;
    let mut rejected = 0usize;
    let mut errors = Vec::new();

    let mut dedup = state.dedup.write().await;

    for (index, event) in events.into_iter().enumerate() {
        if let Err(e) = event.validate() {
            rejected += 1;
            errors.push(IngestReject {
                index,
                event_id: Some(event.event_id.clone()),
                reason: e.to_string(),
            });
            continue;
        }

        let (source_id, event_id) = event.idempotency_key();
        if dedup.try_insert(source_id, event_id.to_string()) {
            if let Some(bus) = &state.bus {
                match bus.publish_ingest(&event).await {
                    Ok(_) => accepted += 1,
                    Err(e) => {
                        rejected += 1;
                        dedup.remove(source_id, event_id);
                        errors.push(IngestReject {
                            index,
                            event_id: Some(event.event_id.clone()),
                            reason: format!("bus publish failed: {e}"),
                        });
                    }
                }
            } else {
                accepted += 1;
            }
        } else {
            duplicates += 1;
        }
    }

    IngestBatchResponse {
        accepted,
        duplicates,
        rejected,
        errors,
    }
}