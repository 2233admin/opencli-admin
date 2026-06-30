from sqlalchemy import String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class SourceCredential(TimestampMixin):
    """An encrypted per-source secret (api token, key, password, ...).

    Stores ciphertext only — never plaintext. ``AuthManager`` encrypts on store
    and decrypts on resolve. One row per ``(source_id, key_name)``.
    """

    __tablename__ = "source_credentials"
    __table_args__ = (
        UniqueConstraint("source_id", "key_name", name="uq_source_credentials_source_key"),
    )

    source_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    key_name: Mapped[str] = mapped_column(String(64), nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
