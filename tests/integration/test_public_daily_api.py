"""Integration tests for /api/public/daily, /api/public/daily/{date},
/api/public/dailies (PR-G, GOAL-5.md).

Mirrors tests/integration/test_public_api.py's fixture/helper patterns (same
public/private source isolation setup), driven through the real router
rather than digest_service directly (see tests/unit/test_digest_service.py
for that layer).
"""

import uuid
from datetime import date, datetime, timezone

import pytest

from backend.api.public.throttle import limiter
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask
from backend.services import digest_service, tag_service


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Same rationale as test_public_api.py's fixture of the same name — the
    token bucket in backend/api/public/throttle.py is a single module-level
    singleton shared by every route on public_router."""
    original_capacity = limiter.capacity
    original_refill_rate = limiter.refill_rate
    limiter.reset()
    yield
    limiter.capacity = original_capacity
    limiter.refill_rate = original_refill_rate
    limiter.reset()


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
        raw_data={"title": title, "internal_secret": "should-never-leak"},
        normalized_data={
            "title": title,
            "url": "https://example.com/article",
            "content": "some body text",
            "published_at": "2026-01-01T00:00:00Z",
        },
        content_hash=str(uuid.uuid4()),
        status="ai_processed",
        curated=curated,
    )
    if created_at is not None:
        record.created_at = created_at
    db_session.add(record)
    await db_session.flush()
    return record


@pytest.mark.asyncio
async def test_get_daily_404_when_no_digest_exists_yet(client):
    response = await client.get("/api/public/daily")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_daily_returns_most_recent_digest(client, db_session):
    source = await _make_source(db_session, public=True, name="Public")
    task = await _make_task(db_session, source)
    record = await _make_record(
        db_session, source, task, title="Today Item",
        created_at=datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc),
    )
    await tag_service.bind_category(db_session, record.id, "模型能力")
    await db_session.commit()

    await digest_service.build_digest_for_date(db_session, date(2026, 6, 1))
    await db_session.commit()
    await digest_service.build_digest_for_date(db_session, date(2026, 7, 1))
    await db_session.commit()

    response = await client.get("/api/public/daily")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["date"] == "2026-07-01"
    assert len(data["records"]) == 1
    item = data["records"][0]
    assert item["id"] == record.id
    assert item["title"] == "Today Item"
    assert item["category"] == "模型能力"


@pytest.mark.asyncio
async def test_get_daily_by_date_returns_specific_digest(client, db_session):
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    record = await _make_record(
        db_session, source, task,
        created_at=datetime(2026, 5, 10, 9, 0, tzinfo=timezone.utc),
    )
    await db_session.commit()

    await digest_service.build_digest_for_date(db_session, date(2026, 5, 10))
    await db_session.commit()

    response = await client.get("/api/public/daily/2026-05-10")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["date"] == "2026-05-10"
    assert {r["id"] for r in data["records"]} == {record.id}


@pytest.mark.asyncio
async def test_get_daily_by_date_404_for_missing_date(client, db_session):
    await digest_service.build_digest_for_date(db_session, date(2026, 5, 10))
    await db_session.commit()

    response = await client.get("/api/public/daily/2026-05-11")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_daily_by_date_empty_day_returns_200_with_empty_records(client, db_session):
    """Empty-day digest via the HTTP layer: zero qualifying records for a
    date is a valid 200 response with an empty records list, not an error."""
    await digest_service.build_digest_for_date(db_session, date(2026, 8, 1))
    await db_session.commit()

    response = await client.get("/api/public/daily/2026-08-01")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["records"] == []


@pytest.mark.asyncio
async def test_dailies_lists_dates_newest_first_and_respects_take(client, db_session):
    for d in (date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3)):
        await digest_service.build_digest_for_date(db_session, d)
        await db_session.commit()

    response = await client.get("/api/public/dailies", params={"take": 2})

    assert response.status_code == 200
    data = response.json()["data"]
    assert [d["date"] for d in data] == ["2026-01-03", "2026-01-02"]


@pytest.mark.asyncio
async def test_dailies_record_count_reflects_snapshot_size(client, db_session):
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    await _make_record(
        db_session, source, task, created_at=datetime(2026, 2, 1, 1, 0, tzinfo=timezone.utc)
    )
    await _make_record(
        db_session, source, task, created_at=datetime(2026, 2, 1, 2, 0, tzinfo=timezone.utc)
    )
    await db_session.commit()

    await digest_service.build_digest_for_date(db_session, date(2026, 2, 1))
    await db_session.commit()

    response = await client.get("/api/public/dailies")
    data = response.json()["data"]
    entry = next(e for e in data if e["date"] == "2026-02-01")
    assert entry["record_count"] == 2


@pytest.mark.asyncio
async def test_daily_digest_never_leaks_internal_fields(client, db_session):
    """Whitelist check for the digest's embedded records — same forbidden-key
    assertion style as test_public_api.py's whitelist test (架构决策 #11)."""
    source = await _make_source(db_session, public=True)
    task = await _make_task(db_session, source)
    await _make_record(
        db_session, source, task, created_at=datetime(2026, 3, 1, 1, 0, tzinfo=timezone.utc)
    )
    await db_session.commit()

    await digest_service.build_digest_for_date(db_session, date(2026, 3, 1))
    await db_session.commit()

    response = await client.get("/api/public/daily/2026-03-01")
    item = response.json()["data"]["records"][0]

    forbidden_keys = {
        "raw_data", "normalized_data", "ai_enrichment", "source_id", "task_id",
        "content_hash", "status", "error_message", "created_at", "updated_at",
        "internal_secret",
    }
    for key in forbidden_keys:
        assert key not in item, f"forbidden field {key!r} leaked into digest response: {item}"


@pytest.mark.asyncio
async def test_daily_digest_excludes_record_whose_source_went_private_after_snapshot(
    client, db_session
):
    """Private-source isolation guarantee (matching PR-D/PR-E): a record
    referenced by an already-built digest must not appear once its source
    is flipped private, even though the snapshot itself is static."""
    source = await _make_source(db_session, public=True, name="Public")
    task = await _make_task(db_session, source)
    record = await _make_record(
        db_session, source, task, created_at=datetime(2026, 4, 1, 1, 0, tzinfo=timezone.utc)
    )
    await db_session.commit()

    await digest_service.build_digest_for_date(db_session, date(2026, 4, 1))
    await db_session.commit()

    source.public = False
    await db_session.commit()

    response = await client.get("/api/public/daily/2026-04-01")

    assert response.status_code == 200
    data = response.json()["data"]
    assert record.id not in {r["id"] for r in data["records"]}
    assert data["records"] == []
