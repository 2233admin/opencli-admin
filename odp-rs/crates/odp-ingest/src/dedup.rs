use std::collections::HashSet;

use uuid::Uuid;

/// In-memory idempotency index (Phase 0). Replaced by Redis/Postgres in Phase 1.
#[derive(Default)]
pub struct DedupIndex {
    keys: HashSet<(Uuid, String)>,
}

impl DedupIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn try_insert(&mut self, source_id: Uuid, event_id: String) -> bool {
        self.keys.insert((source_id, event_id))
    }

    pub fn remove(&mut self, source_id: Uuid, event_id: &str) {
        self.keys.remove(&(source_id, event_id.to_string()));
    }

    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.keys.len()
    }
}