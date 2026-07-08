"""encrypt model_providers.api_key at rest

Revision ID: u1p2q3r4s5t6
Revises: t0o1p2q3r4s5
Create Date: 2026-07-02

AUDIT item B3 follow-up: de716f0 masked `api_key` in API responses, but the
column was still stored plaintext in the DB. backend/models/provider.py now
maps the `api_key` DB column to a private `_api_key_encrypted` attribute and
exposes a Python `api_key` property that transparently encrypts on write /
decrypts on read (Fernet, via backend/auth/crypto.py — same scheme as
SourceCredential/AuthManager). This migration is the one-time data pass that
brings existing rows in line with that column's new ciphertext-only contract.

Idempotent by construction: for each row, try `crypto.decrypt(value)` first.
If it succeeds the value is already ciphertext (another run of this
migration, or a row created after the model change landed) — leave it alone.
If it raises CredentialCryptoError, treat it as legacy plaintext and
`crypto.encrypt` it. Safe to run twice; safe to run against a mix of
already-migrated and not-yet-migrated rows.

Requires CREDENTIAL_ENCRYPTION_KEY in the environment at migration time (same
requirement as the running app / AuthManager). The CI "Alembic Migrations"
job runs `alembic upgrade head` against a fresh, empty Postgres DB — with zero
model_providers rows this migration is a no-op there regardless of whether
the key is set.

downgrade() is the mirror: decrypt every row back to plaintext so a rollback
restores the pre-encryption on-disk shape. If CREDENTIAL_ENCRYPTION_KEY is
unset or wrong, both directions raise CredentialCryptoError rather than
silently corrupting data — the same "surface, don't swallow" behavior
crypto.py already uses everywhere else.
"""
import sqlalchemy as sa
from alembic import op

from backend.auth import crypto

revision = "u1p2q3r4s5t6"
down_revision = "t0o1p2q3r4s5"
branch_labels = None
depends_on = None


_providers = sa.table(
    "model_providers",
    sa.column("id", sa.String),
    sa.column("api_key", sa.Text),
)


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.select(_providers.c.id, _providers.c.api_key)).fetchall()

    for row_id, api_key in rows:
        if not api_key:
            continue
        try:
            crypto.decrypt(api_key)
            # Already ciphertext (idempotent re-run) — leave as-is.
            continue
        except crypto.CredentialCryptoError:
            pass

        ciphertext = crypto.encrypt(api_key)
        connection.execute(
            _providers.update().where(_providers.c.id == row_id).values(api_key=ciphertext)
        )


def downgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.select(_providers.c.id, _providers.c.api_key)).fetchall()

    for row_id, api_key in rows:
        if not api_key:
            continue
        try:
            plaintext = crypto.decrypt(api_key)
        except crypto.CredentialCryptoError:
            # Already plaintext (or foreign ciphertext under a different key)
            # — nothing this migration wrote; leave it alone rather than guess.
            continue

        connection.execute(
            _providers.update().where(_providers.c.id == row_id).values(api_key=plaintext)
        )
