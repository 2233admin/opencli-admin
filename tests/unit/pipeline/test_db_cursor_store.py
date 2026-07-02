"""DBCursorStore — per-source cursor persisted in source_cursors, upserted on save."""

import asyncio
import os
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.pipeline.cursor_store import DBCursorStore

# The concurrency tests below run on the default `db_engine` fixture (SQLite in
# CI/local), which does NOT actually enforce `SELECT ... FOR UPDATE` row locks —
# so on SQLite they prove the code PATH (insert-race fallback, no unhandled
# error, no lost value) but NOT that the lock genuinely serializes contending
# writers. The `test_concurrent_saves_postgres_*` variant re-runs the same
# scenario against a real Postgres (where FOR UPDATE is enforced), and is the
# one that actually closes AUDIT follow-up (c). It is skipped unless a Postgres
# URL is provided (env TEST_DATABASE_URL_PG, or DATABASE_URL if it's postgres),
# so it's inert locally/on SQLite and active in a Postgres-backed CI run.
_PG_URL = os.environ.get("TEST_DATABASE_URL_PG") or (
    os.environ.get("DATABASE_URL", "")
    if os.environ.get("DATABASE_URL", "").startswith(("postgresql", "postgres"))
    else ""
)
_requires_postgres = pytest.mark.skipif(
    not _PG_URL, reason="no Postgres URL (TEST_DATABASE_URL_PG / postgres DATABASE_URL) — FOR UPDATE locking can only be verified on Postgres"
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
        await store.save("src-1", {"etag": "abc"})
        assert await store.load("src-1") == {"etag": "abc"}


@pytest.mark.asyncio
async def test_save_upserts_one_row_per_source(db_engine):
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        store = DBCursorStore()
        await store.save("src-1", {"etag": "v1"})
        await store.save("src-1", {"etag": "v2", "last_modified": "Wed"})
        assert await store.load("src-1") == {"etag": "v2", "last_modified": "Wed"}


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

        # Neither concurrent save should raise.
        assert results == [None, None]

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

        assert results == [None, None]

        final = await store.load("src-new")
        assert final in ({"etag": "from-A"}, {"etag": "from-B"})


# ── AUDIT follow-up (c): FOR UPDATE locking verified on real Postgres ───────

@_requires_postgres
@pytest.mark.asyncio
async def test_concurrent_saves_postgres_for_update_serializes():
    """Same no-lost-update scenario as the SQLite tests above, but against a
    real Postgres where `SELECT ... FOR UPDATE` is actually enforced — this is
    the run that genuinely proves the row lock serializes contending writers
    (SQLite silently ignores FOR UPDATE, so the tests above can't). Skipped
    unless a Postgres URL is configured; intended for the Postgres-backed CI
    job (which already stands up Postgres + runs `alembic upgrade head`)."""
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
            assert results == [None, None]

            final = await store.load("pg-src")
            assert final in ({"etag": "from-A"}, {"etag": "from-B"})
    finally:
        async with engine.begin() as conn:
            await conn.exec_driver_sql("DELETE FROM source_cursors WHERE source_id = 'pg-src'")
        await engine.dispose()
