"""DailyDigest build/read logic (PR-G, GOAL-5.md 架构决策 #10).

``build_digest_for_date`` is the only writer of ``daily_digests`` rows. It is
invoked by a scheduled job (see backend/worker/tasks.py's ``run_daily_digest``
Celery task and backend/worker/digest_job.py's standalone entrypoint — PR-G's
report explains why two hooks exist), not computed on read, and not
computed in real time inside the public API layer: ``backend/api/public/
daily.py`` only ever reads rows this module already wrote.

Idempotency (PR-G acceptance criterion): calling ``build_digest_for_date``
twice for the same date never creates a second ``daily_digests`` row — the
existing row for that date is updated in place (upsert via select-then-
insert-or-update, the same pattern ``backend.services.tag_service.
_get_or_create_tag`` already uses for a similar "don't duplicate" need).

Empty-day handling (PR-G acceptance criterion): a date with zero qualifying
``public=True AND curated=True`` records is not an error — it produces a
``DailyDigest`` row with ``record_ids == []``.
"""

from datetime import date as date_type, datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.digest import DailyDigest
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.services.public_content_service import MAX_TAKE, query_public_records


def _day_bounds_utc(target_date: date_type) -> tuple[datetime, datetime]:
    """[start, end) UTC ``datetime`` bounds for ``target_date`` — a half-open
    window handed to ``query_public_records``'s ``since``/``until`` params
    (see that module's docstring for why ``created_at``, not
    ``normalized_data.published_at``, is the safe column to range-filter
    on)."""
    start = datetime.combine(target_date, time.min, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


async def build_digest_for_date(session: AsyncSession, target_date: date_type) -> DailyDigest:
    """Build or rebuild (upsert) the ``daily_digests`` row for ``target_date``.

    Queries ``PublicContentService.query_public_records`` for that day's
    ``public=True AND curated=True`` records (``mode="selected"`` — the same
    gate PR-E/PR-F reuse rather than re-implement, per GOAL-5.md 架构决策 #7)
    within ``target_date``'s UTC calendar-day window, snapshots their ids
    into ``record_ids`` (newest first, matching query order), and upserts a
    single row keyed by ``date``.

    Capped at ``PublicContentService.MAX_TAKE`` (200) records per day — the
    same hard cap ``query_public_records`` enforces on every other caller
    (see that module's docstring: "no combination of parameters can force an
    unbounded scan"). A day with more than 200 curated+public records only
    snapshots the newest 200; this is an intentional inherited limit, not a
    bug introduced here.
    """
    start, end = _day_bounds_utc(target_date)
    records = await query_public_records(
        session, mode="selected", since=start, until=end, take=MAX_TAKE
    )
    record_ids = [r.id for r in records]

    existing = await get_digest_by_date(session, target_date)
    if existing is not None:
        existing.record_ids = record_ids
        await session.flush()
        await session.refresh(existing)
        return existing

    digest = DailyDigest(date=target_date, record_ids=record_ids)
    session.add(digest)
    await session.flush()
    await session.refresh(digest)
    return digest


async def get_digest_by_date(session: AsyncSession, target_date: date_type) -> Optional[DailyDigest]:
    """Return the ``daily_digests`` row for ``target_date``, or ``None`` if
    it hasn't been built yet."""
    result = await session.execute(select(DailyDigest).where(DailyDigest.date == target_date))
    return result.scalar_one_or_none()


async def get_latest_digest(session: AsyncSession) -> Optional[DailyDigest]:
    """Most recent digest ordered by ``date`` (not ``created_at``/
    ``updated_at``) — rebuilding an older date should never outrank a
    genuinely more recent date just because it happened to be rebuilt more
    recently. Backs ``GET /api/public/daily``'s "today's digest, or most
    recent available" behavior: if today's row exists it has the max
    ``date`` and wins; otherwise the next most recent row is returned."""
    result = await session.execute(select(DailyDigest).order_by(DailyDigest.date.desc()).limit(1))
    return result.scalar_one_or_none()


async def list_digest_dates(session: AsyncSession, take: int = 30) -> list[DailyDigest]:
    """Most recent ``take`` digests, newest date first — backs
    ``GET /api/public/dailies?take=N``. Negative ``take`` collapses to 0
    (same "nonsensical input degrades to empty, not an error" convention
    ``PublicContentService._normalize_take`` uses)."""
    take = max(0, take)
    if take == 0:
        return []
    result = await session.execute(select(DailyDigest).order_by(DailyDigest.date.desc()).limit(take))
    return list(result.scalars().all())


async def get_records_for_digest(session: AsyncSession, digest: DailyDigest) -> list[CollectedRecord]:
    """Resolve ``digest.record_ids`` back to ``CollectedRecord`` rows,
    re-applying the ``DataSource.public`` hard gate at read time — not just
    at snapshot-build time. GOAL-5.md 架构决策 #2/#7's "public=True" invariant
    applies to every public-facing read path; a digest built while a source
    was public must stop surfacing that source's records if the source is
    later flipped private, exactly like every other public endpoint.

    Preserves ``digest.record_ids``' order (build-time newest-first),
    silently dropping any id that no longer resolves to a public-source
    record rather than erroring.
    """
    if not digest.record_ids:
        return []

    result = await session.execute(
        select(CollectedRecord)
        .join(DataSource, DataSource.id == CollectedRecord.source_id)
        .where(DataSource.public.is_(True), CollectedRecord.id.in_(digest.record_ids))
    )
    records_by_id = {r.id: r for r in result.scalars().all()}
    return [records_by_id[rid] for rid in digest.record_ids if rid in records_by_id]
