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
async def test_store_recovers_from_concurrent_insert_race(db_engine, monkeypatch):
    """Two concurrent store() calls for the same (source_id, key_name) can both
    miss each other's row in the SELECT and both attempt an INSERT; the loser
    must recover via UPDATE instead of surfacing an unhandled IntegrityError."""
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    sm = _sessionmaker(db_engine)
    with patch("backend.database.AsyncSessionLocal", sm):
        # A prior writer already landed a row for this key.
        await AuthManager().store("src-race", "token", "first-writer-value")

        # Simulate our own SELECT having run just before that commit: the
        # first _find_row() call returns None even though the row now
        # exists, forcing store() down the INSERT path, which must then hit
        # the real unique constraint and recover.
        real_find_row = AuthManager._find_row
        calls = {"n": 0}

        async def fake_find_row(session, source_id, key_name):
            calls["n"] += 1
            if calls["n"] == 1:
                return None
            return await real_find_row(session, source_id, key_name)

        with patch.object(AuthManager, "_find_row", staticmethod(fake_find_row)):
            await AuthManager().store("src-race", "token", "second-writer-value")

        assert await AuthManager().resolve("src-race") == {"token": "second-writer-value"}


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
async def test_resolve_context_basic(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        mgr = AuthManager()
        await mgr.store("src-1", "username", "u")
        await mgr.store("src-1", "password", "p")
        ctx = await mgr.resolve_context("src-1", "basic")
    import base64

    expected = base64.b64encode(b"u:p").decode()
    assert ctx.headers == {"Authorization": f"Basic {expected}"}


@pytest.mark.asyncio
async def test_resolve_context_basic_no_stored_creds_sends_no_header(db_engine, monkeypatch):
    """Neither username nor password stored — must not send a placeholder
    'Basic <base64 of \":\">' header (matches ApiChannel._resolve_auth_headers'
    same empty-credential guard via the shared build_auth_header helper)."""
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    with patch("backend.database.AsyncSessionLocal", _sessionmaker(db_engine)):
        ctx = await AuthManager().resolve_context("src-empty", "basic")
    assert ctx.headers == {}


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
