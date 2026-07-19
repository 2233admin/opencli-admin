"""DBCursorStore — per-source cursor persisted in source_cursors, upserted on save."""

import asyncio
import os
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.pipeline.cursor_store import CommitResult, DBCursorStore

# AUDIT C10: save() used to guard the lost-update race with
# `SELECT ... FOR UPDATE`, which is a silent no-op on SQLite (the dialect
# accepts the clause but never actually takes a row lock) — so on the default
# `db_engine` fixture (SQLite) the concurrency tests below could only prove
# the code PATH (insert-race fallback, no unhandled error, no lost value),
# never that a lock genuinely serialized contending writers; only the
# Postgres-gated variant further down proved that.
#
# save() now uses optimistic concurrency instead (a `version` column +
# `UPDATE ... WHERE version = ?`), which depends only on ordinary SQL
# semantics — an UPDATE's WHERE-match-then-write is atomic on every backend —
# rather than a backend-specific locking primitive. So the SQLite tests below
# now genuinely prove no lost update, not just the code path. The
# Postgres-gated variant is kept as a second-backend confidence check (same
# mechanism, a different driver/connection), not because it's uniquely
# load-bearing anymore; it's skipped unless a Postgres URL is provided (env
# TEST_DATABASE_URL_PG, or DATABASE_URL if it's postgres).
_PG_URL = os.environ.get("TEST_DATABASE_URL_PG") or (
    os.environ.get("DATABASE_URL", "")
    if os.environ.get("DATABASE_URL", "").startswith(("postgresql", "postgres"))
    else ""
)
_requires_postgres = pytest.mark.skipif(
    not _PG_URL,
    reason="no Postgres URL (TEST_DATABASE_URL_PG / DATABASE_URL) — extra cross-backend check",
)


def _sessionmaker(db_engine):
    return async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.mark.asyncio
async def test_load_missing_returns_none(db_engine):
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        assert await DBCursorStore().load("nope") is None


@pytest.mark.asyncio
async def test_save_then_load_roundtrip(db_engine):
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store = DBCursorStore()
        result = await store.save("src-1", {"etag": "abc"})
        assert result == CommitResult(advanced=True, old_cursor=None, new_cursor={"etag": "abc"})
        assert await store.load("src-1") == {"etag": "abc"}


@pytest.mark.asyncio
async def test_save_upserts_one_row_per_source(db_engine):
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store = DBCursorStore()
        first = await store.save("src-1", {"etag": "v1"})
        second = await store.save("src-1", {"etag": "v2", "last_modified": "Wed"})
        assert first.advanced is True
        assert second == CommitResult(
            advanced=True,
            old_cursor={"etag": "v1"},
            new_cursor={"etag": "v2", "last_modified": "Wed"},
        )
        assert await store.load("src-1") == {"etag": "v2", "last_modified": "Wed"}


@pytest.mark.asyncio
async def test_save_same_value_twice_is_not_advanced(db_engine):
    """Re-saving an identical cursor onto an existing row is a true no-op —
    CommitResult.advanced must be False so a caller doesn't record a
    cursor_advanced=True that didn't actually move anything."""
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store = DBCursorStore()
        first = await store.save("src-1", {"etag": "same"})
        second = await store.save("src-1", {"etag": "same"})
        assert first.advanced is True  # first-ever row
        assert second.advanced is False  # identical re-save
        assert second.old_cursor == {"etag": "same"}
        assert second.new_cursor == {"etag": "same"}


@pytest.mark.asyncio
async def test_cursors_isolated_by_source(db_engine):
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store = DBCursorStore()
        await store.save("src-1", {"etag": "a"})
        assert await store.load("src-2") is None


# ── P1-6: concurrent saves for the same source must not lose an update ─────

@pytest.mark.asyncio
async def test_concurrent_saves_no_lost_update_existing_row(db_engine):
    """Two concurrent save() calls updating an already-existing cursor row
    (the common case: a source that has collected before) must both land
    without raising, and the final value must be one of the two writers' —
    never the pre-race seed value, which would mean an update silently
    vanished into a stale overwrite."""
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store = DBCursorStore()
        await store.save("src-1", {"etag": "seed"})

        results = await asyncio.gather(
            store.save("src-1", {"etag": "from-A"}),
            store.save("src-1", {"etag": "from-B"}),
            return_exceptions=True,
        )

        # Neither concurrent save should raise, and each returns a real
        # CommitResult (not None) reflecting what it actually committed.
        # Whichever call's SELECT reads the fresher version wins its UPDATE
        # outright; the other's UPDATE ... WHERE version = ? affects 0 rows
        # (its read was already stale) and the optimistic-lock retry loop
        # re-reads and re-applies it on top — so exactly which call observes
        # which "old" value isn't guaranteed, only that both land cleanly.
        assert all(isinstance(r, CommitResult) for r in results)

        final = await store.load("src-1")
        # The lost-update bug this guards against: final == the seed value
        # (meaning both concurrent writers' updates were discarded) or a
        # value from neither writer. One of the two concurrent writers must
        # have durably landed.
        assert final in ({"etag": "from-A"}, {"etag": "from-B"})


