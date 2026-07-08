"""add source_cursors table (per-source incremental cursor)

Revision ID: p6k7l8m9n0o1
Revises: o5j6k7l8m9n0
Create Date: 2026-07-01

Backs ``DBCursorStore`` (``backend.pipeline.cursor_store``): one row per source
holding the channel's "where we left off" cursor (etag/last_modified for RSS,
since_id/page_token for others). Unique on ``source_id`` so save is an upsert.
"""
import sqlalchemy as sa
from alembic import op

revision = "p6k7l8m9n0o1"
down_revision = "o5j6k7l8m9n0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source_cursors",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.String(length=36), nullable=False),
        sa.Column("cursor", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", name="uq_source_cursors_source_id"),
    )
    op.create_index(
        "ix_source_cursors_source_id", "source_cursors", ["source_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_source_cursors_source_id", table_name="source_cursors")
    op.drop_table("source_cursors")
