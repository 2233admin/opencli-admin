"""Integration tests for /api/public/rss (PR-F, GOAL-5.md).

Mirrors tests/integration/test_public_api.py's fixture/helper patterns (same
public/private source isolation setup) but drives the Atom-feed endpoint
instead of the JSON REST endpoint, and round-trips the response through
``feedparser`` — the same library backend/channels/rss_channel.py already
uses for ingestion — instead of asserting on JSON shape.
"""

import feedparser
import pytest

from backend.api.public import rss as rss_module
from backend.api.public.throttle import limiter
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask
from backend.services import tag_service


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Same rationale as test_public_api.py's fixture of the same name: the
    token bucket in backend/api/public/throttle.py is a single module-level
    singleton shared by every route on public_router (items AND rss), so it
    must be reset between tests regardless of which sub-router a given test
    file exercises."""
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
        raw_data={"title": title, "internal_secret": "should-never-leak-into-rss"},
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
async def test_rss_feed_round_trips_public_records_and_excludes_private(client, db_session):
    """The core acceptance test from GOAL-5.md's PR-F entry: fetch the feed,
    parse it back with feedparser, and assert the parsed entries reflect
    exactly the public/curated records — private-source records must not
    appear, matching the same isolation pattern already pinned down for
    PR-D/PR-E."""
    private_source = await _make_source(db_session, public=False, name="Private Source")
    private_task = await _make_task(db_session, private_source)
    await _make_record(
        db_session, private_source, private_task, content_hash="rss-priv-1", title="Secret Item"
    )

    public_source = await _make_source(db_session, public=True, name="Public Source")
    public_task = await _make_task(db_session, public_source)
    public_record = await _make_record(
        db_session, public_source, public_task, content_hash="rss-pub-1", title="Public Feed Item"
    )
    await tag_service.bind_category(db_session, public_record.id, "模型能力")
    await tag_service.add_subtags(db_session, public_record.id, ["llm"])
    await db_session.commit()

    response = await client.get("/api/public/rss", params={"mode": "all"})

    assert response.status_code == 200
    assert "application/atom+xml" in response.headers["content-type"]

    parsed = feedparser.parse(response.text)
    assert not parsed.bozo or parsed.entries  # tolerate feedparser's lenient bozo flag

    titles = {entry.get("title") for entry in parsed.entries}
    links = {entry.get("link") for entry in parsed.entries}

    assert "Public Feed Item" in titles
    assert "https://example.com/article" in links
    assert "Secret Item" not in titles

    public_entry = next(e for e in parsed.entries if e.get("title") == "Public Feed Item")
    entry_categories = {t.get("term") for t in public_entry.get("tags", [])}
    assert "模型能力" in entry_categories


@pytest.mark.asyncio
async def test_rss_feed_never_leaks_internal_fields(client, db_session):
    """Whitelist check (架构决策 #11 applied to the feed too): the raw XML
    text must never contain raw_data content — checked against a distinctive
    fixture value, the same style as
    test_public_api.py::test_public_items_response_never_contains_internal_fields."""
    public_source = await _make_source(db_session, public=True, name="Public Source")
    public_task = await _make_task(db_session, public_source)
    await _make_record(
        db_session, public_source, public_task, content_hash="rss-wl-1", title="Whitelist Check"
    )
    await db_session.commit()

    response = await client.get("/api/public/rss", params={"mode": "all"})

    assert response.status_code == 200
    assert "should-never-leak-into-rss" not in response.text
    assert "internal_secret" not in response.text


@pytest.mark.asyncio
async def test_rss_feed_falls_back_to_empty_feed_on_serialization_failure(
    client, db_session, monkeypatch
):
    """Error/fallback path (GOAL-5.md PR-F acceptance criteria): if feed
    serialization raises for any reason, the endpoint must still return 200
    with a valid, empty feed shell — never a 500. Simulated by monkeypatching
    the ``FeedGenerator`` symbol the route module actually calls, so the
    fallback (which is hand-built and does not use FeedGenerator at all)
    is exercised independently of whatever broke."""
    public_source = await _make_source(db_session, public=True, name="Public Source")
    public_task = await _make_task(db_session, public_source)
    await _make_record(
        db_session, public_source, public_task, content_hash="rss-err-1", title="Should Not Appear"
    )
    await db_session.commit()

    def _raise(*args, **kwargs):
        raise RuntimeError("simulated feedgen failure")

    monkeypatch.setattr(rss_module, "FeedGenerator", _raise)

    response = await client.get("/api/public/rss", params={"mode": "all"})

    assert response.status_code == 200
    assert "application/atom+xml" in response.headers["content-type"]

    parsed = feedparser.parse(response.text)
    assert parsed.entries == []
    assert parsed.feed.get("title") == rss_module.FEED_TITLE


@pytest.mark.asyncio
async def test_rss_feed_invalid_category_returns_400(client):
    response = await client.get("/api/public/rss", params={"category": "NotARealCategory"})

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "valid_categories" in detail


@pytest.mark.asyncio
async def test_rss_feed_invalid_mode_returns_400(client):
    response = await client.get("/api/public/rss", params={"mode": "bogus"})

    assert response.status_code == 400
