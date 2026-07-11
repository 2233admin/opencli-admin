"""Unit tests for backend/worker/tasks.py — celery task retry wiring."""

from unittest.mock import patch

import pytest

from backend.worker.tasks import (
    _AlertOnRetriesExhaustedTask,
    run_collection,
    run_scheduled_collection,
)


def test_run_collection_autoretries_on_any_exception():
    """PR-B's whole retry story depends on this: run_pipeline() only ever
    re-raises exceptions its error taxonomy already classified as retryable
    (everything else is swallowed into a returned PipelineResult before it
    gets here), so it's correct — not overly broad — for the celery task
    boundary to autoretry on any Exception that reaches it."""
    assert run_collection.autoretry_for == (Exception,)
    assert run_collection.max_retries == 3
    assert run_collection.default_retry_delay == 60


def test_run_scheduled_collection_uses_same_retry_policy():
    assert run_scheduled_collection.autoretry_for == run_collection.autoretry_for
    assert run_scheduled_collection.max_retries == run_collection.max_retries
    assert run_scheduled_collection.default_retry_delay == run_collection.default_retry_delay


def test_scheduled_retries_reuse_celery_request_as_occurrence_id():
    registered = run_scheduled_collection._get_current_object()
    registered.push_request(id="occurrence-1", hostname="worker-1")

    async def fake_pipeline(*args, **kwargs):
        return {"args": args, "kwargs": kwargs}

    try:
        with patch("backend.pipeline.runner.run_scheduled_pipeline", new=fake_pipeline):
            result = registered.run("schedule-1", "source-1", {"cursor": "next"})
    finally:
        registered.pop_request()

    assert result["kwargs"] == {
        "occurrence_id": "occurrence-1",
        "celery_task_id": "occurrence-1",
        "worker_id": "worker-1",
    }


# ── P1 (test/ops audit): retry-exhausted alert ─────────────────────────────


def test_run_collection_uses_alert_on_exhaustion_task_base():
    """The task must actually be wired to the base class that emits the
    exhaustion signal — otherwise this whole feature is dead code.
    ``run_collection`` is a celery ``PromiseProxy``, so check the registered
    task instance's actual class instead of isinstance on the proxy."""
    from backend.worker.celery_app import celery_app

    registered = celery_app.tasks["run_collection"]
    assert isinstance(registered, _AlertOnRetriesExhaustedTask)


@pytest.mark.asyncio
async def test_mark_retries_exhausted_sets_task_run_error_detail(db_session):
    """The signal lands on the most recent TaskRun's error_detail (no schema
    change — the column already exists) and an event is emitted, so a source
    whose every retry failed is distinguishable from a single one-off failure."""
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask, TaskRun
    from backend.worker.tasks import _mark_retries_exhausted

    source = DataSource(
        name="Retry Exhausted Source",
        channel_type="rss",
        channel_config={"feed_url": "https://ex.com/feed.xml"},
    )
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()
    run = TaskRun(task_id=task.id, status="failed")
    db_session.add(run)
    await db_session.flush()
    await db_session.commit()

    emitted = []

    async def fake_emit(run_id, step, message, level="info", detail=None, elapsed_ms=None):
        emitted.append({"run_id": run_id, "level": level, "detail": detail})

    class _Cm:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *exc):
            return False

    with (
        patch("backend.database.AsyncSessionLocal", return_value=_Cm()),
        patch("backend.pipeline.events.emit", new=fake_emit),
    ):
        await _mark_retries_exhausted(task.id, retries=3, max_retries=3, error="boom")

    await db_session.refresh(run)
    assert run.error_detail["retries_exhausted"] is True
    assert run.error_detail["retries"] == 3
    assert run.error_detail["max_retries"] == 3

    assert len(emitted) == 1
    assert emitted[0]["level"] == "error"
    assert emitted[0]["detail"]["retries_exhausted"] is True


def _bound_task(retries: int, max_retries: int = 3) -> _AlertOnRetriesExhaustedTask:
    """A real task instance bound to the app (so ``request_stack``/``request``
    work like they do for an actual celery-dispatched task), with a fake
    request pushed carrying just the retry count ``on_failure`` reads."""
    from backend.worker.celery_app import celery_app

    task = _AlertOnRetriesExhaustedTask()
    task.bind(celery_app)
    task.max_retries = max_retries
    task.push_request(retries=retries)
    return task


def test_on_failure_emits_signal_when_retries_exhausted():
    """The Task.on_failure hook fires the exhaustion signal exactly when
    request.retries has reached max_retries (the terminal attempt) — not on
    every intermediate retry."""
    task = _bound_task(retries=3, max_retries=3)

    # _run_async is mocked out (it's exercised for real in
    # test_mark_retries_exhausted_sets_task_run_error_detail above), so the
    # coroutine it receives is never actually awaited here — close it
    # explicitly to avoid an unrelated "coroutine was never awaited" warning.
    def _closing_side_effect(coro):
        coro.close()

    with patch(
        "backend.worker.tasks._run_async", side_effect=_closing_side_effect
    ) as run_async_mock:
        task.on_failure(RuntimeError("boom"), "celery-id-1", ("task-1",), {}, None)

    run_async_mock.assert_called_once()
    task.pop_request()


def test_on_failure_no_signal_when_retries_not_exhausted():
    """An intermediate failure (celery will still retry) must NOT emit the
    exhaustion signal — only the terminal attempt does."""
    task = _bound_task(retries=1, max_retries=3)

    with patch("backend.worker.tasks._run_async") as run_async_mock:
        task.on_failure(RuntimeError("boom"), "celery-id-1", ("task-1",), {}, None)

    run_async_mock.assert_not_called()
    task.pop_request()
