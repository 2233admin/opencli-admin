"""Response schema for the system-level ODP state endpoint (C2).

This is deliberately separate from backend/schemas/control.py's
SourceControlStateRead — that endpoint reports one *source's* control state;
this one reports the shared ODP data-plane's system-level state (the Redis
consumer group, the odp_dlq table, odp-ingest's health), which has no
source_id and is not per-source data.

Every section carries its own ``available`` flag (plus an optional ``error``
string) so a client can render "N/A — Redis down" distinctly from "0" — an
absent reading must never be silently coerced into a healthy-looking zero.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class IngestHealth(BaseModel):
    """odp-ingest's own /health, as observed from here (ODP_INGEST_URL)."""

    available: bool
    healthy: bool | None = None
    error: str | None = None


class StreamGroupState(BaseModel):
    """Redis consumer-group sensor reading for the odp.ingest.raw stream.

    ``lag`` (not-yet-delivered backlog, from XINFO GROUPS) and ``pending``
    (delivered-but-unACKed, from XPENDING) are DISTINCT numbers — see
    backend/control/collectors/odp_metrics.py's module docstring for why
    collapsing them would hide a real failure-mode distinction.
    """

    available: bool
    name: str
    group: str
    lag: int | None = None
    pending: int | None = None
    oldest_pending_idle_ms: int | None = None
    error: str | None = None


class DlqSummary(BaseModel):
    """odp_dlq row counts, from the dedicated ODP-Postgres engine."""

    available: bool
    total: int | None = None
    last_24h: int | None = None
    error: str | None = None


class StoreHealth(BaseModel):
    """odp-store liveness.

    NOT AVAILABLE by design: odp-store has no heartbeat table and no HTTP
    port today (liveness is pgrep-only, operator-side). ``healthy`` is always
    None here — this is a documented missing signal, not a fabricated one.
    Adding a heartbeat producer is a Rust-side change and out of scope for
    this endpoint.
    """

    available: bool = False
    healthy: bool | None = None
    heartbeat_age_seconds: int | None = None
    note: str = "no heartbeat table / no HTTP port on odp-store; liveness is pgrep-only today"


class OutboxState(BaseModel):
    """Unpublished-outbox backlog.

    NOT AVAILABLE by design: there is no odp_outbox table. The project chose
    the "simplified reorder" design (publish-after-commit, no outbox —
    commit ef4828d). ``unpublished`` is always None here — never invent a
    query against a table that does not exist.
    """

    available: bool = False
    unpublished: int | None = None
    note: str = "no odp_outbox table (publish-after-commit design, no outbox — commit ef4828d)"


class OdpSystemState(BaseModel):
    """System-level (not per-source) snapshot of the ODP data plane."""

    ingest: IngestHealth
    stream: StreamGroupState
    dlq: DlqSummary
    store: StoreHealth
    outbox: OutboxState
    collected_at: datetime
