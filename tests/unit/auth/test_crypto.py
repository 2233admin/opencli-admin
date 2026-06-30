"""Fernet credential crypto: round-trip, key handling, tamper detection."""

import pytest
from cryptography.fernet import Fernet

from backend.auth import crypto

KEY = Fernet.generate_key().decode()


def test_round_trip(monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    token = crypto.encrypt("s3cr3t")
    assert token != "s3cr3t"
    assert crypto.decrypt(token) == "s3cr3t"


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv(crypto.ENV_KEY, raising=False)
    with pytest.raises(crypto.CredentialCryptoError):
        crypto.encrypt("x")


def test_invalid_key_raises(monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, "not-a-fernet-key")
    with pytest.raises(crypto.CredentialCryptoError):
        crypto.encrypt("x")


def test_decrypt_tampered_raises(monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    token = crypto.encrypt("hello")
    # Flip a character mid-token (appending after the base64 padding would be
    # silently ignored by the decoder and still decrypt).
    i = len(token) // 2
    tampered = token[:i] + ("A" if token[i] != "A" else "B") + token[i + 1:]
    with pytest.raises(crypto.CredentialCryptoError):
        crypto.decrypt(tampered)


def test_wrong_key_cannot_decrypt(monkeypatch):
    monkeypatch.setenv(crypto.ENV_KEY, KEY)
    token = crypto.encrypt("hello")
    monkeypatch.setenv(crypto.ENV_KEY, Fernet.generate_key().decode())
    with pytest.raises(crypto.CredentialCryptoError):
        crypto.decrypt(token)


def test_generate_key_is_usable():
    Fernet(crypto.generate_key().encode())  # must construct without error
