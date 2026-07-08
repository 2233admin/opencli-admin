from datetime import date as date_type
from typing import Optional

from sqlalchemy import Date, JSON, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class DailyDigest(TimestampMixin):
    """A snapshot of one day's public+curated CollectedRecord ids (PR-G,
    GOAL-5.md 架构决策 #10).

    Not computed in real time — ``backend.services.digest_service`` is the
    only writer, invoked by a scheduled job (see backend/worker/tasks.py's
    ``run_daily_digest`` Celery task and backend/worker/digest_job.py's
    standalone entrypoint). Rebuilding a date is an upsert, never a second
    insert: ``date`` carries a DB-level uniqueness constraint (not just an
    application-level convention) so "one row per calendar date" is a real
    invariant, not just something callers are expected to respect.
    """

    __tablename__ = "daily_digests"
    __table_args__ = (UniqueConstraint("date", name="uq_daily_digests_date"),)

    # Calendar date the digest snapshots (a date, not a timestamp — exactly
    # one row per day).
    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    # CollectedRecord.id values captured for this date, in the order
    # PublicContentService.query_public_records returned them (newest first).
    record_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Optional LLM-generated summary of the day's content. No LLM call is
    # wired up in this PR (out of scope per GOAL-5.md PR-G) — the column
    # exists so a future PR can populate it without another migration.
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
