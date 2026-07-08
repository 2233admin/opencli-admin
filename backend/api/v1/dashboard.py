"""Dashboard statistics endpoint."""

from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.notification import NotificationLog, NotificationRule
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask, TaskRun
from backend.schemas.common import ApiResponse

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _display_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return "、".join(str(item) for item in value if str(item).strip())
    if isinstance(value, dict):
        return "、".join(f"{key}: {val}" for key, val in value.items())
    return str(value)


def _title_from_record(record: CollectedRecord) -> str:
    data = record.normalized_data or record.raw_data or {}
    for key in ("title", "name", "text", "content", "url"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "(无标题)"


def _url_from_record(record: CollectedRecord) -> str | None:
    data = record.normalized_data or record.raw_data or {}
    value = data.get("url") or data.get("link")
    return value if isinstance(value, str) and value.strip() else None


def _summary_from_ai(ai: dict[str, Any] | None) -> str:
    if not ai:
        return ""
    for key in ("summary", "abstract", "brief", "摘要"):
        if value := _display_text(ai.get(key)):
            return value
    return ""


def _tags_from_ai(ai: dict[str, Any] | None) -> list[str]:
    if not ai:
        return []
    raw = ai.get("tags") or ai.get("labels") or ai.get("keywords") or ai.get("关键词")
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        return [part.strip() for part in raw.replace("，", ",").split(",") if part.strip()]
    return []


def _sentiment_from_ai(ai: dict[str, Any] | None) -> str:
    if not ai:
        return "unknown"
    raw = ai.get("sentiment") or ai.get("情绪") or ai.get("polarity")
    if isinstance(raw, dict):
        raw = raw.get("label") or raw.get("value")
    value = str(raw).strip().lower() if raw is not None else ""
    return value or "unknown"


def _parse_time_range(
    range: str,
    start: datetime | None,
    end: datetime | None,
) -> tuple[datetime | None, datetime | None]:
    """Return (since, until) UTC datetimes for the given range string."""
    now = datetime.now(UTC)
    if range == "today":
        since = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return since, None
    if range == "yesterday":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        since = today_start - timedelta(days=1)
        return since, today_start
    if range == "7d":
        return now - timedelta(days=7), None
    if range == "30d":
        return now - timedelta(days=30), None
    if range == "custom":
        return start, end
    return None, None  # "all"


@router.get("/stats", response_model=ApiResponse[dict])
async def get_stats(
    range: str = Query(
        "all",
        description="Time range: all | today | yesterday | 7d | 30d | custom",
    ),
    start: datetime | None = Query(None, description="Custom range start (ISO 8601, UTC)"),
    end: datetime | None = Query(None, description="Custom range end (ISO 8601, UTC)"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    since, until = _parse_time_range(range, start, end)

    # ── Source counts (not time-filtered — these are global config) ───────────
    total_sources = (await db.execute(select(func.count()).select_from(DataSource))).scalar_one()
    enabled_sources = (
        await db.execute(
            select(func.count()).select_from(DataSource).where(DataSource.enabled.is_(True))
        )
    ).scalar_one()

    # ── Task counts (based on CollectionTask status — global) ─────────────────
    total_tasks = (await db.execute(select(func.count()).select_from(CollectionTask))).scalar_one()
    running_tasks = (
        await db.execute(
            select(func.count())
            .select_from(CollectionTask)
            .where(CollectionTask.status == "running")
        )
    ).scalar_one()
    failed_tasks = (
        await db.execute(
            select(func.count())
            .select_from(CollectionTask)
            .where(CollectionTask.status == "failed")
        )
    ).scalar_one()

    # ── TaskRun counts (time-filtered) ────────────────────────────────────────
    run_q = select(func.count()).select_from(TaskRun)
    if since:
        run_q = run_q.where(TaskRun.created_at >= since)
    if until:
        run_q = run_q.where(TaskRun.created_at < until)

    run_success_q = run_q.where(TaskRun.status == "completed")
    run_failed_q = run_q.where(TaskRun.status == "failed")

    run_success = (await db.execute(run_success_q)).scalar_one()
    run_failed = (await db.execute(run_failed_q)).scalar_one()
    run_total = run_success + run_failed + (
        await db.execute(run_q.where(TaskRun.status == "running"))
    ).scalar_one()

    # ── Record counts (time-filtered) ─────────────────────────────────────────
    rec_q = select(func.count()).select_from(CollectedRecord)
    if since:
        rec_q = rec_q.where(CollectedRecord.created_at >= since)
    if until:
        rec_q = rec_q.where(CollectedRecord.created_at < until)

    total_records = (await db.execute(rec_q)).scalar_one()
    ai_processed_records = (
        await db.execute(rec_q.where(CollectedRecord.status == "ai_processed"))
    ).scalar_one()

    # ── Recent task runs (time-filtered, last 10) ─────────────────────────────
    recent_q = (
        select(TaskRun, CollectionTask, DataSource)
        .join(CollectionTask, TaskRun.task_id == CollectionTask.id)
        .join(DataSource, CollectionTask.source_id == DataSource.id)
        .order_by(TaskRun.created_at.desc())
        .limit(10)
    )
    if since:
        recent_q = recent_q.where(TaskRun.created_at >= since)
    if until:
        recent_q = recent_q.where(TaskRun.created_at < until)

    recent_runs_result = await db.execute(recent_q)
    recent_runs = recent_runs_result.all()

    return ApiResponse.ok(
        {
            "sources": {
                "total": total_sources,
                "enabled": enabled_sources,
                "disabled": total_sources - enabled_sources,
            },
            "tasks": {
                "total": total_tasks,
                "running": running_tasks,
                "failed": failed_tasks,
            },
            "runs": {
                "total": run_total,
                "success": run_success,
                "failed": run_failed,
                "success_rate": round(run_success / run_total * 100, 1) if run_total > 0 else 0.0,
            },
            "records": {
                "total": total_records,
                "ai_processed": ai_processed_records,
            },
            "recent_runs": [
                {
                    "id": run.id,
                    "task_id": run.task_id,
                    "task_trigger_type": task.trigger_type,
                    "source_name": source.name,
                    "status": run.status,
                    "records_collected": run.records_collected,
                    "duration_ms": run.duration_ms,
                    "created_at": run.created_at.isoformat(),
                }
                for run, task, source in recent_runs
            ],
        }
    )


@router.get("/activity", response_model=ApiResponse[dict])
async def get_activity(
    days: int = Query(7, ge=1, le=30, description="Number of past days to include"),
    tz_offset: int = Query(
        8,
        ge=-12,
        le=14,
        description="Client UTC offset in hours (default: +8 CST)",
    ),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    """Return per-day task run and record counts for the past N days.

    Uses the client's UTC offset so that day boundaries align with local time.
    """
    now_utc = datetime.now(UTC)
    tz_delta = timedelta(hours=tz_offset)
    now_local = now_utc + tz_delta
    today_local = now_local.date()

    # Build list of dates from (today - days + 1) to today
    date_range = [today_local - timedelta(days=i) for i in range(days - 1, -1, -1)]
    since_utc = datetime.combine(date_range[0], datetime.min.time()) - tz_delta
    since_utc = since_utc.replace(tzinfo=UTC)

    # ── Task runs grouped by local date ──────────────────────────────────────
    # Shift created_at to local time before truncating to date
    local_date_expr = func.date(
        func.datetime(TaskRun.created_at, f"{'+' if tz_offset >= 0 else ''}{tz_offset} hours")
    )
    runs_q = (
        select(
            local_date_expr.label("day"),
            func.count().label("total_runs"),
            func.sum(case((TaskRun.status == "completed", 1), else_=0)).label("success_runs"),
            func.sum(case((TaskRun.status == "failed", 1), else_=0)).label("failed_runs"),
        )
        .where(TaskRun.created_at >= since_utc)
        .group_by("day")
    )
    runs_rows = {str(row.day): row for row in (await db.execute(runs_q)).all()}

    # ── Records grouped by local date ─────────────────────────────────────────
    local_rec_date_expr = func.date(
        func.datetime(
            CollectedRecord.created_at,
            f"{'+' if tz_offset >= 0 else ''}{tz_offset} hours",
        )
    )
    recs_q = (
        select(
            local_rec_date_expr.label("day"),
            func.count().label("new_records"),
        )
        .where(CollectedRecord.created_at >= since_utc)
        .group_by("day")
    )
    recs_rows = {str(row.day): row.new_records for row in (await db.execute(recs_q)).all()}

    # ── Merge into ordered list ───────────────────────────────────────────────
    daily = []
    for d in date_range:
        key = str(d)
        run = runs_rows.get(key)
        daily.append({
            "date": key,
            "total_runs": int(run.total_runs) if run else 0,
            "success_runs": int(run.success_runs) if run else 0,
            "failed_runs": int(run.failed_runs) if run else 0,
            "new_records": recs_rows.get(key, 0),
        })

    return ApiResponse.ok({"daily": daily})


@router.get("/opinion-monitor", response_model=ApiResponse[dict])
async def get_opinion_monitor(
    range: str = Query(
        "7d",
        description="Time range: all | today | yesterday | 7d | 30d | custom",
    ),
    start: datetime | None = Query(None, description="Custom range start (ISO 8601, UTC)"),
    end: datetime | None = Query(None, description="Custom range end (ISO 8601, UTC)"),
    limit: int = Query(20, ge=1, le=100, description="Recent records to return"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    """Opinion-monitor projection over real collection, AI, and push evidence.

    This is deliberately read-only: it summarizes records, AI enrichment, and
    Feishu notification logs already produced by the pipeline instead of
    pretending to send or enrich anything at dashboard read time.
    """
    since, until = _parse_time_range(range, start, end)

    def apply_window(query):
        if since:
            query = query.where(CollectedRecord.created_at >= since)
        if until:
            query = query.where(CollectedRecord.created_at < until)
        return query

    total_records = (
        await db.execute(apply_window(select(func.count()).select_from(CollectedRecord)))
    ).scalar_one()
    ai_processed_records = (
        await db.execute(
            apply_window(
                select(func.count())
                .select_from(CollectedRecord)
                .where(CollectedRecord.ai_enrichment.is_not(None))
            )
        )
    ).scalar_one()
    active_sources = (
        await db.execute(
            apply_window(select(func.count(func.distinct(CollectedRecord.source_id))))
        )
    ).scalar_one()

    feishu_status_rows = await db.execute(
        apply_window(
            select(NotificationLog.status, func.count())
            .select_from(NotificationLog)
            .join(CollectedRecord, NotificationLog.record_id == CollectedRecord.id)
            .join(NotificationRule, NotificationLog.rule_id == NotificationRule.id)
            .where(NotificationRule.notifier_type == "feishu")
            .group_by(NotificationLog.status)
        )
    )
    feishu_status_counts = {
        status: int(count) for status, count in feishu_status_rows.all()
    }

    records_query = (
        select(CollectedRecord, DataSource)
        .join(DataSource, CollectedRecord.source_id == DataSource.id)
        .order_by(CollectedRecord.created_at.desc())
        .limit(max(limit, 100))
    )
    records_query = apply_window(records_query)

    rows = (await db.execute(records_query)).all()
    records = [record for record, _source in rows]
    record_ids = [record.id for record in records]

    notification_by_record: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    if record_ids:
        notification_rows = await db.execute(
            select(
                NotificationLog.record_id,
                NotificationLog.status,
                NotificationRule.notifier_type,
            )
            .join(NotificationRule, NotificationLog.rule_id == NotificationRule.id)
            .where(NotificationLog.record_id.in_(record_ids))
        )
        for record_id, status, notifier_type in notification_rows.all():
            if record_id and notifier_type == "feishu":
                notification_by_record[record_id][status] += 1

    tag_counts: Counter[str] = Counter()
    sentiment_counts: Counter[str] = Counter()
    source_rows: dict[str, dict[str, Any]] = {}
    recent = []

    for record, source in rows:
        tags = _tags_from_ai(record.ai_enrichment)
        sentiment = _sentiment_from_ai(record.ai_enrichment)
        tag_counts.update(tags)
        sentiment_counts.update([sentiment])

        source_bucket = source_rows.setdefault(
            source.id,
            {
                "id": source.id,
                "name": source.name,
                "channel_type": source.channel_type,
                "records": 0,
                "ai_processed": 0,
                "feishu_sent": 0,
                "feishu_failed": 0,
            },
        )
        source_bucket["records"] += 1
        if record.ai_enrichment:
            source_bucket["ai_processed"] += 1

        notify_counts = notification_by_record.get(record.id, {})
        sent_count = int(notify_counts.get("sent", 0))
        failed_count = int(notify_counts.get("failed", 0))
        source_bucket["feishu_sent"] += sent_count
        source_bucket["feishu_failed"] += failed_count

        if len(recent) < limit:
            notification_status = (
                "sent" if sent_count else "failed" if failed_count else "pending"
            )
            recent.append(
                {
                    "id": record.id,
                    "source_id": source.id,
                    "source_name": source.name,
                    "title": _title_from_record(record),
                    "url": _url_from_record(record),
                    "summary": _summary_from_ai(record.ai_enrichment),
                    "tags": tags,
                    "sentiment": sentiment,
                    "status": record.status,
                    "notification_status": notification_status,
                    "created_at": record.created_at.isoformat(),
                }
            )

    feishu_rules_query = select(func.count()).select_from(NotificationRule).where(
        NotificationRule.enabled.is_(True),
        NotificationRule.notifier_type == "feishu",
    )
    active_feishu_rules = (await db.execute(feishu_rules_query)).scalar_one()

    return ApiResponse.ok(
        {
            "window": {
                "range": range,
                "since": since.isoformat() if since else None,
                "until": until.isoformat() if until else None,
            },
            "summary": {
                "records": total_records,
                "ai_processed": ai_processed_records,
                "feishu_sent": feishu_status_counts.get("sent", 0),
                "feishu_failed": feishu_status_counts.get("failed", 0),
                "active_sources": active_sources,
                "active_feishu_rules": active_feishu_rules,
            },
            "tags": [
                {"label": label, "count": count}
                for label, count in tag_counts.most_common(12)
            ],
            "sentiment": [
                {"label": label, "count": count}
                for label, count in sentiment_counts.most_common()
            ],
            "sources": sorted(
                source_rows.values(),
                key=lambda row: (row["records"], row["ai_processed"]),
                reverse=True,
            ),
            "recent": recent,
        }
    )
