"""Symmetric encryption for credentials at rest (Fernet).

The master key comes from the env var ``CREDENTIAL_ENCRYPTION_KEY`` (a urlsafe
base64 32-byte Fernet key). The key is read lazily per call, so importing this
module never fails — only ``encrypt`` / ``decrypt`` require it. Generate a key
with :func:`generate_key`.
"""

from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken

from backend.config import get_settings

ENV_KEY = "CREDENTIAL_ENCRYPTION_KEY"


class CredentialCryptoError(RuntimeError):
    """The encryption key is missing/invalid, or a token could not be decrypted."""


def _fernet() -> Fernet:
    # Process environment takes precedence so deployment systems can inject
    # the secret without an on-disk file. Local development uses the same
    # repository-root .env convention as the rest of Settings.
    environment_key = os.environ.get(ENV_KEY)
    key = environment_key.strip() if environment_key is not None else ""
    if environment_key is None:
        key = get_settings().credential_encryption_key.strip()
    if not key:
        raise CredentialCryptoError(
            f"{ENV_KEY} is not set; cannot encrypt/decrypt credentials. Generate one "
            "with: python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        )
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise CredentialCryptoError(f"{ENV_KEY} is not a valid Fernet key: {exc}") from exc


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    fernet = _fernet()  # key errors surface as CredentialCryptoError, not a token error
    try:
        return fernet.decrypt(token.encode()).decode()
    except (InvalidToken, ValueError, TypeError) as exc:
        # InvalidToken = wrong key / bad HMAC; ValueError/TypeError = malformed
        # base64 (binascii.Error is a ValueError subclass).
        raise CredentialCryptoError(
            "credential ciphertext could not be decrypted (wrong key or corrupt)"
        ) from exc


def generate_key() -> str:
    """Ops helper: a fresh Fernet key for ``CREDENTIAL_ENCRYPTION_KEY``."""
    return Fernet.generate_key().decode()
