"""AuthManager: encrypted store/resolve round-trip + AuthContext shaping."""

from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.auth import crypto
from backend.auth.manager import AuthManager

KEY = Fernet.generate_key().decode()


def _sessionmaker(db_engine):
    return async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.mark.asyncio
async def test_store_then_resolve(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        mgr = AuthManager()
        await mgr.store("src-1", "token", "abc123")
        await mgr.store("src-1", "key", "k-9")
        assert await mgr.resolve("src-1") == {"token": "abc123", "key": "k-9"}


@pytest.mark.asyncio
async def test_store_is_upsert_and_ciphertext_only(db_engine, monkeypatch):
    from sqlalchemy import select

    from backend.models.source_credential import SourceCredential

    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    sm = _sessionmaker(db_engine)
    with patch("backend.database.AsyncSessionLocal", sm):
        mgr = AuthManager()
        await mgr.store("src-1", "token", "v1")
        await mgr.store("src-1", "token", "v2")
        assert await mgr.resolve("src-1") == {"token": "v2"}

    async with sm() as session:
        rows = (
            await session.execute(
                select(SourceCredential).where(SourceCredential.source_id == "src-1")
            )
        ).scalars().all()
    assert len(rows) == 1  # upsert, not a second row
    assert "v2" not in rows[0].ciphertext  # stored encrypted, never plaintext


@pytest.mark.asyncio
async def test_resolve_context_none_skips_db():
    # auth_kind="none" must short-circuit without any DB access.
    ctx = await AuthManager().resolve_context("src-x", "none")
    assert ctx.kind == "none"
    assert ctx.headers == {}


@pytest.mark.asyncio
async def test_resolve_context_bearer(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        mgr = AuthManager()
        await mgr.store("src-1", "token", "tok-7")
        ctx = await mgr.resolve_context("src-1", "bearer")
    assert ctx.kind == "bearer"
    assert ctx.headers == {"Authorization": "Bearer tok-7"}


@pytest.mark.asyncio
async def test_resolve_context_api_key(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        mgr = AuthManager()
        await mgr.store("src-1", "key", "k-42")
        ctx = await mgr.resolve_context("src-1", "api_key")
    assert ctx.headers == {"X-API-Key": "k-42"}


@pytest.mark.asyncio
async def test_list_keys_returns_names_not_values(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        mgr = AuthManager()
        await mgr.store("src-1", "token", "secret-value")
        keys = await mgr.list_keys("src-1")
    assert keys == ["token"]
    assert "secret-value" not in keys


@pytest.mark.asyncio
async def test_list_keys_empty_for_unknown_source(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        assert await AuthManager().list_keys("no-such-source") == []


@pytest.mark.asyncio
async def test_delete_removes_credential(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        mgr = AuthManager()
        await mgr.store("src-1", "token", "abc123")
        await mgr.store("src-1", "key", "k-9")
        await mgr.delete("src-1", "token")
        assert await mgr.resolve("src-1") == {"key": "k-9"}


@pytest.mark.asyncio
async def test_delete_unknown_key_is_noop(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        mgr = AuthManager()
        await mgr.store("src-1", "token", "abc123")
        await mgr.delete("src-1", "does-not-exist")
        assert await mgr.resolve("src-1") == {"token": "abc123"}
