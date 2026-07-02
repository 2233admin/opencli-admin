"""Optional time-series snapshot table for OdpSystemState (C2).

Model only — NO migration is added here (the orchestrator writes the
alembic revision for this; see the C2 task brief). The live GET
/api/v1/control/odp-state endpoint (backend/api/v1/control.py) does NOT
depend on this table existing: it always collects fresh from Redis/ODP
Postgres/odp-ingest on demand (backend/control/collectors/odp_metrics.py).
This model exists only so a future periodic job can persist snapshots for
trend/history views, without that job being wired up yet.

If this table is added via migration, `snapshot_from_state()` below shows the
intended row shape; nothing in this PR calls it automatically.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class OdpSystemMeasurement(TimestampMixin):
    """One point-in-time snapshot of backend.schemas.odp_state.OdpSystemState.

    Columns mirror the schema's sections directly rather than storing one
    opaque JSON blob, so a history query can filter/aggregate on e.g.
    ``dlq_total`` or ``stream_pending`` without unpacking JSON at query time.
    ``raw`` keeps the full snapshot (including per-section ``error`` strings)
    for cases the flattened columns don't cover.
    """

    __tablename__ = "odp_system_measurements"

    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        index=True,
    )

    ingest_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ingest_healthy: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    stream_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    stream_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stream_group: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stream_lag: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stream_pending: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stream_oldest_pending_idle_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    dlq_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dlq_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dlq_last_24h: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # store/outbox are always unavailable today (see schemas/odp_state.py) —
    # columns kept nullable so a future Rust-side heartbeat/outbox producer
    # can start populating them without a further schema change.
    store_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    store_healthy: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    outbox_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    outbox_unpublished: Mapped[int | None] = mapped_column(Integer, nullable=True)

    raw: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


def snapshot_from_state(state) -> OdpSystemMeasurement:
    """Build an (unsaved) OdpSystemMeasurement row from an OdpSystemState.

    Not called anywhere yet — a future periodic snapshot job (or an admin
    action) would do ``session.add(snapshot_from_state(state))``. Kept as a
    plain function (not a classmethod) so it has no import-time dependency on
    backend.schemas.odp_state, avoiding a schemas<->models import cycle risk.
    """
    return OdpSystemMeasurement(
        observed_at=state.collected_at,
        ingest_available=state.ingest.available,
        ingest_healthy=state.ingest.healthy,
        stream_available=state.stream.available,
        stream_name=state.stream.name,
        stream_group=state.stream.group,
        stream_lag=state.stream.lag,
        stream_pending=state.stream.pending,
        stream_oldest_pending_idle_ms=state.stream.oldest_pending_idle_ms,
        dlq_available=state.dlq.available,
        dlq_total=state.dlq.total,
        dlq_last_24h=state.dlq.last_24h,
        store_available=state.store.available,
        store_healthy=state.store.healthy,
        outbox_available=state.outbox.available,
        outbox_unpublished=state.outbox.unpublished,
        raw=state.model_dump(mode="json"),
    )
