"""Keep redbeat's redis-backed schedule entries in sync with CronSchedule rows.

redbeat (the RedBeatScheduler backend, see celery_app.py) checks redis on
every tick, so a write here takes effect on the next tick — no beat restart
needed. This is what actually closes the "changed a schedule, still waiting
for the old one to fire" gap; the DB row alone was never enough once beat
only reads it at startup (see worker/beat_schedule.py — used for populate,
not for ongoing sync).
"""

import logging

from backend.models.schedule import CronSchedule

logger = logging.getLogger(__name__)


def _entry_name(schedule_id: str) -> str:
    return f"schedule-{schedule_id}"


def sync_entry(schedule: CronSchedule) -> None:
    """Create/update the redbeat entry for an enabled schedule; remove it
    when the schedule is disabled."""
    if not schedule.enabled:
        remove_entry(schedule.id)
        return

    from redbeat import RedBeatSchedulerEntry

    from backend.worker.beat_schedule import parse_cron_expression
    from backend.worker.celery_app import celery_app

    RedBeatSchedulerEntry(
        name=_entry_name(schedule.id),
        task="run_scheduled_collection",
        schedule=parse_cron_expression(schedule.cron_expression),
        kwargs={
            "schedule_id": schedule.id,
            "source_id": schedule.source_id,
            "parameters": schedule.parameters,
        },
        app=celery_app,
    ).save()


def remove_entry(schedule_id: str) -> None:
    """Best-effort delete. A schedule that was created disabled (so never
    saved to redbeat) has no entry to remove — that's not an error."""
    from redbeat import RedBeatSchedulerEntry

    from backend.worker.celery_app import celery_app

    key = RedBeatSchedulerEntry.generate_key(app=celery_app, name=_entry_name(schedule_id))
    try:
        RedBeatSchedulerEntry.from_key(key, app=celery_app).delete()
    except KeyError:
        pass


async def populate_all() -> None:
    """One-time bulk sync: write a redbeat entry for every currently-enabled
    schedule. Call once at process startup (task_executor == "celery" only)
    so redis reflects the DB's current state before the first tick, instead
    of waiting for each schedule's next individual create/update.

    Async because its only caller (main.py's lifespan) is already inside a
    running event loop — wrapping in asyncio.new_event_loop().run_until_complete()
    the way worker/tasks.py's celery-thread helper does would raise
    "Cannot run the event loop while another loop is running" here.
    """
    from sqlalchemy import select

    from backend.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(CronSchedule).where(CronSchedule.enabled.is_(True)))
            schedules = list(result.scalars().all())
    except Exception as exc:
        logger.warning("redbeat populate_all: could not load DB schedules: %s", exc)
        return

    for schedule in schedules:
        try:
            sync_entry(schedule)
        except Exception as exc:
            logger.warning("redbeat populate_all: failed for schedule %s: %s", schedule.id, exc)
