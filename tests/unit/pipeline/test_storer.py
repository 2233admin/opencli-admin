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


async def _setup_source_task(db_session, channel_type="rss"):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask

    source = DataSource(
        name="Identity Source", channel_type=channel_type,
        channel_config={"feed_url": "https://example.com/feed.xml"},
    )
    db_session.add(source)
    await db_session.flush()

    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()
    return source, task


def _triple(source_id, title, content_hash):
    return (
        {"title": title},
        {
            "title": title, "url": "", "content": "", "author": "",
            "published_at": "", "source_id": source_id,
        },
        content_hash,
    )


# ── C7: identity()-based dedup/update-in-place ──────────────────────────────

@pytest.mark.asyncio
async def test_store_identity_match_updates_in_place(db_session):
    """An item whose identity() matches an existing row, but whose content
    changed (e.g. a feed fixed a typo in the title), updates that row in
    place instead of inserting a duplicate (C7's fix)."""
    source, task = await _setup_source_task(db_session)

    first = _triple(source.id, "Original Title", "hash_v1")
    records1, skipped1 = await store_records(
        db_session, task.id, source.id, [first], identities=["entry-42"],
    )
    assert len(records1) == 1
    assert skipped1 == 0
    assert records1[0].identity_key == "entry-42"

    edited = _triple(source.id, "Original Title (fixed)", "hash_v2")
    records2, skipped2 = await store_records(
        db_session, task.id, source.id, [edited], identities=["entry-42"],
    )

    # Updated in place, not inserted as a new row.
    assert skipped2 == 0
    assert len(records2) == 1
    assert records2[0].content_hash == "hash_v2"
    assert records2[0].id == records1[0].id

    from sqlalchemy import select as sa_select

    from backend.models.record import CollectedRecord

    result = await db_session.execute(
        sa_select(CollectedRecord).where(CollectedRecord.source_id == source.id)
    )
    rows = result.scalars().all()
    assert len(rows) == 1  # still just one row for this source-native item
    assert rows[0].content_hash == "hash_v2"


@pytest.mark.asyncio
async def test_store_identity_match_same_hash_is_plain_duplicate(db_session):
    """Same identity AND same content_hash: a genuine duplicate, skipped —
    exactly like the content_hash-only path always did for an unedited
    re-fetch of the same item."""
    source, task = await _setup_source_task(db_session)

    triple = _triple(source.id, "Same", "same_hash")
    await store_records(db_session, task.id, source.id, [triple], identities=["entry-1"])
    records2, skipped2 = await store_records(
        db_session, task.id, source.id, [triple], identities=["entry-1"]
    )

    assert len(records2) == 0
    assert skipped2 == 1


@pytest.mark.asyncio
async def test_store_without_identities_is_unchanged(db_session):
    """Channels without identity() (identities=None, the default) keep
    deduplicating on content_hash alone — completely unaffected by C7."""
    source, task = await _setup_source_task(db_session)

    triple = _triple(source.id, "No Identity", "no_identity_hash")
    records1, skipped1 = await store_records(db_session, task.id, source.id, [triple])
    assert len(records1) == 1
    assert records1[0].identity_key is None

    # An "edit" with no identity info at all is content_hash-only: a
    # different hash is a brand new row, not an update — pre-C7 behavior.
    edited = _triple(source.id, "No Identity Edited", "no_identity_hash_v2")
    records2, skipped2 = await store_records(db_session, task.id, source.id, [edited])
    assert len(records2) == 1
    assert records2[0].id != records1[0].id  # inserted as a new row, not updated


@pytest.mark.asyncio
async def test_store_mixed_batch_some_items_without_identity(db_session):
    """identities can mix real values and None per item — items with None
    fall back to content_hash dedup individually, others use identity."""
    source, task = await _setup_source_task(db_session)

    triples = [
        _triple(source.id, "Has Identity", "hash_a"),
        _triple(source.id, "No Identity", "hash_b"),
    ]
    records, skipped = await store_records(
        db_session, task.id, source.id, triples, identities=["entry-x", None],
    )
    assert skipped == 0
    by_hash = {r.content_hash: r for r in records}
    assert by_hash["hash_a"].identity_key == "entry-x"
    assert by_hash["hash_b"].identity_key is None


@pytest.mark.asyncio
async def test_store_identity_duplicated_within_same_batch(db_session):
    """Two triples in the same batch sharing an identity (e.g. a feed listed
    the same entry twice): keep the first, skip the rest."""
    source, task = await _setup_source_task(db_session)

    triples = [
        _triple(source.id, "First", "hash_first"),
        _triple(source.id, "Duplicate Within Batch", "hash_dup"),
    ]
    records, skipped = await store_records(
        db_session, task.id, source.id, triples,
        identities=["entry-same", "entry-same"],
    )
    assert len(records) == 1
    assert skipped == 1
    assert records[0].content_hash == "hash_first"


# ── C15: dedup lookup chunking across the SQLite variable limit ────────────

@pytest.mark.asyncio
async def test_store_dedup_chunks_across_batches(db_session, monkeypatch):
    """A dedup lookup spanning more hashes than one chunk still correctly
    finds every pre-existing hash, regardless of which chunk it falls into
    (C15) — proves the union-across-chunks logic, not just 'doesn't crash'."""
    import backend.pipeline.storer as storer_module

    monkeypatch.setattr(storer_module, "_HASH_CHUNK_SIZE", 2)

    source, task = await _setup_source_task(db_session)

    # Seed 5 existing rows — spans more than one chunk of size 2.
    seed_triples = [_triple(source.id, f"Seed {i}", f"seed_hash_{i}") for i in range(5)]
    await store_records(db_session, task.id, source.id, seed_triples)

    # A new batch mixing all 5 pre-existing hashes with 2 genuinely new ones.
    batch = seed_triples + [
        _triple(source.id, "New A", "new_hash_a"),
        _triple(source.id, "New B", "new_hash_b"),
    ]
    new_records, skipped = await store_records(db_session, task.id, source.id, batch)

    assert skipped == 5  # every seeded hash correctly detected, across chunks
    assert len(new_records) == 2
    assert {r.content_hash for r in new_records} == {"new_hash_a", "new_hash_b"}


@pytest.mark.asyncio
async def test_store_identity_lookup_chunks_across_batches(db_session, monkeypatch):
    """The identity-based existence lookup is chunked the same way (C7+C15
    share the same chunk size) — a batch with more identities than one
    chunk still matches every existing one correctly."""
    import backend.pipeline.storer as storer_module

    monkeypatch.setattr(storer_module, "_HASH_CHUNK_SIZE", 2)

    source, task = await _setup_source_task(db_session)

    seed_triples = [_triple(source.id, f"Seed {i}", f"seed_hash_{i}") for i in range(5)]
    seed_identities = [f"entry-{i}" for i in range(5)]
    await store_records(
        db_session, task.id, source.id, seed_triples, identities=seed_identities,
    )

    # Re-submit all 5 with edited content (same identities, new hashes) —
    # every one should be matched and updated in place, none inserted.
    edited_triples = [
        _triple(source.id, f"Seed {i} edited", f"seed_hash_{i}_v2") for i in range(5)
    ]
    records, skipped = await store_records(
        db_session, task.id, source.id, edited_triples, identities=seed_identities,
    )

    assert skipped == 0
    assert len(records) == 5
    assert {r.content_hash for r in records} == {f"seed_hash_{i}_v2" for i in range(5)}
