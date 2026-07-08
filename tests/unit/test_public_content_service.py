"""Tests for PublicContentService (PR-D) — backend/services/public_content_service.py.

Security-critical module: `DataSource.public == True` is a hard, unconditional
predicate. The tests in the "adversarial" section below exist specifically to
prove there is no parameter combination — including the "give me everything"
call (mode="all", no category/since/q filters) — that can surface content
from a non-public source. See GOAL-5.md 架构决策 #7 / PR-D acceptance criteria.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask
from backend.services import public_content_service as svc
from backend.services import tag_service


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
    curated: bool = False,
    title: str = "Untitled",
    content: str = "",
    created_at: datetime | None = None,
) -> CollectedRecord:
    record = CollectedRecord(
        task_id=task.id,
        source_id=source.id,
        raw_data={"title": title},
        normalized_data={"title": title, "content": content, "url": "https://ex.com"},
        content_hash=str(uuid.uuid4()),
        status="normalized",
        curated=curated,
    )
    if created_at is not None:
        record.created_at = created_at
    db_session.add(record)
    await db_session.flush()
    return record


# ── Adversarial: private-source content must never leak ────────────────────


@pytest.mark.asyncio
async def test_private_source_never_leaks_via_give_me_everything_call(db_session):
    """The maximally permissive call a caller can make: mode="all" (drops the
    curated requirement), no category, no since, empty q. Must still exclude
    every record whose source is private."""
    private_source = await _make_source(db_session, public=False, name="Private")
    private_task = await _make_task(db_session, private_source)
    private_record = await _make_record(
        db_session, private_source, private_task, curated=True, title="Secret Leak Candidate"
    )

    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    public_record = await _make_record(
        db_session, public_source, public_task, curated=True, title="Public Item"
    )

    results = await svc.query_public_records(
        db_session, mode="all", category=None, since=None, q="", take=None
    )
    result_ids = {r.id for r in results}

    assert private_record.id not in result_ids
    assert public_record.id in result_ids


@pytest.mark.asyncio
async def test_private_source_never_leaks_even_with_since_that_would_include_it(db_session):
    private_source = await _make_source(db_session, public=False, name="Private")
    private_task = await _make_task(db_session, private_source)
    old_cutoff = datetime.now(timezone.utc) - timedelta(days=365)
    private_record = await _make_record(
        db_session, private_source, private_task, curated=True,
        created_at=datetime.now(timezone.utc),
    )

    results = await svc.query_public_records(
        db_session, mode="all", since=old_cutoff, take=200
    )

    assert private_record.id not in {r.id for r in results}


@pytest.mark.asyncio
async def test_private_source_never_leaks_when_category_matches(db_session):
    """Even if a private-source record is bound to the requested category,
    the public-source gate still excludes it."""
    private_source = await _make_source(db_session, public=False, name="Private")
    private_task = await _make_task(db_session, private_source)
    private_record = await _make_record(db_session, private_source, private_task, curated=True)
    await tag_service.bind_category(db_session, private_record.id, "模型能力")

    results = await svc.query_public_records(
        db_session, mode="all", category="模型能力", take=200
    )

    assert private_record.id not in {r.id for r in results}


@pytest.mark.asyncio
async def test_private_source_never_leaks_when_q_matches_content(db_session):
    private_source = await _make_source(db_session, public=False, name="Private")
    private_task = await _make_task(db_session, private_source)
    private_record = await _make_record(
        db_session, private_source, private_task, curated=True, title="uniquesecretword"
    )

    results = await svc.query_public_records(
        db_session, mode="all", q="uniquesecretword", take=200
    )

    assert private_record.id not in {r.id for r in results}


@pytest.mark.asyncio
async def test_private_source_never_leaks_in_default_mode(db_session):
    private_source = await _make_source(db_session, public=False, name="Private")
    private_task = await _make_task(db_session, private_source)
    private_record = await _make_record(db_session, private_source, private_task, curated=True)

    # Default call: no args besides session.
    results = await svc.query_public_records(db_session)

    assert private_record.id not in {r.id for r in results}


# ── Normal cases ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_mixed_public_private_default_mode_returns_only_public_curated(db_session):
    private_source = await _make_source(db_session, public=False, name="Private")
    private_task = await _make_task(db_session, private_source)
    await _make_record(db_session, private_source, private_task, curated=True)

    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    curated_public = await _make_record(db_session, public_source, public_task, curated=True)
    uncurated_public = await _make_record(db_session, public_source, public_task, curated=False)

    results = await svc.query_public_records(db_session)  # mode="selected" default
    result_ids = {r.id for r in results}

    assert result_ids == {curated_public.id}
    assert uncurated_public.id not in result_ids


@pytest.mark.asyncio
async def test_mode_all_drops_curated_requirement_but_keeps_public_gate(db_session):
    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    curated_public = await _make_record(db_session, public_source, public_task, curated=True)
    uncurated_public = await _make_record(db_session, public_source, public_task, curated=False)

    results = await svc.query_public_records(db_session, mode="all")
    result_ids = {r.id for r in results}

    assert result_ids == {curated_public.id, uncurated_public.id}


@pytest.mark.asyncio
async def test_category_filter_returns_only_matching_category(db_session):
    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    record_a = await _make_record(db_session, public_source, public_task, curated=True)
    record_b = await _make_record(db_session, public_source, public_task, curated=True)
    await tag_service.bind_category(db_session, record_a.id, "模型能力")
    await tag_service.bind_category(db_session, record_b.id, "行业资讯")

    results = await svc.query_public_records(db_session, mode="all", category="模型能力")

    assert {r.id for r in results} == {record_a.id}


@pytest.mark.asyncio
async def test_invalid_category_raises_value_error(db_session):
    with pytest.raises(ValueError):
        await svc.query_public_records(db_session, category="不存在的分类")


@pytest.mark.asyncio
async def test_invalid_mode_raises_value_error(db_session):
    with pytest.raises(ValueError):
        await svc.query_public_records(db_session, mode="bogus")


@pytest.mark.asyncio
async def test_since_filters_out_older_records(db_session):
    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    now = datetime.now(timezone.utc)
    old_record = await _make_record(
        db_session, public_source, public_task, curated=True,
        created_at=now - timedelta(days=10),
    )
    new_record = await _make_record(
        db_session, public_source, public_task, curated=True,
        created_at=now,
    )

    results = await svc.query_public_records(
        db_session, mode="all", since=now - timedelta(days=1)
    )
    result_ids = {r.id for r in results}

    assert new_record.id in result_ids
    assert old_record.id not in result_ids


@pytest.mark.asyncio
async def test_q_keyword_search_is_case_insensitive_substring_match(db_session):
    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    match = await _make_record(
        db_session, public_source, public_task, curated=True, title="Awesome LLM Release"
    )
    no_match = await _make_record(
        db_session, public_source, public_task, curated=True, title="Unrelated Item"
    )

    results = await svc.query_public_records(db_session, mode="all", q="llm release")
    result_ids = {r.id for r in results}

    assert match.id in result_ids
    assert no_match.id not in result_ids


@pytest.mark.asyncio
async def test_take_limits_result_count(db_session):
    public_source = await _make_source(db_session, public=True, name="Public")
    public_task = await _make_task(db_session, public_source)
    now = datetime.now(timezone.utc)
    for i in range(3):
        await _make_record(
            db_session, public_source, public_task, curated=True,
            created_at=now - timedelta(minutes=i),
        )

    results = await svc.query_public_records(db_session, mode="all", take=2)

    assert len(results) == 2


@pytest.mark.parametrize(
    "take_in,expected",
    [
        (None, svc.DEFAULT_TAKE),
        (30, 30),
        (500, svc.MAX_TAKE),
        (-10, 0),
        (0, 0),
    ],
)
def test_normalize_take_defaults_and_clamps(take_in, expected):
    assert svc._normalize_take(take_in) == expected