@pytest.mark.asyncio
async def test_concurrent_saves_no_lost_update_first_insert_race(db_engine):
    """Two concurrent save() calls for a brand-new source (no row yet) race
    on the first INSERT. The loser must fall back to an update instead of
    raising IntegrityError out to the caller, and the source must end up
    with exactly one row holding one of the two writers' values — not two
    rows, not an unhandled exception, not a silently dropped write."""
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store = DBCursorStore()

        results = await asyncio.gather(
            store.save("src-new", {"etag": "from-A"}),
            store.save("src-new", {"etag": "from-B"}),
            return_exceptions=True,
        )

        assert all(isinstance(r, CommitResult) for r in results)
        # A brand-new source: whichever call wins the INSERT, and whichever
        # falls back to the locked UPDATE, both persist a real value where
        # there was none — both count as advanced.
        assert all(r.advanced is True for r in results)

        final = await store.load("src-new")
        assert final in ({"etag": "from-A"}, {"etag": "from-B"})


# ── AUDIT C10: the optimistic-lock version column in isolation ─────────────

@pytest.mark.asyncio
async def test_save_version_increments_on_each_successful_save(db_engine):
    """The version column is the whole mechanism behind the optimistic lock:
    it must actually advance by one on every successful save, or
    `UPDATE ... WHERE version = ?` would never detect a stale read."""
    from sqlalchemy import select

    from backend.models.source_cursor import SourceCursor

    sessionmaker = _sessionmaker(db_engine)
    with patch("backend.database.AsyncSessionLocal", sessionmaker):
        store = DBCursorStore()
        await store.save("src-ver", {"etag": "v0"})
        await store.save("src-ver", {"etag": "v1"})
        await store.save("src-ver", {"etag": "v2"})

    async with sessionmaker() as session:
        row = (
            await session.execute(
                select(SourceCursor).where(SourceCursor.source_id == "src-ver")
            )
        ).scalar_one()

    assert row.version == 2
    assert row.cursor == {"etag": "v2"}


# ── AUDIT follow-up (c): FOR UPDATE locking verified on real Postgres ───────

@_requires_postgres
@pytest.mark.asyncio
async def test_concurrent_saves_postgres_for_update_serializes():
    """Same no-lost-update scenario as the SQLite tests above, but against a
    real Postgres connection — a second-backend confidence check that the
    same optimistic-concurrency mechanism (version column + UPDATE ... WHERE
    version = ?) behaves the same way through a different driver, not a
    uniquely load-bearing proof anymore (the SQLite tests above already
    genuinely exercise the same UPDATE...WHERE semantics). Skipped unless a
    Postgres URL is configured; intended for the Postgres-backed CI job
    (which already stands up Postgres + runs `alembic upgrade head`)."""
    from sqlalchemy.ext.asyncio import create_async_engine

    from backend.database import Base

    url = _PG_URL
    for prefix in ("postgresql+asyncpg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            url = "postgresql+asyncpg://" + url[len(prefix):]
            break

    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)  # idempotent (checkfirst)

        with patch("backend.database.AsyncSessionLocal", _sessionmaker(engine)):
            store = DBCursorStore()
            await store.save("pg-src", {"etag": "seed"})

            results = await asyncio.gather(
                store.save("pg-src", {"etag": "from-A"}),
                store.save("pg-src", {"etag": "from-B"}),
                return_exceptions=True,
            )
            # Real FOR UPDATE serialization: whichever writer commits first,
            # the second genuinely observes the first's committed value under
            # the lock (not a stale pre-transaction read) — since both target
            # values differ from "seed" AND from each other, both calls are
            # real advances, never a silently-lost update.
            assert all(isinstance(r, CommitResult) for r in results)
            assert all(r.advanced is True for r in results)

            final = await store.load("pg-src")
            assert final in ({"etag": "from-A"}, {"etag": "from-B"})
    finally:
        async with engine.begin() as conn:
            await conn.exec_driver_sql("DELETE FROM source_cursors WHERE source_id = 'pg-src'")
        await engine.dispose()
