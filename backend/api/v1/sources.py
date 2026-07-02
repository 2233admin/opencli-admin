import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.manager import AuthManager
from backend.config import get_settings
from backend.control import aggregation, evaluator
from backend.control.coverage import compute_sensor_coverage, derive_confidence, missing_signals
from backend.control.ledger import record_advisory_actions
from backend.control.objectives import SourceObjective
from backend.control.policies import suggest_actions
from backend.database import get_db
from backend.schemas.common import ApiResponse, PaginationMeta
from backend.schemas.control import (
    SourceControlStateRead,
    SuggestedActionRead,
    SystemContextRead,
    TrendRead,
)
from backend.schemas.credential import CredentialCreate, CredentialKeyRead
from backend.schemas.source import DataSourceCreate, DataSourceDetail, DataSourceRead, DataSourceUpdate
from backend.services import source_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=ApiResponse[list[DataSourceRead]])
async def list_sources(
    enabled: Optional[bool] = None,
    channel_type: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    sources, total = await source_service.list_sources(
        db, enabled=enabled, channel_type=channel_type, page=page, limit=limit
    )
    return ApiResponse.ok(
        data=[DataSourceRead.model_validate(s) for s in sources],
        meta=PaginationMeta(
            total=total, page=page, limit=limit, pages=max(1, -(-total // limit))
        ),
    )


@router.post("", response_model=ApiResponse[DataSourceRead], status_code=201)
async def create_source(
    body: DataSourceCreate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.create_source(db, body)
    return ApiResponse.ok(DataSourceRead.model_validate(source))


class FeedDiscoveryRequest(BaseModel):
    url: str


class FeedCandidate(BaseModel):
    url: str
    title: Optional[str] = None


@router.post("/discover-feed", response_model=ApiResponse[list[FeedCandidate]])
async def discover_feed(body: FeedDiscoveryRequest) -> ApiResponse:
    """Given a site's homepage, find candidate RSS/Atom feeds — setup-time
    convenience, not a scheduled channel action. Returns every candidate found
    (never auto-picks "the main one"); empty list if none found."""
    candidates = await source_service.discover_feeds(body.url)
    return ApiResponse.ok([FeedCandidate(**c) for c in candidates])


class OpmlImportResult(BaseModel):
    created: list[DataSourceRead]
    skipped_existing: list[str]


@router.post("/import-opml", response_model=ApiResponse[OpmlImportResult])
async def import_opml(
    file: UploadFile = File(...), db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Bulk-create channel_type="rss" sources from an OPML export. Created
    rows land disabled (human reviews + enables); already-stored feed_urls and
    duplicates within the same file are skipped, not re-created."""
    raw = await file.read()
    try:
        entries = source_service.parse_opml(raw.decode("utf-8"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    created, skipped = await source_service.bulk_import_rss(db, entries)
    await db.commit()
    return ApiResponse.ok(
        OpmlImportResult(
            created=[DataSourceRead.model_validate(s) for s in created],
            skipped_existing=skipped,
        )
    )


@router.get("/{source_id}", response_model=ApiResponse[DataSourceDetail])
async def get_source(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return ApiResponse.ok(DataSourceDetail.model_validate(source))


@router.patch("/{source_id}", response_model=ApiResponse[DataSourceRead])
async def update_source(
    source_id: str, body: DataSourceUpdate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    updated = await source_service.update_source(db, source, body)
    return ApiResponse.ok(DataSourceRead.model_validate(updated))


@router.delete("/{source_id}", response_model=ApiResponse[None])
async def delete_source(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    await source_service.delete_source(db, source)
    return ApiResponse.ok(None)


@router.post("/{source_id}/test", response_model=ApiResponse[dict])
async def test_source(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    ok, errors = await source_service.test_source_connectivity(source)
    return ApiResponse.ok({"connected": ok, "errors": errors})


@router.get("/{source_id}/credentials", response_model=ApiResponse[list[CredentialKeyRead]])
async def list_source_credentials(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Which credential keys are stored for this source — never the values."""
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    keys = await AuthManager().list_keys(source_id)
    return ApiResponse.ok([CredentialKeyRead(key_name=k) for k in keys])


@router.post(
    "/{source_id}/credentials", response_model=ApiResponse[None], status_code=201
)
async def store_source_credential(
    source_id: str, body: CredentialCreate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Encrypt and store a secret for this source (``AuthManager``-backed).
    Migrates a source off plaintext ``channel_config.auth`` / env indirection —
    channels that read via ``AuthManager`` (e.g. ``api``) prefer this over the
    legacy inline config once a matching key is stored."""
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    await AuthManager().store(source_id, body.key_name, body.secret)
    return ApiResponse.ok(None)


@router.delete("/{source_id}/credentials/{key_name}", response_model=ApiResponse[None])
async def delete_source_credential(
    source_id: str, key_name: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    await AuthManager().delete(source_id, key_name)
    return ApiResponse.ok(None)


async def _build_system_context(objective: SourceObjective) -> SystemContextRead:
    """Collect the shared ODP system_context, degrading gracefully.

    Reuses C2's read-only collector (backend.control.collectors.odp_metrics) —
    never queries Redis/ODP-Postgres/odp-ingest directly. Any collector
    failure (or a section reporting itself unavailable) yields
    ``available=False`` / ``odp_backpressured=False`` rather than raising —
    this endpoint must return 200 even when ODP is fully down (see
    docs/CONTROL_THEORY_ARCHITECTURE.md §0).
    """
    try:
        from backend.control.collectors import odp_metrics

        snapshot = await odp_metrics.collect()
    except Exception as exc:  # pragma: no cover - collect() already degrades
        # internally; this is a last-resort guard so a collector import/
        # crash bug can never turn this endpoint into a 500.
        logger.warning("control-state: odp_metrics.collect failed: %s", exc)
        return SystemContextRead(odp_backpressured=False, available=False)

    stream_available = snapshot.stream.available
    pending = snapshot.stream.pending
    lag = snapshot.stream.lag

    odp_backpressured = (
        stream_available and pending is not None and pending > objective.max_pending
    )

    return SystemContextRead(
        odp_backpressured=odp_backpressured,
        stream_lag=lag if stream_available else None,
        pending=pending if stream_available else None,
        available=stream_available,
    )


@router.get(
    "/{source_id}/control-state",
    response_model=ApiResponse[SourceControlStateRead],
)
async def get_source_control_state(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Read-only, ADVISORY control view of a source (PR-Control-3).

    Aggregates the source's latest sensor reading (preferring the persisted
    ``source_measurements`` table — see ``backend.control.aggregation``),
    computes a rolling trend, collects the shared ODP system_context, derives
    a full ``SourceControlState`` (``backend.control.evaluator``), and maps
    that state onto advisory ``ControlAction`` suggestions
    (``backend.control.policies``).

    ADVISORY ONLY: this endpoint never mutates the source's ``DataSource``
    row (no pause/resume, no interval change, no config write) and never
    calls the scheduler. Per PR-Control-3.5, a non-empty suggestion list IS
    persisted as evidence to the ``control_actions`` ledger
    (``backend.control.ledger.record_advisory_actions``) — recording that a
    suggestion was made is not the same as acting on it; only a human (or a
    future PR-Control-4 actuator, gated by ``Settings.control_mode``) decides
    whether to act.

    404 if the source itself doesn't exist. Every other failure mode (no run
    evidence yet, ODP fully down) degrades gracefully to nulls/False fields —
    this endpoint never 500s because a downstream signal is unavailable.
    """
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    settings = get_settings()
    objective = SourceObjective()
    measurement_row = await aggregation.latest_measurement_row(db, source_id)
    measurement = (
        aggregation.row_to_measurement(measurement_row)
        if measurement_row is not None
        else await aggregation.build_measurement(db, source_id)
    )
    trend_summary = await aggregation.build_trend(db, source_id)
    system_context = await _build_system_context(objective)

    control_state = None
    confidence = None
    coverage = None
    missing: list[str] = []
    trend_read: Optional[TrendRead] = None
    suggestions: list[SuggestedActionRead] = []

    if measurement is not None:
        if trend_summary is not None:
            trend_read = TrendRead(
                window=trend_summary.window,
                zero_accepted_streak=trend_summary.zero_accepted_streak,
                avg_error_rate=trend_summary.avg_error_rate,
                rate_limited_runs=trend_summary.rate_limited_runs,
            )

        control_state = evaluator.evaluate(
            measurement,
            objective,
            trend=(
                {
                    "window": trend_summary.window,
                    "zero_accepted_streak": trend_summary.zero_accepted_streak,
                    "avg_error_rate": trend_summary.avg_error_rate,
                    "rate_limited_runs": trend_summary.rate_limited_runs,
                }
                if trend_summary is not None
                else None
            ),
            system_context={
                "odp_backpressured": system_context.odp_backpressured,
                "available": system_context.available,
            },
        )
        coverage = compute_sensor_coverage(measurement)
        confidence = derive_confidence(coverage)
        missing = missing_signals(coverage)

        actions = suggest_actions(control_state, measurement, objective)
        suggestions = [
            SuggestedActionRead(
                action_type=a.action_type, reason=a.reason, payload=a.payload
            )
            for a in actions
        ]

        if suggestions:
            # Advisory activity is observable (docs §2 principle 8:
            # "自动化必须可解释") — emit a TaskRunEvent-shaped audit trail via
            # the existing pipeline event sink. Best-effort: events.emit()
            # already swallows its own errors and never raises, and emitting
            # is not required for the response to be correct.
            from backend.pipeline import events

            await events.emit(
                run_id=measurement.run_id,
                step="control_advisory",
                message=(
                    f"advisory: {control_state.value} -> "
                    f"{[a.action_type for a in actions]}"
                ),
                level="info",
                detail={
                    "source_id": source_id,
                    "control_state": control_state.value,
                    "suggested_actions": [
                        {"action_type": a.action_type, "reason": a.reason, "payload": a.payload}
                        for a in actions
                    ],
                    "control_mode": settings.control_mode,
                },
            )

            # PR-Control-3.5: persist each suggestion to the advisory evidence
            # ledger (backend.control.ledger) so a later outcome pass can judge
            # whether it was justified. Same request session — the ledger
            # write shares this request's transaction — and same best-effort
            # stance as the events.emit() call above: recording evidence must
            # never turn this read-only, advisory endpoint into a 500.
            try:
                await record_advisory_actions(
                    db,
                    source_id=source_id,
                    state=control_state,
                    actions=actions,
                    measurement=measurement,
                    measurement_row_id=(
                        measurement_row.id if measurement_row is not None else None
                    ),
                    run_id=(
                        measurement_row.run_id if measurement_row is not None else None
                    ),
                    mode=settings.control_mode,
                    dedup_seconds=settings.control_advisory_dedup_seconds,
                )
            except Exception as exc:  # pragma: no cover - defensive guard
                logger.warning("control-state: ledger write failed: %s", exc)

    return ApiResponse.ok(
        SourceControlStateRead(
            source_id=source_id,
            control_state=control_state,
            confidence=confidence,
            sensor_coverage=coverage,
            missing_signals=missing,
            measurement=measurement,
            objective=objective,
            trend=trend_read,
            system_context=system_context,
            suggested_actions=suggestions,
            control_mode=settings.control_mode,
        )
    )
