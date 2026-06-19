//! ODP Record v2 — language-neutral contract (also mirrored in `contracts/record_v2.schema.json`).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IngestMode {
    Snapshot,
    Stream,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordEvent {
    pub schema_version: u32,
    pub provider: String,
    pub source_id: Uuid,
    pub event_id: String,
    pub ingest_mode: IngestMode,
    pub source_ts: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub payload: serde_json::Value,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub raw_data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestBatchRequest {
    pub events: Vec<RecordEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestBatchResponse {
    pub accepted: usize,
    pub duplicates: usize,
    pub rejected: usize,
    pub errors: Vec<IngestReject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestReject {
    pub index: usize,
    pub event_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ContractError {
    #[error("unsupported schema_version: {0}")]
    UnsupportedSchemaVersion(u32),
    #[error("missing field: {0}")]
    MissingField(&'static str),
    #[error("invalid event_id")]
    InvalidEventId,
}

impl RecordEvent {
    pub fn validate(&self) -> Result<(), ContractError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(ContractError::UnsupportedSchemaVersion(self.schema_version));
        }
        if self.provider.trim().is_empty() {
            return Err(ContractError::MissingField("provider"));
        }
        if self.event_id.trim().is_empty() {
            return Err(ContractError::InvalidEventId);
        }
        if !self.payload.is_object() {
            return Err(ContractError::MissingField("payload"));
        }
        Ok(())
    }

    /// Idempotency key for store layer: (source_id, event_id).
    pub fn idempotency_key(&self) -> (Uuid, &str) {
        (self.source_id, self.event_id.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_minimal_event() {
        let ev = RecordEvent {
            schema_version: SCHEMA_VERSION,
            provider: "rss/feed".into(),
            source_id: Uuid::new_v4(),
            event_id: "entry-1".into(),
            ingest_mode: IngestMode::Snapshot,
            source_ts: Utc::now(),
            cursor: None,
            payload: serde_json::json!({"title": "t", "url": "u"}),
            raw_data: serde_json::Value::Null,
            trace_id: None,
            task_id: None,
        };
        assert!(ev.validate().is_ok());
    }
}