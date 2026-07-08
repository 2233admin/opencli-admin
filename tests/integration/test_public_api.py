"""Integration tests for /api/public/items (PR-E, GOAL-5.md).

Covers: public/private source isolation end-to-end through the real router
(not just PublicContentService directly — see
tests/unit/test_public_content_service.py for that layer), the response
field whitelist (checked as raw JSON dict keys, not just schema shape),
invalid mode/category -> 400, and the IP rate limiter actually being wired
into the router (429 + Retry-After).
"""

import pytest

from backend.api.public.throttle import limiter
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask
from backend.services import tag_service
from backend.taxonomy import TOP_LEVEL_CATEGORIES


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The token bucket in backend/api/public/throttle.py is a module-level
    singleton shared by every request that reaches /api/public/*. httpx's
    ASGITransport reports the same fake client IP ("127.0.0.1") for every
    request made through the `client` fixture, so without resetting between
    tests, earlier tests in this module would eat into later tests' quota
    (and vice versa). Snapshot/restore capacity+refill_rate too, since a
    couple of tests below intentionally shrink them to trigger 429 quickly.
    """
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
    content_hash: str,
    curated: bool = True,
    title: str = "Untitled",
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
        ai_enrichment={"category": "模型能力", "subtags": ["llm"]},
        content_hash=content_hash,
        status="ai_processed",
        curated=curated,
    )
    db_session.add(record)
    await db_session.flush()
    return record


@pytest.mark.asyncio
async def test_public_items_excludes_private_source_records(client, db_session):
    private_source = await _make_source(db_session, public=False, name="Private Source")
    private_task = await _make_task(db_session, private_source)
    private_record = await _make_record(
        db_session, private_source, private_task, content_hash="priv-1", title="Secret"
    )

    public_source = await _make_source(db_session, public=True, name="Public Source")
    public_task = await _make_task(db_session, public_source)
    public_record = await _make_record(
        db_session, public_source, public_task, content_hash="pub-1", title="Public Item"
    )
    await tag_service.bind_category(db_session, public_record.id, "模型能力")
    await tag_service.add_subtags(db_session, public_record.id, ["llm", "release"])
    await db_session.commit()

    response = await client.get("/api/public/items", params={"mode": "all"})

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    items = body["data"]

    ids = {item["id"] for item in items}
    assert public_record.id in ids
    assert private_record.id not in ids

    public_item = next(item for item in items if item["id"] == public_record.id)
    assert public_item["title"] == "Public Item"
    assert public_item["source_name"] == "Public Source"
    assert public_item["category"] == "模型能力"
    assert set(public_item["subtags"]) == {"llm", "release"}


@pytest.mark.asyncio
async def test_public_items_response_never_contains_internal_fields(client, db_session):
    """Whitelist-field-absence assertion: asserts on raw JSON dict KEYS
    directly (not merely that the Pydantic schema validated) — see
    GOAL-5.md 架构决策 #11."""
    public_source = await _make_source(db_session, public=True, name="Public Source")
    public_task = await _make_task(db_session, public_source)
    record = await _make_record(
        db_session, public_source, public_task, content_hash="pub-wl-1", title="Whitelist Check"
    )
    await db_session.commit()

    response = await client.get("/api/public/items", params={"mode": "all"})
    assert response.status_code == 200
    items = response.json()["data"]
    assert len(items) == 1
    item = items[0]

    forbidden_keys = {
        "raw_data",
        "normalized_data",
        "ai_enrichment",
        "source_id",
        "task_id",
        "content_hash",
        "status",
        "error_message",
        "created_at",
        "updated_at",
        "internal_secret",
    }
    for key in forbidden_keys:
        assert key not in item, f"forbidden field {key!r} leaked into public response: {item}"

    allowed_keys = {
        "id", "title", "url", "summary", "source_name", "published_at", "category", "subtags",
    }
    assert set(item.keys()) == allowed_keys
    assert item["id"] == record.id


@pytest.mark.asyncio
async def test_invalid_category_returns_400_with_valid_list(client):
    response = await client.get(
        "/api/public/items", params={"category": "NotARealCategory"}
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "valid_categories" in detail
    assert set(detail["valid_categories"]) == set(TOP_LEVEL_CATEGORIES)


@pytest.mark.asyncio
async def test_invalid_mode_returns_400(client):
    response = await client.get("/api/public/items", params={"mode": "bogus"})

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_rate_limit_returns_429_with_retry_after(client):
    limiter.capacity = 2
    limiter.refill_rate = 2 / 60.0
    limiter.reset()

    r1 = await client.get("/api/public/items")
    r2 = await client.get("/api/public/items")
    r3 = await client.get("/api/public/items")

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r3.status_code == 429
    assert "retry-after" in r3.headers
    assert int(r3.headers["retry-after"]) >= 1


@pytest.mark.asyncio
async def test_rate_limit_dependency_is_wired_into_public_router(client):
    """Lighter integration check that the throttle dependency is actually
    attached to the public router (the pure TokenBucketLimiter logic itself
    is unit-tested in tests/unit/test_throttle.py with a fake clock)."""
    limiter.capacity = 1
    limiter.refill_rate = 0.0
    limiter.reset()

    first = await client.get("/api/public/items")
    second = await client.get("/api/public/items")

    assert first.status_code == 200
    assert second.status_code == 429
