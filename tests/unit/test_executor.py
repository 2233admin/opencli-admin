"""Unit tests for backend executor modules."""

import asyncio
import threading
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.executor import local as local_executor_module


@pytest.fixture(autouse=True)
def _clear_pipeline_semaphore_registry():
    """AUDIT C6's semaphore registry is a module-level dict keyed by event
    loop id (mirrors backend.pipeline.domain_limiter._semaphores). Clear it
    around every test in this file so a stale entry from a prior test's
    (closed) event loop can never be reused just because CPython recycled
    its id() for a new loop object."""
    local_executor_module._pipeline_semaphores.clear()
    yield
    local_executor_module._pipeline_semaphores.clear()


# ── LocalExecutor ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_local_executor_dispatch_acquisition():
    from backend.executor.local import LocalExecutor

    executor = LocalExecutor()
    with patch(
        "backend.acquisition.runner.run_acquisition_execution",
        new=AsyncMock(return_value=None),
    ) as runner:
        await executor.dispatch_acquisition("execution-1")
        await asyncio.sleep(0)

    runner.assert_awaited_once_with("execution-1")


@pytest.mark.asyncio
async def test_local_executor_cancel_acquisition_stops_the_running_task():
    from backend.executor.local import LocalExecutor

    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def run(_execution_id):
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    executor = LocalExecutor()
    with patch("backend.acquisition.runner.run_acquisition_execution", new=run):
        await executor.dispatch_acquisition("execution-1")
        await started.wait()
        await executor.cancel_acquisition("execution-1")

    assert cancelled.is_set()

@pytest.mark.asyncio
async def test_local_executor_dispatch_collection():
    """dispatch_collection creates an asyncio Task and returns task_id."""
    from backend.executor.local import LocalExecutor

    executor = LocalExecutor()

    with patch("backend.pipeline.runner.run_collection_pipeline", new=AsyncMock(return_value={})):
        result = await executor.dispatch_collection("task-123", {"limit": 5})

    assert result["task_id"] == "task-123"
    # Allow background task to finish
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_local_executor_dispatch_scheduled_collection():
    """dispatch_scheduled_collection creates an asyncio Task (no return value)."""
    from backend.executor.local import LocalExecutor

    executor = LocalExecutor()

    with patch("backend.pipeline.runner.run_scheduled_pipeline", new=AsyncMock(return_value={})):
        await executor.dispatch_scheduled_collection("sched-1", "src-1", {})

    # Allow background task to complete
    await asyncio.sleep(0)


# ── LocalExecutor: AUDIT C5 (task reference retention) ─────────────────────────

@pytest.mark.asyncio
async def test_local_executor_collection_task_retained_while_inflight_and_popped_after():
    """dispatch_collection's task is held in a strong-reference dict for as
    long as the pipeline is running, and popped once it completes — the fix
    for C5 (an unreferenced create_task can be GC'd mid-flight)."""
    from backend.executor.local import LocalExecutor

    gate = asyncio.Event()

    async def fake_pipeline(task_id, parameters):
        await gate.wait()
        return {}

    executor = LocalExecutor()
    with patch("backend.pipeline.runner.run_collection_pipeline", new=fake_pipeline):
        result = await executor.dispatch_collection("task-abc", {})
        await asyncio.sleep(0)

        assert result == {"task_id": "task-abc"}
        assert "task-abc" in executor._collection_tasks
        task = executor._collection_tasks["task-abc"]
        assert isinstance(task, asyncio.Task)
        assert not task.done()

        gate.set()
        await task
        await asyncio.sleep(0)  # let the pop done-callback run

    assert "task-abc" not in executor._collection_tasks


