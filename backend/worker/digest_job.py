"""Standalone entrypoint to build/rebuild today's daily digest snapshot.

PR-G (GOAL-5.md 架构决策 #10: "独立定时任务(复用现有 pipeline 调度基建,没有就加最简单
cron 任务)").

This branch (feat/agent-access-taxonomy) *does* have real scheduling
infrastructure already: backend/scheduler.py (a local asyncio loop, active
when TASK_EXECUTOR=local, the default — see backend/config.py) and Celery
Beat (active when TASK_EXECUTOR=celery; see docker-compose.yml's `beat`
service). Both are gated by the already-locked `task_executor` setting
(GOAL-5.md's own stop-condition explicitly says to follow that gate rather
than re-litigating it), so this PR follows it rather than inventing a third
mode:

- TASK_EXECUTOR=celery: reuse Celery Beat directly. backend/worker/
  celery_app.py now carries a static `daily-digest-snapshot` beat_schedule
  entry that fires backend/worker/tasks.py's `run_daily_digest` task once a
  day. No new file needed for this path — this module's `run_once` is what
  that task calls.
- TASK_EXECUTOR=local (default): there is no in-process beat process at all
  in this mode, and the existing local scheduler (backend/scheduler.py) is
  hard-wired to `CronSchedule`, a per-DataSource collection schedule whose
  `source_id` column is a required, non-nullable FK — a daily digest isn't
  scoped to one source, so reusing it would mean loosening that FK's
  nullability and teaching backend/scheduler.py's tested collection-dispatch
  loop (tests/unit/test_scheduler.py) a second, unrelated job type. That is
  more invasive than this feature warrants for one PR (see GOAL-5.md's own
  guidance: keep it small, don't merge in a whole new scheduler). Instead,
  this module is the "simplest possible standalone cron-like mechanism": a
  plain script entrypoint an external OS-level scheduler (cron, Windows
  Task Scheduler, etc.) can invoke once a day, e.g.:

      uv run python -m backend.worker.digest_job

  It runs once and exits — it deliberately does not start any new
  in-process loop/thread.

Tradeoff, stated plainly: this means TASK_EXECUTOR=local deployments do not
get automatic daily-digest scheduling out of the box the way collection
schedules do; an operator must wire up one external cron entry. That is the
explicit, minimal-footprint choice here rather than extending CronSchedule's
schema and backend/scheduler.py's dispatch loop to understand a second kind
of job.
"""

import asyncio
import logging
import sys
from datetime import date as date_type, datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)


async def run_once(target_date: Optional[date_type] = None) -> dict:
    """Build/rebuild the digest for `target_date` (defaults to "today" in
    UTC) and commit it. Idempotent — see backend.services.digest_service.
    build_digest_for_date."""
    from backend.database import AsyncSessionLocal
    from backend.services import digest_service

    resolved_date = target_date or datetime.now(timezone.utc).date()
    async with AsyncSessionLocal() as session:
        digest = await digest_service.build_digest_for_date(session, resolved_date)
        await session.commit()
        result = {"date": resolved_date.isoformat(), "record_count": len(digest.record_ids)}
        logger.info("Daily digest built: %s", result)
        return result


def main(argv: Optional[list[str]] = None) -> int:
    """CLI entrypoint: `uv run python -m backend.worker.digest_job [YYYY-MM-DD]`.
    With no argument, builds today's (UTC) digest."""
    argv = sys.argv[1:] if argv is None else argv
    target_date = date_type.fromisoformat(argv[0]) if argv else None
    asyncio.run(run_once(target_date))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
