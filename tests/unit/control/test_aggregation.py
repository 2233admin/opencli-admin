"""Unit tests for backend.control.aggregation.build_measurement (read-only).

Uses the in-memory sqlite db_session fixture from tests/conftest.py. These tests
construct DataSource / CollectionTask / TaskRun / TaskRunEvent rows directly and
assert the aggregated SourceMeasurement — no pipeline/runner is invoked.
"""

from datetime import datetime, timezone

import pytest

from backend.control.aggregation import build_measurement
from backend.models.source import DataSource
from backend.models.task import CollectionTask, TaskRun, TaskRunEvent


async def _make_source(session, **overrides) -> DataSource:
    source = DataSource(
        name=overrides.get("name", "Test Source"),
        channel_type=overrides.get("channel_type", "rss"),
        channel_config=overrides.get("channel_config", {"feed_url": "https://x/feed"}),
        enabled=True,
        tags=[],
    )
    session.add(source)
    await session.flush()
    return source


async def _make_task(session, source_id: str) -> CollectionTask:
    task = CollectionTask(source_id=source_id, trigger_type="manual", parameters={})
    session.add(task)
    await session.flush()
    return task


@pytest.mark.asyncio
async def test_returns_none_when_source_never_ran(db_session):
    source = await _make_source(db_session)
    # A task with no runs still counts as "never ran".
    await _make_task(db_session, source.id)
    await db_session.flush()

    result = await build_measurement(db_session, source.id)
    assert result is None


@pytest.mark.asyncio
async def test_returns_none_for_unknown_source(db_session):
    result = await build_measurement(db_session, "does-not-exist")
    assert result is None


@pytest.mark.asyncio
async def test_completed_run_with_complete_event(db_session):
    source = await _make_source(db_session)
    task = await _make_task(db_session, source.id)

    run = TaskRun(
        task_id=task.id,
        status="completed",
        started_at=datetime(2026, 7, 2, 10, 0, tzinfo=timezone.utc),
        finished_at=datetime(2026, 7, 2, 10, 1, tzinfo=timezone.utc),
        duration_ms=60_000,
        records_collected=8,  # == stored
    )
    db_session.add(run)
    await db_session.flush()

    # collect event carries step1 elapsed_ms
    db_session.add(
        TaskRunEvent(run_id=run.id, level="info", step="collect", message="done", elapsed_ms=250)
    )
    # complete event carries the durable breakdown
    db_session.add(
        TaskRunEvent(
            run_id=run.id,
            level="info",
            step="complete",
            message="done",
            detail={"duration_ms": 60_000, "collected": 10, "stored": 8, "skipped": 1},
        )
    )
    await db_session.flush()

    m = await build_measurement(db_session, source.id)
    assert m is not None
    assert m.source_id == source.id
    assert m.run_id == run.id
    # accepted=stored, duplicates=skipped, rejected=collected-stored-skipped
    assert m.accepted == 8
    assert m.duplicates == 1
    assert m.rejected == 1  # 10 - 8 - 1
    assert m.fetch_latency_ms == 250  # from collect event elapsed_ms
    # derived rates: total_seen = 8 + 1 + 1 = 10
    assert m.error_rate == pytest.approx(1 / 10)
    assert m.duplicate_rate == pytest.approx(1 / 10)
    # PR-Control-2 leaves these unpopulated
    assert m.odp_stream_lag is None
    assert m.odp_pending is None
    assert m.dlq_count == 0
    assert m.cursor_advanced is False
    assert m.observed_at == run.finished_at


@pytest.mark.asyncio
async def test_failed_run_without_complete_event_still_returns_measurement(db_session):
    source = await _make_source(db_session)
    task = await _make_task(db_session, source.id)

    run = TaskRun(
        task_id=task.id,
        status="failed",
        started_at=datetime(2026, 7, 2, 11, 0, tzinfo=timezone.utc),
        finished_at=datetime(2026, 7, 2, 11, 0, 5, tzinfo=timezone.utc),
        duration_ms=5_000,
        records_collected=0,
        error_message="boom",
    )
    db_session.add(run)
    await db_session.flush()

    m = await build_measurement(db_session, source.id)
    assert m is not None  # a failed run is still evidence
    assert m.run_id == run.id
    assert m.accepted == 0
    assert m.duplicates == 0
    assert m.rejected == 0
    # no collect event -> falls back to run.duration_ms for fetch latency
    assert m.fetch_latency_ms == 5_000
    assert m.error_rate == 0.0
    assert m.duplicate_rate == 0.0


@pytest.mark.asyncio
async def test_picks_most_recent_run(db_session):
    source = await _make_source(db_session)
    task = await _make_task(db_session, source.id)

    old = TaskRun(
        task_id=task.id,
        status="completed",
        created_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        duration_ms=1000,
        records_collected=1,
    )
    db_session.add(old)
    await db_session.flush()
    db_session.add(
        TaskRunEvent(
            run_id=old.id, level="info", step="complete", message="old",
            detail={"collected": 1, "stored": 1, "skipped": 0},
        )
    )

    new = TaskRun(
        task_id=task.id,
        status="completed",
        created_at=datetime(2026, 7, 2, tzinfo=timezone.utc),
        finished_at=datetime(2026, 7, 2, tzinfo=timezone.utc),
        duration_ms=2000,
        records_collected=5,
    )
    db_session.add(new)
    await db_session.flush()
    db_session.add(
        TaskRunEvent(
            run_id=new.id, level="info", step="complete", message="new",
            detail={"collected": 7, "stored": 5, "skipped": 2},
        )
    )
    await db_session.flush()

    m = await build_measurement(db_session, source.id)
    assert m is not None
    assert m.run_id == new.id
    assert m.accepted == 5
    assert m.duplicates == 2
