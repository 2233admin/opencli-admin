"""Unit tests for ModelProvider.api_key encryption at rest (AUDIT item B3
follow-up).

backend.models.provider.ModelProvider stores `api_key` ciphertext-only in the
DB (column mapped to `_api_key_encrypted`), exposing a Python `api_key`
property that transparently encrypts on write / decrypts on read — the same
Fernet scheme as SourceCredential/AuthManager (backend/auth/crypto.py). Every
existing read site (skill_channel, crawl4ai, distill, openai_processor, ...)
keeps reading `provider.api_key` and keeps getting plaintext back; only the
column on disk changes shape.
"""

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.auth import crypto
from backend.models.provider import ModelProvider
from backend.schemas.provider import ModelProviderRead

KEY = Fernet.generate_key().decode()


def _sessionmaker(db_engine):
    return async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)


def _select_provider(provider_id: str):
    return select(ModelProvider).where(ModelProvider.id == provider_id)


def _select_raw_api_key(provider_id: str):
    return select(ModelProvider.__table__.c.api_key).where(
        ModelProvider.__table__.c.id == provider_id
    )


@pytest.mark.asyncio
async def test_setting_api_key_stores_ciphertext_in_db(db_engine, monkeypatch):
    """Round-trip: set plaintext -> DB column holds ciphertext -> read
    returns plaintext again."""
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    sm = _sessionmaker(db_engine)

    async with sm() as session:
        provider = ModelProvider(name="Test", provider_type="openai", api_key="sk-plaintext-123")
        session.add(provider)
        await session.commit()
        provider_id = provider.id

    # Read the raw column directly (bypassing the ORM instance's property) to
    # prove what's actually on disk is ciphertext, not the plaintext we set.
    async with sm() as session:
        raw = (await session.execute(_select_raw_api_key(provider_id))).scalar_one()
    assert raw != "sk-plaintext-123"
    assert raw is not None

    # Fresh ORM load: the `api_key` property decrypts transparently.
    async with sm() as session:
        loaded = (await session.execute(_select_provider(provider_id))).scalar_one()
    assert loaded.api_key == "sk-plaintext-123"


@pytest.mark.asyncio
async def test_setattr_api_key_routes_through_encrypting_setter(db_engine, monkeypatch):
    """update_provider's `setattr(provider, field, value)` pattern (backend/
    api/v1/providers.py) must also encrypt, not just the constructor kwarg."""
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    sm = _sessionmaker(db_engine)

    async with sm() as session:
        provider = ModelProvider(name="Test", provider_type="openai")
        session.add(provider)
        await session.commit()
        provider_id = provider.id

    async with sm() as session:
        provider = (await session.execute(_select_provider(provider_id))).scalar_one()
        setattr(provider, "api_key", "sk-updated-456")
        await session.commit()

    async with sm() as session:
        raw = (await session.execute(_select_raw_api_key(provider_id))).scalar_one()
    assert raw != "sk-updated-456"

    async with sm() as session:
        loaded = (await session.execute(_select_provider(provider_id))).scalar_one()
    assert loaded.api_key == "sk-updated-456"


def test_none_api_key_getter_and_setter_passthrough(monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    provider = ModelProvider(name="Test", provider_type="openai", api_key=None)
    assert provider.api_key is None
    assert provider._api_key_encrypted is None


def test_empty_string_api_key_getter_and_setter_passthrough(monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    provider = ModelProvider(name="Test", provider_type="openai", api_key="")
    assert provider.api_key == ""
    assert provider._api_key_encrypted == ""


def test_getter_returns_legacy_plaintext_as_is_when_not_ciphertext(monkeypatch):
    """A row written before this property existed (or before the data
    migration ran) has a plaintext value in `_api_key_encrypted`. The getter
    must not raise on it — it returns it as-is so old rows keep working until
    the migration (or a subsequent save) re-encrypts them."""
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    provider = ModelProvider(name="Test", provider_type="openai")
    provider._api_key_encrypted = "sk-legacy-plaintext-untouched"
    assert provider.api_key == "sk-legacy-plaintext-untouched"


def test_getter_decrypts_ciphertext_written_directly_to_private_attr(monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    provider = ModelProvider(name="Test", provider_type="openai")
    provider._api_key_encrypted = crypto.encrypt("sk-direct-cipher")
    assert provider.api_key == "sk-direct-cipher"


def test_setter_raises_when_encryption_key_missing(monkeypatch):
    """Setting a real key without CREDENTIAL_ENCRYPTION_KEY configured must
    fail loudly (matches crypto.py / AuthManager precedent) rather than
    silently storing plaintext."""
    monkeypatch.setenv(crypto.ENV_KEY, "")
    provider = ModelProvider(name="Test", provider_type="openai")
    with pytest.raises(crypto.CredentialCryptoError):
        provider.api_key = "sk-should-not-be-stored"


@pytest.mark.asyncio
async def test_model_provider_read_from_model_masks_and_has_api_key_true(db_engine, monkeypatch):
    """ModelProviderRead.from_model reads provider.api_key (now decrypting)
    to derive api_key_preview/has_api_key — must still work after encryption."""
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    sm = _sessionmaker(db_engine)

    async with sm() as session:
        provider = ModelProvider(
            name="Test", provider_type="openai", api_key="sk-abcd1234efgh5678"
        )
        session.add(provider)
        await session.commit()
        provider_id = provider.id

    async with sm() as session:
        loaded = (await session.execute(_select_provider(provider_id))).scalar_one()
        read = ModelProviderRead.from_model(loaded)

    assert read.has_api_key is True
    assert read.api_key_preview is not None
    assert "sk-abcd1234efgh5678" not in read.api_key_preview
    assert read.api_key_preview.endswith("5678")


@pytest.mark.asyncio
async def test_model_provider_read_from_model_no_key_configured(db_engine, monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    sm = _sessionmaker(db_engine)

    async with sm() as session:
        provider = ModelProvider(name="Test", provider_type="openai")
        session.add(provider)
        await session.commit()
        provider_id = provider.id

    async with sm() as session:
        loaded = (await session.execute(_select_provider(provider_id))).scalar_one()
        read = ModelProviderRead.from_model(loaded)

    assert read.has_api_key is False
    assert read.api_key_preview is None
