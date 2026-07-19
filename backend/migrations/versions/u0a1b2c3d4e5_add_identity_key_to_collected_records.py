"""add identity_key to collected_records

Revision ID: u0a1b2c3d4e5
Revises: t9y0z1a2b3c4
Create Date: 2026-07-19

Rebased 2026-07-19: originally authored as t9y0z1a2b3c4/down=s8x9y0z1a2b3 in a
parallel worktree; group ④ landed its own t9y0z1a2b3c4 (source_cursor version)
first, so this migration is re-chained after it to keep a single linear head.
"""

import sqlalchemy as sa
from alembic import op

revision = "u0a1b2c3d4e5"
down_revision = "t9y0z1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "collected_records",
        sa.Column("identity_key", sa.String(length=512), nullable=True),
    )
    # Non-unique (C7): identity_key is a supplementary dedup key alongside
    # content_hash, not a replacement — many rows sharing NULL is expected
    # for channels that don't implement identity().
    op.create_index(
        op.f("ix_collected_records_source_identity"),
        "collected_records",
        ["source_id", "identity_key"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_collected_records_source_identity"),
        table_name="collected_records",
    )
    op.drop_column("collected_records", "identity_key")