@pytest.mark.asyncio
async def test_local_executor_scheduled_collection_skips_when_prior_run_inflight():
    """A schedule whose previous run hasn't finished yet is skipped rather
    than dispatched again — mirrors dispatch_acquisition's existing
    skip-if-inflight precedent (AUDIT C5)."""
    from backend.executor.local import LocalExecutor

    gate = asyncio.Event()
    calls: list[tuple] = []

    async def fake_scheduled_pipeline(schedule_id, source_id, parameters):
        calls.append((schedule_id, source_id, parameters))
        await gate.wait()
        return {}

    executor = LocalExecutor()
    with patch("backend.pipeline.runner.run_scheduled_pipeline", new=fake_scheduled_pipeline):
        await executor.dispatch_scheduled_collection("sched-1", "src-1", {"a": 1})
        await asyncio.sleep(0)
        assert "sched-1" in executor._scheduled_collection_tasks
        first_task = executor._scheduled_collection_tasks["sched-1"]

        # Second tick while the first run is still in-flight must be a no-op.
        await executor.dispatch_scheduled_collection("sched-1", "src-1", {"a": 2})
        await asyncio.sleep(0)
        assert executor._scheduled_collection_tasks["sched-1"] is first_task

        gate.set()
        await first_task
        await asyncio.sleep(0)

    assert len(calls) == 1
    assert calls[0] == ("sched-1", "src-1", {"a": 1})
    assert "sched-1" not in executor._scheduled_collection_tasks


@pytest.mark.asyncio
async def test_local_executor_scheduled_collection_dispatches_again_once_prior_run_done():
    """Skip-if-inflight is not a permanent lockout: once a run finishes, the
    next tick for the same schedule_id dispatches a fresh task."""
    from backend.executor.local import LocalExecutor

    calls: list[str] = []

    async def fake_scheduled_pipeline(schedule_id, source_id, parameters):
        calls.append(schedule_id)
        return {}

    executor = LocalExecutor()
    with patch("backend.pipeline.runner.run_scheduled_pipeline", new=fake_scheduled_pipeline):
        await executor.dispatch_scheduled_collection("sched-1", "src-1", {})
        await asyncio.sleep(0)
        await executor.dispatch_scheduled_collection("sched-1", "src-1", {})
        await asyncio.sleep(0)

    assert calls == ["sched-1", "sched-1"]


# ── LocalExecutor: AUDIT C6 (global pipeline concurrency semaphore) ────────────

@pytest.mark.asyncio
async def test_local_executor_pipeline_semaphore_bounds_concurrency(monkeypatch):
    """AUDIT C6: no more than settings.local_max_concurrent_pipelines
    collection runs execute at once, even when more are dispatched than
    that (mirrors backend/pipeline/domain_limiter's own peak-concurrency
    test style: real tiny hold + asyncio.gather + peak check).

    AUDIT C5: every dispatched task — including the ones that will have to
    wait on the semaphore — is referenced in _collection_tasks the instant
    it's created, well before any of them finish."""
    from backend.config import get_settings
    from backend.executor.local import LocalExecutor

    monkeypatch.setenv("LOCAL_MAX_CONCURRENT_PIPELINES", "2")
    get_settings.cache_clear()
    try:
        state = {"cur": 0, "peak": 0}

        async def fake_pipeline(task_id, parameters):
            state["cur"] += 1
            state["peak"] = max(state["peak"], state["cur"])
            await asyncio.sleep(0.02)
            state["cur"] -= 1
            return {}

        executor = LocalExecutor()
        with patch("backend.pipeline.runner.run_collection_pipeline", new=fake_pipeline):
            for i in range(6):
                await executor.dispatch_collection(f"task-{i}", {})

            # All 6 are referenced immediately, before any of them have run
            # far enough to finish — none can be silently GC'd (C5), whether
            # they're running or still queued behind the semaphore.
            assert len(executor._collection_tasks) == 6

            await asyncio.gather(*list(executor._collection_tasks.values()))

        assert state["peak"] == 2
    finally:
        get_settings.cache_clear()


# ── Settings: local_max_concurrent_pipelines (AUDIT C6) ────────────────────────

def test_settings_local_max_concurrent_pipelines_defaults_to_eight():
    from backend.config import Settings

    assert Settings().local_max_concurrent_pipelines == 8


def test_settings_local_max_concurrent_pipelines_honors_env_override(monkeypatch):
    from backend.config import Settings

    monkeypatch.setenv("LOCAL_MAX_CONCURRENT_PIPELINES", "3")

    assert Settings().local_max_concurrent_pipelines == 3


