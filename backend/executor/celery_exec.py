"""Celery-based distributed executor."""

import asyncio
import logging

from backend.executor.base import AbstractExecutor

logger = logging.getLogger(__name__)


class CeleryExecutor(AbstractExecutor):
    async def dispatch_acquisition(self, execution_id: str) -> None:
        from backend.worker.tasks import run_acquisition

        run_acquisition.apply_async(
            kwargs={"execution_id": execution_id},
            task_id=f"acquisition:{execution_id}",
        )

    async def cancel_acquisition(self, execution_id: str) -> None:
        from backend.worker.celery_app import celery_app

        # Queued work is revoked immediately. Running work observes the durable
        # CANCELLED state through its lease monitor and cancels OpenCLI itself,
        # so the browser subprocess is reaped instead of orphaned by a hard
        # worker-process kill.
        celery_app.control.revoke(
            f"acquisition:{execution_id}", terminate=False
        )

    async def dispatch_collection(self, task_id: str, parameters: dict) -> dict:
        from backend.worker.tasks import run_collection

        # AUDIT C9: apply_async is a synchronous broker round-trip (network
        # I/O to Redis/RabbitMQ). Called directly here it would block this
        # event loop for every dispatch; to_thread moves the round-trip off
        # the loop.
        result = await asyncio.to_thread(
            run_collection.apply_async,
            kwargs={"task_id": task_id, "parameters": parameters},
        )
        return {"task_id": task_id, "celery_task_id": result.id}

    async def dispatch_scheduled_collection(
        self, schedule_id: str, source_id: str, parameters: dict
    ) -> None:
        from backend.worker.tasks import run_scheduled_collection

        await asyncio.to_thread(
            run_scheduled_collection.apply_async,
            kwargs={"schedule_id": schedule_id, "source_id": source_id, "parameters": parameters},
        )
