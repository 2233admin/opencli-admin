"""add fail-closed browser profile kind

Revision ID: o4p5q6r7s8t9
Revises: n3o4p5q6r7s8
Create Date: 2026-07-13
"""

import sqlalchemy as sa
from alembic import op

revision = "o4p5q6r7s8t9"
down_revision = "n3o4p5q6r7s8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "browser_instances",
        sa.Column(
            "profile_kind",
            sa.String(length=20),
            nullable=False,
            server_default="authenticated",
        ),
    )


def downgrade() -> None:
    op.drop_column("browser_instances", "profile_kind")
