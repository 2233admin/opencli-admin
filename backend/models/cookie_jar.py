from sqlalchemy import String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class CookieJarEntry(TimestampMixin):
    """One synced cookie, encrypted at rest.

    Keyed by ``(domain, cookie_name)`` — not ``source_id`` — because a
    CookieCloud sync yields a whole browser's cookie jar (many domains at
    once), not a credential scoped to one DataSource. A channel resolves
    cookies for whatever domain its own config targets (``AuthManager.
    resolve_cookies``), same as ``source_credentials`` decrypts per source.

    ``ciphertext`` is the Fernet-encrypted JSON of the cookie's non-name
    attributes (``value``/``path``/``expires``/``httpOnly``/``secure``/
    ``sameSite``) — same crypto module as ``source_credentials``, so
    CookieCloud's own AES/CryptoJS format never leaves the sync adapter.
    """

    __tablename__ = "cookie_jar"
    __table_args__ = (
        UniqueConstraint("domain", "cookie_name", name="uq_cookie_jar_domain_name"),
    )

    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    cookie_name: Mapped[str] = mapped_column(String(255), nullable=False)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
