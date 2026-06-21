-- ODP data-plane record store (Postgres). Applied by odp-store on startup.

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