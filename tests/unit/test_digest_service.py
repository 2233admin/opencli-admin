"""Tests for backend/services/digest_service.py (PR-G, GOAL-5.md).

Covers the two explicit PR-G acceptance criteria — idempotency (rebuilding a
date never duplicates the row or its record_ids) and the empty-day case (zero
qualifying records is a valid, non-error digest) — plus the
get_records_for_digest re-check that a digest never re-surfaces a record
whose source has since gone private (mirrors PR-D/PR-E's adversarial-param
security tests).
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask
from backend.services import digest_service


async def _make_source(db_session, *, public: bool, name: str = "Source") -> DataSource:
    source = DataSource(
        name=name,
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed.xml"},
        public=public,
    )
    db_session.add(source)
    await db_session.flush()
    return source


async def _make_task(db_session, source: DataSource) -> CollectionTask:
    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()
    return task


async def _make_record(
    db_session,
    source: DataSource,
    task: CollectionTask,
    *,
    curated: bool = True,
    title: str = "Untitled",
    created_at: datetime | None = None,
) -> CollectedRecord:
    record = CollectedRecord(
        task_id=task.id,
        source_id=source.id,
        raw_data={"title": title},
        normalized_data={"title": title, "url": "https://ex.com", "content": ""},
        content_hash=str(uuid.uuid4()),
        status="ai_processed",
        curated=curated,
    )
    if created_at is not None:
        record.created_at = created_at
    db_session.add(record)
    await db_session.flush()
    return record


# ── Idempotency ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_build_digest_twice_does_not_duplicate_row(db_session):
    """PR-G acceptance criterion: running build_digest_for_date twice for the
    same date must produce exactly one row, not two."""
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    target = date(2026, 7, 1)
    now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    await _make_record(db_session, source, task, created_at=now)
    await db_session.commit()

    first = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()
    second = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()

    assert first.id == second.id

    from sqlalchemy import func, select

    from backend.models.digest import DailyDigest

    count = (
        await db_session.execute(
            select(func.count()).select_from(DailyDigest).where(DailyDigest.date == target)
        )
    ).scalar_one()
    assert count == 1


@pytest.mark.asyncio
async def test_build_digest_twice_does_not_duplicate_record_ids(db_session):
    """PR-G acceptance criterion: rebuilding must not duplicate record_ids
    either (each id appears once, not twice)."""
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    target = date(2026, 7, 1)
    now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    record = await _make_record(db_session, source, task, created_at=now)
    await db_session.commit()

    await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()
    digest = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()

    assert digest.record_ids.count(record.id) == 1
    assert digest.record_ids == [record.id]


@pytest.mark.asyncio
async def test_rebuild_picks_up_newly_curated_records(db_session):
    """Rebuilding isn't a no-op — it reflects the current data, e.g. a
    record curated after the first build appears once rebuilt."""
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    target = date(2026, 7, 1)
    now = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    first_record = await _make_record(db_session, source, task, created_at=now)
    await db_session.commit()

    digest = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()
    assert digest.record_ids == [first_record.id]

    second_record = await _make_record(
        db_session, source, task, created_at=now + timedelta(minutes=5)
    )
    await db_session.commit()

    rebuilt = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()

    assert set(rebuilt.record_ids) == {first_record.id, second_record.id}


# ── Empty-day case ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_day_builds_digest_with_no_records_without_error(db_session):
    """PR-G acceptance criterion: a date with zero public+curated records
    does not raise — it produces a digest with an empty record list."""
    target = date(2026, 7, 2)

    digest = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()

    assert digest.record_ids == []
    assert digest.date == target


@pytest.mark.asyncio
async def test_empty_day_excludes_uncurated_and_private_records(db_session):
    """An empty digest for a date that actually has records — just none that
    are both public-source and curated."""
    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    private_source = await _make_source(db_session, public=False, name="Private")
    private_task = await _make_task(db_session, private_source)

    target = date(2026, 7, 3)
    now = datetime(2026, 7, 3, 8, 0, tzinfo=timezone.utc)
    await _make_record(db_session, public_source, public_task, curated=False, created_at=now)
    await _make_record(db_session, private_source, private_task, curated=True, created_at=now)
    await db_session.commit()

    digest = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()

    assert digest.record_ids == []


# ── Day-boundary correctness ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_digest_excludes_records_from_adjacent_days(db_session):
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    target = date(2026, 7, 5)

    in_day = await _make_record(
        db_session, source, task, created_at=datetime(2026, 7, 5, 23, 59, tzinfo=timezone.utc)
    )
    before_day = await _make_record(
        db_session, source, task, created_at=datetime(2026, 7, 4, 23, 59, tzinfo=timezone.utc)
    )
    after_day = await _make_record(
        db_session, source, task, created_at=datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc)
    )
    await db_session.commit()

    digest = await digest_service.build_digest_for_date(db_session, target)

    assert digest.record_ids == [in_day.id]
    assert before_day.id not in digest.record_ids
    assert after_day.id not in digest.record_ids


# ── get_latest_digest / list_digest_dates ────────────────────────────────


@pytest.mark.asyncio
async def test_get_latest_digest_returns_max_date_not_most_recently_built(db_session):
    """Rebuilding an older date more recently must not make it "latest" —
    ordering is by `date`, not created_at/updated_at."""
    older = date(2026, 6, 1)
    newer = date(2026, 6, 15)

    await digest_service.build_digest_for_date(db_session, newer)
    await db_session.commit()
    # Rebuild the older date afterwards (bumps its updated_at) — should not
    # change which one is "latest".
    await digest_service.build_digest_for_date(db_session, older)
    await db_session.commit()
    await digest_service.build_digest_for_date(db_session, older)
    await db_session.commit()

    latest = await digest_service.get_latest_digest(db_session)
    assert latest.date == newer


@pytest.mark.asyncio
async def test_get_latest_digest_none_when_no_digests_exist(db_session):
    assert await digest_service.get_latest_digest(db_session) is None


@pytest.mark.asyncio
async def test_list_digest_dates_orders_newest_first_and_respects_take(db_session):
    dates = [date(2026, 6, 1), date(2026, 6, 2), date(2026, 6, 3)]
    for d in dates:
        await digest_service.build_digest_for_date(db_session, d)
        await db_session.commit()

    result = await digest_service.list_digest_dates(db_session, take=2)

    assert [d.date for d in result] == [date(2026, 6, 3), date(2026, 6, 2)]


@pytest.mark.asyncio
async def test_list_digest_dates_negative_take_returns_empty(db_session):
    await digest_service.build_digest_for_date(db_session, date(2026, 6, 1))
    await db_session.commit()

    result = await digest_service.list_digest_dates(db_session, take=-5)

    assert result == []


# ── get_records_for_digest: private-source re-check at read time ────────


@pytest.mark.asyncio
async def test_get_records_for_digest_excludes_record_whose_source_went_private(db_session):
    """A digest snapshot references record_ids, but if the parent source is
    flipped private after the snapshot was built, get_records_for_digest
    must not resolve that id back to a record — the public=True gate applies
    at read time too, not just at build time."""
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    target = date(2026, 7, 10)
    record = await _make_record(
        db_session, source, task, created_at=datetime(2026, 7, 10, 1, 0, tzinfo=timezone.utc)
    )
    await db_session.commit()

    digest = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()
    assert digest.record_ids == [record.id]

    # Flip the source private after the snapshot was taken.
    source.public = False
    await db_session.commit()

    records = await digest_service.get_records_for_digest(db_session, digest)

    assert records == []


@pytest.mark.asyncio
async def test_get_records_for_digest_returns_records_in_snapshot_order(db_session):
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    target = date(2026, 7, 11)
    r1 = await _make_record(
        db_session, source, task, created_at=datetime(2026, 7, 11, 1, 0, tzinfo=timezone.utc)
    )
    r2 = await _make_record(
        db_session, source, task, created_at=datetime(2026, 7, 11, 2, 0, tzinfo=timezone.utc)
    )
    await db_session.commit()

    digest = await digest_service.build_digest_for_date(db_session, target)
    await db_session.commit()

    records = await digest_service.get_records_for_digest(db_session, digest)

    assert [r.id for r in records] == digest.record_ids
    assert {r.id for r in records} == {r1.id, r2.id}


@pytest.mark.asyncio
async def test_get_records_for_digest_empty_record_ids_short_circuits(db_session):
    from backend.models.digest import DailyDigest

    digest = DailyDigest(date=date(2026, 7, 12), record_ids=[])
    db_session.add(digest)
    await db_session.flush()

    records = await digest_service.get_records_for_digest(db_session, digest)

    assert records == []
