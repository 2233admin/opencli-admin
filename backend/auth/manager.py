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
        """Encrypt ``secret`` and upsert it under ``(source_id, key_name)``."""
        from sqlalchemy import select

        from backend.database import AsyncSessionLocal
        from backend.models.source_credential import SourceCredential

        ciphertext = crypto.encrypt(secret)
        async with AsyncSessionLocal() as session:
            row = (
                await session.execute(
                    select(SourceCredential).where(
                        SourceCredential.source_id == source_id,
                        SourceCredential.key_name == key_name,
                    )
                )
            ).scalar_one_or_none()
            if row is not None:
                row.ciphertext = ciphertext
            else:
                session.add(
                    SourceCredential(
                        source_id=source_id, key_name=key_name, ciphertext=ciphertext
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

        creds = await self.resolve(source_id)
        if auth_kind == "bearer":
            token = creds.get("token", "")
            return AuthContext(
                kind="bearer",
                token=token,
                headers={"Authorization": f"Bearer {token}"} if token else {},
            )
        if auth_kind == "api_key":
            key = creds.get("key", "")
            return AuthContext(
                kind="api_key",
                token=key,
                headers={"X-API-Key": key} if key else {},
            )
        if auth_kind == "basic":
            import base64

            user = creds.get("username", "")
            pw = creds.get("password", "")
            encoded = base64.b64encode(f"{user}:{pw}".encode()).decode()
            return AuthContext(kind="basic", headers={"Authorization": f"Basic {encoded}"})

        return AuthContext(kind=auth_kind)
