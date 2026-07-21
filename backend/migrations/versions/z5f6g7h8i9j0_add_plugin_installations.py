"""add persisted plugin installation registry

Revision ID: z5f6g7h8i9j0
Revises: y4e5f6g7h8i9
Create Date: 2026-07-21
"""

import sqlalchemy as sa
from alembic import op

revision = "z5f6g7h8i9j0"
down_revision = "y4e5f6g7h8i9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plugin_installations",
        sa.Column("provider_key", sa.String(length=257), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("author", sa.String(length=128), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("source_kind", sa.String(length=32), nullable=False),
        sa.Column("source_digest", sa.String(length=64), nullable=False),
        sa.Column("manifest_spec_version", sa.String(length=32), nullable=False),
        sa.Column("signature_state", sa.String(length=32), nullable=False),
        sa.Column("manifest_json", sa.JSON(), nullable=False),
        sa.Column("capabilities_json", sa.JSON(), nullable=False),
        sa.Column("permissions_json", sa.JSON(), nullable=False),
        sa.Column("runtime_status", sa.String(length=32), nullable=False),
        sa.Column("blockers_json", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider_key",
            "version",
            "source_digest",
            name="uq_plugin_installations_provider_version_digest",
        ),
    )
    op.create_index(
        "ix_plugin_installations_provider_key",
        "plugin_installations",
        ["provider_key"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_plugin_installations_provider_key", table_name="plugin_installations")
    op.drop_table("plugin_installations")
