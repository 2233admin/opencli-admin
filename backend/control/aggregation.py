"""Aggregate existing run evidence into a SourceMeasurement (read-only).

PR-Control-2: turn the run evidence a source already produced (TaskRun +
TaskRunEvent rows) into a single :class:`SourceMeasurement` sensor reading,
without changing how collection/pipeline/runner behaves and without adding any
new table. Every query here is a SELECT — this module never writes.

See docs/CONTROL_THEORY_ARCHITECTURE.md §4-5. The measurement contract and the
safe rate derivation live in PR-Control-1
(:class:`backend.control.measurements.SourceMeasurement`) and are reused, not
redefined.

Where the numbers come from
---------------------------
A run's per-sink breakdown (accepted/duplicates/rejected) is NOT persisted to
its own columns anywhere — ``SinkResult`` flows transiently through the
pipeline and only its aggregate lands in the ``complete`` TaskRunEvent's
``detail`` JSON as ``{"collected", "stored", "skipped", "duration_ms"}`` (see
backend/pipeline/pipeline.py). So the ``complete`` event detail is the single
durable place a collected/stored/skipped breakdown survives, and we map:

    accepted   := stored   (new records the sink committed)
    duplicates := skipped  (items recognized as already-seen)
    rejected   := max(0, collected - stored - skipped)

A failed run never emits a ``complete`` event; we still build a measurement
from ``TaskRun.records_collected`` (which the runner sets to ``stored``) rather
than returning ``None`` — a failed run is still evidence.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.control.measurements import SourceMeasurement
from backend.models.task import CollectionTask, TaskRun, TaskRunEvent


async def build_measurement(
    session: AsyncSession, source_id: str
) -> Optional[SourceMeasurement]:
    """Build a :class:`SourceMeasurement` from the source's latest run evidence.

    Read-only. Returns ``None`` if the source has never run (no TaskRun rows).
    Reuses :meth:`SourceMeasurement.derive` for the safe rate computation.
    """
    # Latest run for this source: TaskRun -> task_id -> CollectionTask.source_id.
    # TaskRun has no direct source_id column, so we join through the task.
    latest_run = (
        await session.execute(
            select(TaskRun)
            .join(CollectionTask, TaskRun.task_id == CollectionTask.id)
            .where(CollectionTask.source_id == source_id)
            .order_by(TaskRun.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if latest_run is None:
        # Source has never run — no sensor reading to report.
        return None

    # Prefer the durable collected/stored/skipped breakdown from the run's
    # `complete` event detail. Fall back to TaskRun.records_collected (== stored)
    # for runs that never emitted one (failed runs, or a run without a run_id).
    complete_event = (
        await session.execute(
            select(TaskRunEvent)
            .where(TaskRunEvent.run_id == latest_run.id)
            .where(TaskRunEvent.step == "complete")
            .order_by(TaskRunEvent.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    detail = (complete_event.detail if complete_event else None) or {}
    if detail:
        collected = int(detail.get("collected", 0) or 0)
        stored = int(detail.get("stored", 0) or 0)
        skipped = int(detail.get("skipped", 0) or 0)
    else:
        # No complete event (e.g. failed run): records_collected is the runner's
        # `stored`; we have no collected/skipped breakdown, so treat those as 0.
        collected = int(latest_run.records_collected or 0)
        stored = int(latest_run.records_collected or 0)
        skipped = 0

    accepted = stored
    duplicates = skipped
    # `collected` is total items fetched; anything not stored and not a duplicate
    # was dropped for validation / a permanent error. Clamp at 0 so a stale or
    # inconsistent detail can never produce a negative count.
    rejected = max(0, collected - stored - skipped)

    # fetch_latency_ms: the `collect` event records step1's elapsed_ms
    # (backend/pipeline/pipeline.py). Fall back to the run's total duration_ms,
    # then 0, when no collect event carries an elapsed value.
    fetch_latency_ms = await _collect_elapsed_ms(session, latest_run.id)
    if fetch_latency_ms is None:
        fetch_latency_ms = int(latest_run.duration_ms or 0)

    observed_at = latest_run.finished_at or latest_run.created_at or datetime.now(
        timezone.utc
    )

    return SourceMeasurement.derive(
        source_id=source_id,
        run_id=latest_run.id,
        accepted=accepted,
        duplicates=duplicates,
        rejected=rejected,
        fetch_latency_ms=fetch_latency_ms,
        observed_at=observed_at,
        # cursor_advanced: no boolean is persisted per-run today, and deriving it
        # precisely would require touching the pipeline/cursor path (out of scope
        # for this read-only PR). Report a conservative False; PR-Control-3+ can
        # thread a real signal once cursor advancement is recorded on the run.
        cursor_advanced=False,
        # ingest/store latency are not persisted separately today — leave None.
        ingest_latency_ms=None,
        store_latency_ms=None,
        # freshness_lag is not computed from existing tables in this PR.
        freshness_lag_seconds=None,
        # ODP metrics (stream lag / pending / DLQ) live in odp-rs's own
        # Postgres/Redis and are not reachable from this service without a
        # cross-service call, which is out of scope for PR-Control-2. Leave them
        # unpopulated (None / 0) — the contract already allows it — rather than
        # inventing values.
        odp_stream_lag=None,
        odp_pending=None,
        dlq_count=0,
    )


async def _collect_elapsed_ms(
    session: AsyncSession, run_id: str
) -> Optional[int]:
    """Return the ``collect`` step's elapsed_ms for a run, if recorded."""
    event = (
        await session.execute(
            select(TaskRunEvent)
            .where(TaskRunEvent.run_id == run_id)
            .where(TaskRunEvent.step == "collect")
            .where(TaskRunEvent.elapsed_ms.is_not(None))
            .order_by(TaskRunEvent.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return int(event.elapsed_ms) if event and event.elapsed_ms is not None else None
