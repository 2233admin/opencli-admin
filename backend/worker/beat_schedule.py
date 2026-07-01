"""Cron-expression parsing shared by the redbeat sync path (worker/redbeat_sync.py).

Used to own a DB-polling ``build_beat_schedule()`` that populated celery's
static ``beat_schedule`` dict once at process startup — but that dict was
never actually wired into ``celery_app.conf`` anywhere, so it was dead code,
and the underlying approach (schedule changes only take effect after a beat
restart) is exactly what redbeat's live redis-backed entries replace. Only
the cron-parsing helper survives; ``worker/redbeat_sync.py`` owns population
and per-change sync now.
"""

from celery.schedules import crontab


def parse_cron_expression(expr: str) -> crontab:
    """Parse a 5-field cron expression into Celery crontab."""
    parts = expr.split()
    if len(parts) != 5:
        raise ValueError(f"Invalid cron expression (need 5 fields): {expr!r}")
    minute, hour, day_of_month, month_of_year, day_of_week = parts
    return crontab(
        minute=minute,
        hour=hour,
        day_of_month=day_of_month,
        month_of_year=month_of_year,
        day_of_week=day_of_week,
    )
