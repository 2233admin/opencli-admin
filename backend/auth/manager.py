"""AuthManager — encrypted credential store + resolution into AuthContext.

Secrets live encrypted in ``source_credentials`` (never plaintext in
``channel_config``). ``store`` encrypts and upserts; ``resolve`` decrypts to a
``{key_name: value}`` dict; ``resolve_context`` shapes them into the runner's
``AuthContext`` for a channel's declared ``auth_kind``, so channels never touch
raw secrets.
"""

from __future__ import annotations

from backend.auth import crypto
from backend.channels.base import AuthContext


class AuthManager:
    async def store(self, source_id: str, key_name: str, secret: str) -> None:
        """Encrypt ``secret`` and upsert it under ``(source_id, key_name)``.

        The select-then-insert isn't atomic, so two concurrent stores for the
        same ``(source_id, key_name)`` (e.g. a double-click on the UI's save
        button) can both miss each other's row and both attempt an INSERT; the
        second hits ``uq_source_credentials_source_key`` and raises
        IntegrityError. Recover by rolling back and updating the row the other
        request just inserted, instead of surfacing an unhandled 500.
        """
        from sqlalchemy.exc import IntegrityError

        from backend.database import AsyncSessionLocal
        from backend.models.source_credential import SourceCredential

        ciphertext = crypto.encrypt(secret)

        async with AsyncSessionLocal() as session:
            row = await self._find_row(session, source_id, key_name)
            if row is not None:
                row.ciphertext = ciphertext
                await session.commit()
                return

            session.add(
                SourceCredential(source_id=source_id, key_name=key_name, ciphertext=ciphertext)
            )
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                row = await self._find_row(session, source_id, key_name)
                if row is None:
                    raise
                row.ciphertext = ciphertext
                await session.commit()

    @staticmethod
    async def _find_row(session, source_id: str, key_name: str):
        from sqlalchemy import select

        from backend.models.source_credential import SourceCredential

        return (
            await session.execute(
                select(SourceCredential).where(
                    SourceCredential.source_id == source_id,
                    SourceCredential.key_name == key_name,
                )
            )
        ).scalar_one_or_none()

    async def list_keys(self, source_id: str) -> list[str]:
        """Key names stored for a source, without decrypting values — safe for a
        UI 'credential configured' listing that must never surface secrets."""
        from sqlalchemy import select

        from backend.database import AsyncSessionLocal
        from backend.models.source_credential import SourceCredential

        async with AsyncSessionLocal() as session:
            rows = (
                await session.execute(
                    select(SourceCredential.key_name).where(
                        SourceCredential.source_id == source_id
                    )
                )
            ).scalars().all()
        return list(rows)

    async def delete(self, source_id: str, key_name: str) -> None:
        """Remove one stored credential. No-op if it doesn't exist."""
        from sqlalchemy import delete as sa_delete

        from backend.database import AsyncSessionLocal
        from backend.models.source_credential import SourceCredential

        async with AsyncSessionLocal() as session:
            await session.execute(
                sa_delete(SourceCredential).where(
                    SourceCredential.source_id == source_id,
                    SourceCredential.key_name == key_name,
                )
            )
            await session.commit()

    async def resolve(self, source_id: str) -> dict[str, str]:
        """Decrypt all stored secrets for a source into ``{key_name: value}``."""
        from sqlalchemy import select

        from backend.database import AsyncSessionLocal
        from backend.models.source_credential import SourceCredential

        async with AsyncSessionLocal() as session:
            rows = (
                await session.execute(
                    select(SourceCredential).where(
                        SourceCredential.source_id == source_id
                    )
                )
            ).scalars().all()
        return {r.key_name: crypto.decrypt(r.ciphertext) for r in rows}

    async def resolve_context(self, source_id: str, auth_kind: str) -> AuthContext:
        """Build the runner's ``AuthContext`` from stored credentials.

        ``none`` short-circuits with no DB hit. ``bearer``/``api_key``/``basic``
        decrypt the relevant secrets and pre-build the auth header so the channel
        never sees raw values.
        """
        if auth_kind == "none":
            return AuthContext(kind="none")

        from backend.auth.header_builder import build_auth_header

        creds = await self.resolve(source_id)
        headers = build_auth_header(auth_kind, creds)
        if auth_kind == "bearer":
            return AuthContext(kind="bearer", token=creds.get("token", ""), headers=headers)
        if auth_kind == "api_key":
            return AuthContext(kind="api_key", token=creds.get("key", ""), headers=headers)
        if auth_kind == "basic":
            return AuthContext(kind="basic", headers=headers)

        return AuthContext(kind=auth_kind)
