"""Local in-process executor — runs pipeline directly via asyncio."""

import asyncio
import logging

from backend.executor.base import AbstractExecutor

logger = logging.getLogger(__name__)


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

    async def dispatch_collection(self, task_id: str, parameters: dict) -> dict:
        from backend.pipeline.runner import run_collection_pipeline
        t = asyncio.create_task(run_collection_pipeline(task_id, parameters))
        t.add_done_callback(_log_task_exception)
        return {"task_id": task_id}

    async def dispatch_scheduled_collection(
        self, schedule_id: str, source_id: str, parameters: dict
    ) -> None:
        from backend.pipeline.runner import run_scheduled_pipeline
        t = asyncio.create_task(run_scheduled_pipeline(schedule_id, source_id, parameters))
        t.add_done_callback(_log_task_exception)
