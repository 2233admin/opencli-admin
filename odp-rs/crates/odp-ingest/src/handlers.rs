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
                // Defense in depth (see main.rs's startup guard, which
                // refuses to start with no bus unless ODP_INGEST_ALLOW_NO_BUS=1):
                // even in that explicit opt-in dev/test mode, an event with
                // no bus to publish to must never be reported as accepted —
                // it is not persisted anywhere and would vanish the moment
                // this process exits.
                //
                // Unlike the publish-failure branch above, the dedup entry is
                // NOT removed here: "no bus" is a persistent process-lifetime
                // condition (not a one-off transient failure), so undoing it
                // would just let the same event_id get rejected again as
                // "not a duplicate" on every repeat within this run instead
                // of correctly reporting it as a duplicate resubmission.
                rejected += 1;
                errors.push(IngestReject {
                    index,
                    event_id: Some(event.event_id.clone()),
                    reason: "no bus configured; event not persisted".to_string(),
                });
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dedup::DedupIndex;
    use chrono::Utc;
    use odp_contracts::IngestMode;
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use uuid::Uuid;

    fn sample_event(event_id: &str) -> RecordEvent {
        RecordEvent {
            schema_version: odp_contracts::SCHEMA_VERSION,
            provider: "rss/feed".into(),
            source_id: Uuid::new_v4(),
            event_id: event_id.into(),
            ingest_mode: IngestMode::Snapshot,
            source_ts: Utc::now(),
            cursor: None,
            payload: serde_json::json!({"title": "t"}),
            raw_data: serde_json::Value::Null,
            trace_id: None,
            task_id: None,
        }
    }

    fn state_without_bus() -> AppState {
        AppState {
            dedup: Arc::new(RwLock::new(DedupIndex::new())),
            bus: None,
        }
    }

    /// P0-2: with no bus configured (the ODP_INGEST_ALLOW_NO_BUS=1 opt-in dev
    /// mode — main.rs refuses to start in this state otherwise), every event
    /// must be rejected, NEVER accepted — an "accepted" count with no bus
    /// would be a black hole: the event is not persisted anywhere.
    #[tokio::test]
    async fn process_events_with_no_bus_rejects_everything() {
        let state = state_without_bus();
        let events = vec![
            sample_event("e1"),
            sample_event("e2"),
            sample_event("e3"),
        ];

        let result = process_events(&state, events).await;

        assert_eq!(result.accepted, 0);
        assert_eq!(result.rejected, 3);
        assert_eq!(result.duplicates, 0);
        assert_eq!(result.errors.len(), 3);
        for e in &result.errors {
            assert!(e.reason.contains("no bus configured"));
        }
    }

    /// A duplicate event_id (same source_id/event_id already seen) must still
    /// count as a duplicate, not a rejection, even with no bus — dedup runs
    /// before the bus check.
    #[tokio::test]
    async fn process_events_with_no_bus_still_detects_duplicates() {
        let state = state_without_bus();
        let ev1 = sample_event("dup-1");
        // Same (source_id, event_id) as ev1 — the dedup key — so this is a
        // true duplicate of the first, not just a coincidentally-equal id.
        let ev2 = RecordEvent {
            source_id: ev1.source_id,
            ..sample_event("dup-1")
        };

        let result = process_events(&state, vec![ev1, ev2]).await;

        assert_eq!(result.accepted, 0);
        assert_eq!(result.rejected, 1); // first one: rejected, no bus
        assert_eq!(result.duplicates, 1); // second one: same (source_id, event_id)
    }

    /// An invalid event must still be rejected for validation reasons, not
    /// counted as a bus-related rejection — validation happens first.
    #[tokio::test]
    async fn process_events_validation_failure_before_bus_check() {
        let state = state_without_bus();
        let mut bad = sample_event("bad-1");
        bad.provider = String::new(); // fails RecordEvent::validate()

        let result = process_events(&state, vec![bad]).await;

        assert_eq!(result.accepted, 0);
        assert_eq!(result.rejected, 1);
        assert!(!result.errors[0].reason.contains("no bus configured"));
    }
}