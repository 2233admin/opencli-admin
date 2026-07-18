from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.auth import crypto
from backend.models.base import TimestampMixin


class FeedProvider(TimestampMixin):
    """Self-hosted RSS generator connection (RSSHub or RSS-Bridge)."""

    __tablename__ = "feed_providers"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    _access_token_encrypted: Mapped[str | None] = mapped_column(
        "access_token", Text, nullable=True
    )
    config: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    @property
    def access_token(self) -> str | None:
        value = self._access_token_encrypted
        if not value:
            return value
        try:
            return crypto.decrypt(value)
        except crypto.CredentialCryptoError:
            return value

    @access_token.setter
    def access_token(self, value: str | None) -> None:
        self._access_token_encrypted = crypto.encrypt(value) if value else value
