"""add acquisition execution leases

Revision ID: p5q6r7s8t9u0
Revises: o4p5q6r7s8t9
Create Date: 2026-07-14
"""

import sqlalchemy as sa
from alembic import op

revision = "p5q6r7s8t9u0"
down_revision = "o4p5q6r7s8t9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "acquisition_executions",
        sa.Column("lease_owner", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "acquisition_executions",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "acquisition_executions",
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_acquisition_executions_lease_expires_at"),
        "acquisition_executions",
        ["lease_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_acquisition_executions_lease_expires_at"),
        table_name="acquisition_executions",
    )
    op.drop_column("acquisition_executions", "lease_expires_at")
    op.drop_column("acquisition_executions", "heartbeat_at")
    op.drop_column("acquisition_executions", "lease_owner")
