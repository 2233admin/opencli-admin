"""System-level control-plane endpoints (C2 + PR-Control-3.5).

Distinct from backend/api/v1/sources.py's GET /sources/{id}/control-state
(per-source): this router exposes the shared ODP data plane's system-level
state — the Redis consumer group backing odp.ingest.raw, the odp_dlq table,
and odp-ingest's own health — none of which is per-source data.

PR-Control-3.5 adds the ledger-level views: GET /control/advisory-report
(agreement/recovery report over control_actions — the gate data for ever
flipping control_mode="automatic") and POST /control/outcomes/evaluate (an
explicit outcome-judgment pass). Both are cross-source, hence they live here
rather than under /sources/{id}.

Always returns 200. A down Redis or ODP Postgres degrades that section to
``available: false`` (see backend/control/collectors/odp_metrics.py) — it
never turns into a 500, since a monitoring endpoint that itself throws when
the thing it's monitoring is unhealthy defeats the point of having it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.control.collectors import odp_metrics
from backend.control.outcomes import evaluate_pending_outcomes
from backend.database import get_db
from backend.models.control_action import ControlActionRecord
from backend.schemas.common import ApiResponse
from backend.schemas.control import (
    AdvisoryReportBucketRead,
    AdvisoryReportRead,
    AdvisoryReportTotalsRead,
    OutcomeEvaluationRead,
)
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


def _tally(rows: list[ControlActionRecord]) -> dict:
    """Fold a set of ledger rows into the shared totals shape (pure)."""
    recovered = sum(1 for r in rows if r.outcome == "recovered")
    persisted = sum(1 for r in rows if r.outcome == "persisted")
    insufficient = sum(1 for r in rows if r.outcome == "insufficient_data")
    evaluated = sum(1 for r in rows if r.evaluated_at is not None)
    denominator = recovered + persisted
    return {
        "total": len(rows),
        "pending": len(rows) - evaluated,
        "evaluated": evaluated,
        "recovered": recovered,
        "persisted": persisted,
        "insufficient_data": insufficient,
        # null (not 0.0) when nothing has a recovered/persisted verdict yet —
        # a 0-of-0 rate would be a fabricated signal, not a measurement.
        "recovery_rate": recovered / denominator if denominator else None,
    }


@router.get("/advisory-report", response_model=ApiResponse[AdvisoryReportRead])
async def get_advisory_report(db: AsyncSession = Depends(get_db)) -> ApiResponse:
    """Agreement/recovery report over the control_actions evidence ledger
    (PR-Control-3.5).

    THIS is the gate data for ever flipping ``Settings.control_mode`` to
    "automatic" per state class: a (state, action_type) bucket whose
    suggestions overwhelmingly turn out "persisted" (the problem really did
    outlive the suggestion — acting would have helped) is a candidate for
    PR-Control-4 automation; a bucket that mostly "recovered" on its own is
    evidence the feedback law over-suggests there and must NOT be automated
    yet. No cron dependency: pending outcomes are lazily judged
    (``backend.control.outcomes.evaluate_pending_outcomes``) before
    aggregating, so the report is current whenever it is read.

    Advisory-only, like the ledger it reads: judging and reporting never
    touches a DataSource and never executes anything.
    """
    counts = await evaluate_pending_outcomes(db)

    rows = (
        (
            await db.execute(
                select(ControlActionRecord).order_by(ControlActionRecord.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    buckets: dict[tuple[str, str], list[ControlActionRecord]] = {}
    modes: dict[str, int] = {}
    for row in rows:
        buckets.setdefault((row.state, row.action_type), []).append(row)
        modes[row.mode] = modes.get(row.mode, 0) + 1

    return ApiResponse.ok(
        AdvisoryReportRead(
            buckets=[
                AdvisoryReportBucketRead(state=state, action_type=action_type, **_tally(group))
                for (state, action_type), group in sorted(buckets.items())
            ],
            totals=AdvisoryReportTotalsRead(**_tally(list(rows))),
            mode_breakdown=modes,
            evaluation=OutcomeEvaluationRead(**counts),
        )
    )


@router.post(
    "/outcomes/evaluate", response_model=ApiResponse[OutcomeEvaluationRead]
)
async def trigger_outcome_evaluation(db: AsyncSession = Depends(get_db)) -> ApiResponse:
    """Explicitly run one outcome-judgment pass over pending ledger rows.

    The advisory-report already does this lazily on every read; this trigger
    exists for operators/tests that want the judgment step on its own,
    without pulling the full report. Judgment writes only the outcome
    columns back onto control_actions rows — advisory-only, nothing
    executes.
    """
    counts = await evaluate_pending_outcomes(db)
    return ApiResponse.ok(OutcomeEvaluationRead(**counts))
