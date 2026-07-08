"""add source_credentials table (encrypted per-source secrets)

Revision ID: q7l8m9n0o1p2
Revises: p6k7l8m9n0o1
Create Date: 2026-07-01

Backs AuthManager: ciphertext-only credential storage (Fernet), one row per
(source_id, key_name). Plaintext never touches this table.
"""
import sqlalchemy as sa
from alembic import op

revision = "q7l8m9n0o1p2"
down_revision = "p6k7l8m9n0o1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source_credentials",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.String(length=36), nullable=False),
        sa.Column("key_name", sa.String(length=64), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_id", "key_name", name="uq_source_credentials_source_key"
        ),
    )
    op.create_index(
        "ix_source_credentials_source_id", "source_credentials", ["source_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_source_credentials_source_id", table_name="source_credentials")
    op.drop_table("source_credentials")
