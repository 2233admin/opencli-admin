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

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.control.collectors import odp_metrics
from backend.control.outcomes import evaluate_pending_outcomes
from backend.control import kill_switch
from backend.control.report import bucket_by_state_action, mode_breakdown, tally
from backend.database import get_db
from backend.models.control_action import ControlActionRecord
from backend.schemas.common import ApiResponse, PaginationMeta
from backend.schemas.control import (
    AdvisoryReportBucketRead,
    AdvisoryReportRead,
    AdvisoryReportTotalsRead,
    ControlActionRecordRead,
    KillSwitchRead,
    KillSwitchUpdate,
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
from backend.services import control_ledger_service

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
    buckets = bucket_by_state_action(rows)

    return ApiResponse.ok(
        AdvisoryReportRead(
            buckets=[
                AdvisoryReportBucketRead(state=state, action_type=action_type, **tally(group))
                for (state, action_type), group in sorted(buckets.items())
            ],
            totals=AdvisoryReportTotalsRead(**tally(list(rows))),
            mode_breakdown=mode_breakdown(rows),
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


@router.get("/actions", response_model=ApiResponse[list[ControlActionRecordRead]])
async def list_control_actions(
    source_id: Optional[str] = None,
    mode: Optional[str] = None,
    outcome: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    """Row-level Evidence Ledger listing (issue 07 — action history view).

    The operator's audit surface over everything the controller has ever
    suggested or done: filter by source/mode/outcome, paginate like every
    other list endpoint (see backend/services/record_service.py). Read-only
    — nothing here writes to control_actions or evaluates pending outcomes
    (that stays the advisory-report's and outcomes/evaluate's job so this
    endpoint's GET semantics stay a pure read, matching the control-state
    zero-mutation guarantee).

    ``outcome=pending`` selects rows not yet judged (``evaluated_at is
    null``) since "pending" is never a stored ``outcome`` value.
    """
    rows, total = await control_ledger_service.list_control_actions(
        db, source_id=source_id, mode=mode, outcome=outcome, page=page, limit=limit
    )
    return ApiResponse.ok(
        data=[ControlActionRecordRead.model_validate(r) for r in rows],
        meta=PaginationMeta(
            total=total, page=page, limit=limit, pages=max(1, -(-total // limit))
        ),
    )


@router.get("/kill-switch", response_model=ApiResponse[KillSwitchRead])
async def get_kill_switch() -> ApiResponse:
    """Read the actuator's global kill switch (issue 03).

    Pure read: never itself engages/disengages the switch. See
    ``backend.control.kill_switch`` for the config-vs-runtime-override
    precedence this reflects.
    """
    return ApiResponse.ok(KillSwitchRead(**kill_switch.current_state()))


@router.post("/kill-switch", response_model=ApiResponse[KillSwitchRead])
async def set_kill_switch(body: KillSwitchUpdate) -> ApiResponse:
    """Set the in-memory runtime kill-switch override (issue 03).

    ``engaged=True`` short-circuits ALL Control Cycle execution on the very
    next tick, unconditionally, before any other gate is evaluated.
    ``engaged=False`` explicitly disengages it (still requires
    ``CONTROL_MODE=automatic`` and every other gate to pass before anything
    executes — this alone does not open Automatic Mode). The override resets
    to ``Settings.control_kill_switch`` on process restart.
    """
    kill_switch.set_override(body.engaged)
    return ApiResponse.ok(KillSwitchRead(**kill_switch.current_state()))
