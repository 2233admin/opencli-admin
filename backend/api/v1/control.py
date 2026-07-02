"""System-level control-plane endpoints (C2).

Distinct from backend/api/v1/sources.py's GET /sources/{id}/control-state
(per-source): this router exposes the shared ODP data plane's system-level
state — the Redis consumer group backing odp.ingest.raw, the odp_dlq table,
and odp-ingest's own health — none of which is per-source data.

Always returns 200. A down Redis or ODP Postgres degrades that section to
``available: false`` (see backend/control/collectors/odp_metrics.py) — it
never turns into a 500, since a monitoring endpoint that itself throws when
the thing it's monitoring is unhealthy defeats the point of having it.
"""

from __future__ import annotations

from fastapi import APIRouter

from backend.control.collectors import odp_metrics
from backend.schemas.common import ApiResponse
from backend.schemas.odp_state import (
    DlqSummary,
    IngestHealth,
    OdpSystemState,
    OutboxState,
    StoreHealth,
    StreamGroupState,
)

router = APIRouter(prefix="/control", tags=["control"])


@router.get("/odp-state", response_model=ApiResponse[OdpSystemState])
async def get_odp_state() -> ApiResponse:
    """Live, on-demand system-level ODP snapshot (no persistence required).

    Collects Redis stream/group state + odp_dlq counts + odp-ingest health in
    one pass (backend.control.collectors.odp_metrics.collect). store/outbox
    are always reported unavailable (see backend.schemas.odp_state) — there is
    no odp-store heartbeat and no odp_outbox table to read from.
    """
    snapshot = await odp_metrics.collect()

    state = OdpSystemState(
        ingest=IngestHealth(
            available=snapshot.ingest.available,
            healthy=snapshot.ingest.healthy,
            error=snapshot.ingest.error,
        ),
        stream=StreamGroupState(
            available=snapshot.stream.available,
            name=snapshot.stream.name,
            group=snapshot.stream.group,
            lag=snapshot.stream.lag,
            pending=snapshot.stream.pending,
            oldest_pending_idle_ms=snapshot.stream.oldest_pending_idle_ms,
            error=snapshot.stream.error,
        ),
        dlq=DlqSummary(
            available=snapshot.dlq.available,
            total=snapshot.dlq.total,
            last_24h=snapshot.dlq.last_24h,
            error=snapshot.dlq.error,
        ),
        store=StoreHealth(),
        outbox=OutboxState(),
        collected_at=snapshot.collected_at,
    )
    return ApiResponse.ok(state)
