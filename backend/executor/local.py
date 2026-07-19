"""Local in-process executor — runs pipeline directly via asyncio."""

import asyncio
import logging

from backend.config import get_settings
from backend.executor.base import AbstractExecutor

logger = logging.getLogger(__name__)

# AUDIT C6: process-wide cap on concurrently-RUNNING pipeline executions
# (manual/webhook dispatch_collection + every dispatch_scheduled_collection),
# independent of the per-domain cap in pipeline/domain_limiter.py. Keyed by
# event loop id, mirroring domain_limiter._semaphore, so a semaphore is never
# reused across event loops (production runs one loop and shares correctly;
# tests get a fresh loop each and never touch a stale entry).
_pipeline_semaphores: dict[int, asyncio.Semaphore] = {}


def _pipeline_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    key = id(loop)
    sem = _pipeline_semaphores.get(key)
    if sem is None:
        sem = asyncio.Semaphore(get_settings().local_max_concurrent_pipelines)
        _pipeline_semaphores[key] = sem
    return sem


def _log_task_exception(task: asyncio.Task) -> None:
    """Log any unhandled exception from a background asyncio task."""
    if not task.cancelled() and task.exception():
        logger.exception(
            "Background pipeline task failed: %s",
            task.exception(),
            exc_info=task.exception(),
        )


class LocalExecutor(AbstractExecutor):
    def __init__(self) -> None:
        self._acquisition_tasks: dict[str, asyncio.Task[None]] = {}
        # AUDIT C5: distinct dicts from _acquisition_tasks — task_id (manual/
        # webhook dispatch) and schedule_id (scheduled dispatch) are different
        # id spaces, so each gets its own strong-reference table instead of
        # sharing one dict with two key schemes.
        self._collection_tasks: dict[str, asyncio.Task[dict]] = {}
        self._scheduled_collection_tasks: dict[str, asyncio.Task[dict]] = {}

    async def dispatch_acquisition(self, execution_id: str) -> None:
        from backend.acquisition.runner import run_acquisition_execution

        current = self._acquisition_tasks.get(execution_id)
        if current is not None and not current.done():
            return
        task = asyncio.create_task(run_acquisition_execution(execution_id))
        task.add_done_callback(_log_task_exception)
        self._acquisition_tasks[execution_id] = task
        task.add_done_callback(
            lambda completed: self._acquisition_tasks.pop(execution_id, None)
            if self._acquisition_tasks.get(execution_id) is completed
            else None
        )

    async def cancel_acquisition(self, execution_id: str) -> None:
        task = self._acquisition_tasks.get(execution_id)
        if task is None or task.done():
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _run_collection(self, task_id: str, parameters: dict) -> dict:
        from backend.pipeline.runner import run_collection_pipeline

        # AUDIT C6: the semaphore wraps execution, not dispatch — the task
        # blocks on it here, inside itself, so dispatch_collection stays fast
        # and non-blocking.
        async with _pipeline_semaphore():
            return await run_collection_pipeline(task_id, parameters)

    async def _run_scheduled(
        self, schedule_id: str, source_id: str, parameters: dict
    ) -> dict:
        from backend.pipeline.runner import run_scheduled_pipeline

        async with _pipeline_semaphore():
            return await run_scheduled_pipeline(schedule_id, source_id, parameters)

    async def dispatch_collection(self, task_id: str, parameters: dict) -> dict:
        # AUDIT C5: hold a strong reference exactly like dispatch_acquisition
        # does. task_id is unique per call (each manual/webhook trigger has
        # its own CollectionTask row), so unlike dispatch_scheduled_collection
        # below there is no skip-if-inflight check — just track-and-pop. The
        # task is stored before it can even attempt to acquire the semaphore,
        # so it stays referenced (and un-GC'd) for the whole time it's
        # blocked waiting on _pipeline_semaphore(), not just while running.
        task = asyncio.create_task(self._run_collection(task_id, parameters))
        task.add_done_callback(_log_task_exception)
        self._collection_tasks[task_id] = task
        task.add_done_callback(
            lambda completed: self._collection_tasks.pop(task_id, None)
            if self._collection_tasks.get(task_id) is completed
            else None
        )
        return {"task_id": task_id}

    async def dispatch_scheduled_collection(
        self, schedule_id: str, source_id: str, parameters: dict
    ) -> None:
        # AUDIT C5: schedule_id has no per-run unique id at dispatch time (a
        # schedule fires the same schedule_id on every tick), so this mirrors
        # dispatch_acquisition's skip-if-inflight precedent — a schedule whose
        # previous run hasn't finished yet is skipped rather than allowed to
        # overlap itself.
        current = self._scheduled_collection_tasks.get(schedule_id)
        if current is not None and not current.done():
            return
        task = asyncio.create_task(
            self._run_scheduled(schedule_id, source_id, parameters)
        )
        task.add_done_callback(_log_task_exception)
        self._scheduled_collection_tasks[schedule_id] = task
        task.add_done_callback(
            lambda completed: self._scheduled_collection_tasks.pop(schedule_id, None)
            if self._scheduled_collection_tasks.get(schedule_id) is completed
            else None
        )
