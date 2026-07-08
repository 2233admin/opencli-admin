from celery import Celery
from celery.schedules import crontab

from backend.config import get_settings

settings = get_settings()

celery_app = Celery(
    "opencli_admin",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["backend.worker.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone=settings.default_timezone,
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=86400,  # 1 day
)

# PR-G (GOAL-5.md 架构决策 #10): daily digest snapshot, scheduled independently
# of the DB-driven per-source CronSchedule entries (backend/worker/
# beat_schedule.py's build_beat_schedule() — not currently wired into this
# static config; see that module's docstring). This static entry fires once
# a day at 00:10 UTC whenever a `celery -A backend.worker.celery_app beat`
# process is running (TASK_EXECUTOR=celery deployments — see
# docker-compose.yml's `beat` service). TASK_EXECUTOR=local deployments (the
# default) have no beat process at all; see backend/worker/digest_job.py's
# standalone entrypoint for that mode instead.
celery_app.conf.beat_schedule = {
    "daily-digest-snapshot": {
        "task": "run_daily_digest",
        "schedule": crontab(hour=0, minute=10),
    },
}
