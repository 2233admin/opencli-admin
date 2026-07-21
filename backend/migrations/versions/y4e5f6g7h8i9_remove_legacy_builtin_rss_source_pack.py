"""remove the legacy built-in RSS source pack

Revision ID: y4e5f6g7h8i9
Revises: x3d4e5f6g7h8
"""

import sqlalchemy as sa
from alembic import op

revision = "y4e5f6g7h8i9"
down_revision = "x3d4e5f6g7h8"
branch_labels = None
depends_on = None


data_sources = sa.table(
    "data_sources",
    sa.column("channel_config", sa.JSON()),
    sa.column("tags", sa.JSON()),
)

LEGACY_PACK_ID = "opencli.insight-rss-starter"


def upgrade() -> None:
    """Remove only rows materialized by the abandoned product-owned source pack."""
    pack_marker = f"%{LEGACY_PACK_ID}%"
    op.get_bind().execute(
        sa.delete(data_sources).where(
            sa.or_(
                sa.cast(data_sources.c.channel_config, sa.Text()).like(pack_marker),
                sa.cast(data_sources.c.tags, sa.Text()).like(pack_marker),
            )
        )
    )


def downgrade() -> None:
    # The legacy pack is intentionally not recreated. Sources now belong to
    # workflow node configuration rather than product-owned seed data.
    pass
