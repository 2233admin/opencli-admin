"""Unit tests for pipeline storer."""

import pytest

from backend.pipeline.storer import store_records


@pytest.mark.asyncio
async def test_store_new_records(db_session):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask

    # Create source and task for FK constraints
    source = DataSource(
        name="Test Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed.xml"},
    )
    db_session.add(source)
    await db_session.flush()

    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    triples = [
        (
            {"title": "Article 1"},
            {"title": "Article 1", "url": "", "content": "", "author": "", "published_at": "", "source_id": source.id},
            "hash_abc123_1",
        ),
        (
            {"title": "Article 2"},
            {"title": "Article 2", "url": "", "content": "", "author": "", "published_at": "", "source_id": source.id},
            "hash_abc123_2",
        ),
    ]

    new_records, skipped = await store_records(db_session, task.id, source.id, triples)
    assert len(new_records) == 2
    assert skipped == 0


@pytest.mark.asyncio
async def test_store_deduplication(db_session):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask

    source = DataSource(
        name="Dedup Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed.xml"},
    )
    db_session.add(source)
    await db_session.flush()

    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    triple = (
        {"title": "Same Article"},
        {"title": "Same", "url": "", "content": "", "author": "", "published_at": "", "source_id": source.id},
        "same_hash_xyz",
    )

    # First store: new record
    records1, skipped1 = await store_records(db_session, task.id, source.id, [triple])
    assert len(records1) == 1
    assert skipped1 == 0

    # Second store: duplicate should be skipped
    records2, skipped2 = await store_records(db_session, task.id, source.id, [triple])
    assert len(records2) == 0
    assert skipped2 == 1


@pytest.mark.asyncio
async def test_store_empty_input(db_session):
    new_records, skipped = await store_records(db_session, "task-id", "src-id", [])
    assert new_records == []
    assert skipped == 0


@pytest.mark.asyncio
async def test_store_survives_concurrent_race_on_flush(db_session):
    """A concurrent writer can land the same content_hash between our
    existence check and our flush (e.g. a celery retry racing the original
    attempt now that retries are real, PR-B). flush() must not crash the
    whole batch — the colliding row is skipped, everything else survives."""
    from backend.models.record import CollectedRecord
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask

    source = DataSource(
        name="Race Source", channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed.xml"},
    )
    db_session.add(source)
    await db_session.flush()

    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    # The "other writer" wins the race and commits first. Committed (not just
    # flushed) so the recovery path's rollback() — which only unwinds this
    # test's own uncommitted work, same as a fresh production session — can't
    # undo it, matching how store_records is actually called (a session
    # opened fresh per write_batch, source/task already committed earlier).
    winner = CollectedRecord(
        task_id=task.id, source_id=source.id, raw_data={}, normalized_data={},
        content_hash="race_hash", status="normalized",
    )
    db_session.add(winner)
    await db_session.commit()

    triples = [
        (
            {"title": "Loser"},
            {"title": "Loser", "url": "", "content": "", "author": "", "published_at": "", "source_id": source.id},
            "race_hash",
        ),
        (
            {"title": "Clean"},
            {"title": "Clean", "url": "", "content": "", "author": "", "published_at": "", "source_id": source.id},
            "clean_hash",
        ),
    ]

    # Simulate the race window: the existence-check SELECT ran a moment
    # before the winner committed, so it comes back blind to "race_hash".
    real_execute = db_session.execute
    calls = {"n": 0}

    async def blind_first_call(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return []
        return await real_execute(*args, **kwargs)

    db_session.execute = blind_first_call
    try:
        new_records, skipped = await store_records(db_session, task.id, source.id, triples)
    finally:
        db_session.execute = real_execute

    # The colliding row is skipped (not crashed), the clean one still lands.
    assert skipped == 1
    assert len(new_records) == 1
    assert new_records[0].content_hash == "clean_hash"