def test_log_task_exception_logs_error():
    """_log_task_exception logs when task has an unhandled exception."""
    from backend.executor.local import _log_task_exception

    task = MagicMock()
    task.cancelled.return_value = False
    task.exception.return_value = RuntimeError("task error")

    # Should not raise
    with patch("backend.executor.local.logger") as mock_logger:
        _log_task_exception(task)
        mock_logger.exception.assert_called_once()


def test_log_task_exception_skips_cancelled():
    """_log_task_exception does nothing for cancelled tasks."""
    from backend.executor.local import _log_task_exception

    task = MagicMock()
    task.cancelled.return_value = True

    with patch("backend.executor.local.logger") as mock_logger:
        _log_task_exception(task)
        mock_logger.exception.assert_not_called()


def test_log_task_exception_skips_no_exception():
    """_log_task_exception does nothing when task has no exception."""
    from backend.executor.local import _log_task_exception

    task = MagicMock()
    task.cancelled.return_value = False
    task.exception.return_value = None

    with patch("backend.executor.local.logger") as mock_logger:
        _log_task_exception(task)
        mock_logger.exception.assert_not_called()


# ── get_executor ───────────────────────────────────────────────────────────────

def test_get_executor_returns_local_executor():
    """get_executor returns LocalExecutor when task_executor=local."""
    from backend.executor import get_executor
    from backend.executor.local import LocalExecutor

    # Clear lru_cache to get fresh executor
    get_executor.cache_clear()

    with patch("backend.config.get_settings") as mock_settings:
        mock_settings.return_value.task_executor = "local"
        executor = get_executor()

    assert isinstance(executor, LocalExecutor)
    get_executor.cache_clear()


# ── CeleryExecutor ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_celery_executor_dispatch_acquisition():
    from backend.executor.celery_exec import CeleryExecutor

    executor = CeleryExecutor()
    task = MagicMock()
    with patch("backend.worker.tasks.run_acquisition", task):
        await executor.dispatch_acquisition("execution-1")

    task.apply_async.assert_called_once_with(
        kwargs={"execution_id": "execution-1"},
        task_id="acquisition:execution-1",
    )


@pytest.mark.asyncio
async def test_celery_executor_cancel_acquisition_revokes_without_orphaning_subprocess():
    from backend.executor.celery_exec import CeleryExecutor

    executor = CeleryExecutor()
    with patch("backend.worker.celery_app.celery_app.control.revoke") as revoke:
        await executor.cancel_acquisition("execution-1")

    revoke.assert_called_once_with("acquisition:execution-1", terminate=False)

@pytest.mark.asyncio
async def test_celery_executor_dispatch_collection():
    """CeleryExecutor.dispatch_collection calls apply_async and returns task_id."""
    from backend.executor.celery_exec import CeleryExecutor

    executor = CeleryExecutor()

    mock_result = MagicMock()
    mock_result.id = "celery-task-abc"

    mock_task = MagicMock()
    mock_task.apply_async = MagicMock(return_value=mock_result)

    with patch("backend.worker.tasks.run_collection", mock_task):
        result = await executor.dispatch_collection("task-999", {"p": 1})

    assert result["task_id"] == "task-999"
    assert result["celery_task_id"] == "celery-task-abc"
    mock_task.apply_async.assert_called_once_with(
        kwargs={"task_id": "task-999", "parameters": {"p": 1}}
    )


@pytest.mark.asyncio
async def test_celery_executor_dispatch_scheduled_collection():
    """CeleryExecutor.dispatch_scheduled_collection calls apply_async."""
    from backend.executor.celery_exec import CeleryExecutor

    executor = CeleryExecutor()

    mock_task = MagicMock()
    mock_task.apply_async = MagicMock(return_value=MagicMock())

    with patch("backend.worker.tasks.run_scheduled_collection", mock_task):
        await executor.dispatch_scheduled_collection("sched-1", "src-1", {"k": "v"})

    mock_task.apply_async.assert_called_once_with(
        kwargs={"schedule_id": "sched-1", "source_id": "src-1", "parameters": {"k": "v"}}
    )


