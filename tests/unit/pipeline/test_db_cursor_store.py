"""DBCursorStore — per-source cursor persisted in source_cursors, upserted on save."""

from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.pipeline.cursor_store import DBCursorStore


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
