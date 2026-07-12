"""Celery tasks for async pipeline execution."""

import asyncio
import logging
from typing import Any

from celery import Task

from backend.worker.celery_app import celery_app

logger = logging.getLogger(__name__)


def _run_async(coro: Any) -> Any:
    """Run an async coroutine in a Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _AlertOnRetriesExhaustedTask(Task):
    """Emits a distinct, observable signal when a task's retries are exhausted.

    ``autoretry_for=(Exception,)`` already retries any failure; Celery's own
    ``Task.retry()`` re-raises the original exception (instead of scheduling
    another attempt) once ``request.retries >= max_retries``, which is what
    finally lands here in ``on_failure``. Without this, a source going dark
    (every attempt fails) just ends as one more ``failed`` TaskRun row,
    indistinguishable from a single one-off failure — a fleet operator has no
    signal that a source needs attention, just N separately-failed runs (P1,
    错误上浮契约/轮子5). This does not change retry/failure behavior at all,
    it only adds a marker at the terminal-failure point.
    """

    def on_failure(self, exc: BaseException, task_id: str, args: tuple, kwargs: dict, einfo: Any) -> None:
        retries = getattr(self.request, "retries", 0)
        max_retries = self.max_retries or 0
        if retries >= max_retries:
            collection_task_id = args[0] if args else kwargs.get("task_id")
            logger.error(
                "[task:%s] retries exhausted | celery_task_id=%s retries=%d/%d error=%s",
                collection_task_id, task_id, retries, max_retries, exc,
            )
            try:
                _run_async(_mark_retries_exhausted(collection_task_id, retries, max_retries, str(exc)))
            except Exception:
                # Best-effort signal: a failure recording the signal must not
                # mask the original task failure or crash celery's own
                # failure-handling path.
                logger.exception(
                    "[task:%s] failed to record retries-exhausted signal", collection_task_id
                )
        super().on_failure(exc, task_id, args, kwargs, einfo)


async def _mark_retries_exhausted(
    collection_task_id: str | None, retries: int, max_retries: int, error: str
) -> None:
    """Record the retries-exhausted signal on the most recent TaskRun for this
    task, and emit an event so it surfaces in the run's trace/UI too."""
    if not collection_task_id:
        return

    from sqlalchemy import select

    from backend.database import AsyncSessionLocal
    from backend.models.task import TaskRun
    from backend.pipeline import events

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TaskRun)
            .where(TaskRun.task_id == collection_task_id)
            .order_by(TaskRun.created_at.desc())
            .limit(1)
        )
        run = result.scalar_one_or_none()
        if run is None:
            return
        run.error_detail = {
            **(run.error_detail or {}),
            "retries_exhausted": True,
            "retries": retries,
            "max_retries": max_retries,
        }
        run_id = run.id
        await session.commit()

    await events.emit(
        run_id, "complete",
        f"重试已耗尽 | {retries}/{max_retries} 次后仍失败: {error}",
        level="error",
        detail={"retries_exhausted": True, "retries": retries, "max_retries": max_retries},
    )


@celery_app.task(
    bind=True,
    base=_AlertOnRetriesExhaustedTask,
    name="run_collection",
    max_retries=3,
    default_retry_delay=60,
    # run_pipeline() only re-raises exceptions its error taxonomy classified
    # as retryable (backend.pipeline.error_taxonomy.is_retryable) — anything
    # deterministic is already swallowed into a returned PipelineResult
    # before it gets here. So catching broadly at this boundary is correct:
    # the filtering already happened one layer down, not duplicated here.
    autoretry_for=(Exception,),
)
def run_collection(self: Task, task_id: str, parameters: dict | None = None) -> dict:
    """Execute the full collection pipeline for a task."""
    from backend.pipeline.runner import run_collection_pipeline
    return _run_async(run_collection_pipeline(
        task_id,
        parameters or {},
        celery_task_id=self.request.id,
        worker_id=self.request.hostname,
    ))


@celery_app.task(name="run_scheduled_collection")
def run_scheduled_collection(schedule_id: str, source_id: str, parameters: dict | None = None) -> dict:
    """Create a CollectionTask for a scheduled run, execute pipeline, auto-disable if one-time."""
    from backend.pipeline.runner import run_scheduled_pipeline
    return _run_async(run_scheduled_pipeline(schedule_id, source_id, parameters or {}))


@celery_app.task(name="send_notification")
def send_notification(rule_id: str, record_id: str) -> dict:
    """Send a single notification for a rule/record pair."""
    return _run_async(_send_notification_async(rule_id, record_id))


async def _send_notification_async(rule_id: str, record_id: str) -> dict:
    from sqlalchemy import select

    from backend.database import AsyncSessionLocal
    from backend.models.notification import NotificationRule
    from backend.models.record import CollectedRecord
    from backend.notifiers.base import NotificationPayload
    from backend.notifiers.registry import get_notifier
    from backend.pipeline.notifier_dispatch import _normalize_send_result

    async with AsyncSessionLocal() as session:
        rule_result = await session.execute(
            select(NotificationRule).where(NotificationRule.id == rule_id)
        )
        rule = rule_result.scalar_one_or_none()
        if not rule:
            return {"error": f"Rule {rule_id} not found"}

        record_result = await session.execute(
            select(CollectedRecord).where(CollectedRecord.id == record_id)
        )
        record = record_result.scalar_one_or_none()
        if not record:
            return {"error": f"Record {record_id} not found"}

        notifier = get_notifier(rule.notifier_type)
        payload = NotificationPayload(
            event=rule.trigger_event,
            source_id=record.source_id,
            record_id=record.id,
            data=record.normalized_data,
            ai_enrichment=record.ai_enrichment,
        )
        success, _ = _normalize_send_result(await notifier.send(rule.notifier_config, payload))
        return {"success": success, "rule_id": rule_id, "record_id": record_id}