# ── CeleryExecutor: AUDIT C9 (apply_async off the event loop) ──────────────────

@pytest.mark.asyncio
async def test_celery_executor_dispatch_collection_offloads_apply_async_to_thread():
    """apply_async is invoked through asyncio.to_thread rather than directly,
    so the broker round-trip never runs inline on the event loop (C9)."""
    from backend.executor.celery_exec import CeleryExecutor

    executor = CeleryExecutor()
    mock_result = MagicMock()
    mock_result.id = "celery-task-abc"
    mock_task = MagicMock()
    mock_task.apply_async = MagicMock(return_value=mock_result)

    with (
        patch("backend.worker.tasks.run_collection", mock_task),
        patch(
            "backend.executor.celery_exec.asyncio.to_thread",
            new=AsyncMock(side_effect=lambda fn, **kw: fn(**kw)),
        ) as to_thread_mock,
    ):
        result = await executor.dispatch_collection("task-999", {"p": 1})

    to_thread_mock.assert_called_once_with(
        mock_task.apply_async, kwargs={"task_id": "task-999", "parameters": {"p": 1}}
    )
    assert result == {"task_id": "task-999", "celery_task_id": "celery-task-abc"}


@pytest.mark.asyncio
async def test_celery_executor_dispatch_scheduled_collection_offloads_apply_async_to_thread():
    """Same off-loop guarantee for the scheduled-dispatch path (C9)."""
    from backend.executor.celery_exec import CeleryExecutor

    executor = CeleryExecutor()
    mock_task = MagicMock()
    mock_task.apply_async = MagicMock(return_value=MagicMock())

    with (
        patch("backend.worker.tasks.run_scheduled_collection", mock_task),
        patch(
            "backend.executor.celery_exec.asyncio.to_thread",
            new=AsyncMock(side_effect=lambda fn, **kw: fn(**kw)),
        ) as to_thread_mock,
    ):
        await executor.dispatch_scheduled_collection("sched-1", "src-1", {"k": "v"})

    to_thread_mock.assert_called_once_with(
        mock_task.apply_async,
        kwargs={"schedule_id": "sched-1", "source_id": "src-1", "parameters": {"k": "v"}},
    )


@pytest.mark.asyncio
async def test_celery_executor_dispatch_collection_does_not_block_event_loop():
    """AUDIT C9, end-to-end with the real asyncio.to_thread: while
    apply_async is 'in flight' (blocking its worker thread), other
    coroutines scheduled on this same loop keep making progress instead of
    stalling behind the broker round-trip."""
    from backend.executor.celery_exec import CeleryExecutor

    executor = CeleryExecutor()
    release = threading.Event()

    def slow_apply_async(**kwargs):
        # Stands in for a slow/blocking broker round-trip. A thread-safe
        # (not asyncio) primitive because this runs in a to_thread worker
        # thread, not on the event loop.
        if not release.wait(timeout=2):
            raise AssertionError("test never released the blocking call")
        result = MagicMock()
        result.id = "celery-task-abc"
        return result

    mock_task = MagicMock()
    mock_task.apply_async = slow_apply_async

    probe_ticks = 0

    async def probe():
        nonlocal probe_ticks
        for _ in range(20):
            await asyncio.sleep(0.01)
            probe_ticks += 1

    with patch("backend.worker.tasks.run_collection", mock_task):
        dispatch_task = asyncio.create_task(executor.dispatch_collection("task-999", {}))
        probe_task = asyncio.create_task(probe())

        # Give dispatch_collection a moment to reach and block inside
        # to_thread's worker thread.
        await asyncio.sleep(0.05)
        ticks_while_blocked = probe_ticks
        release.set()

        result = await dispatch_task
        await probe_task

    assert ticks_while_blocked > 0, "event loop made no progress while apply_async was in flight"
    assert result == {"task_id": "task-999", "celery_task_id": "celery-task-abc"}
