"""add plans table

Revision ID: z6u7v8w9x0y1
Revises: y5t6u7v8w9x0
Create Date: 2026-07-02

Issue 02 (Plan IR persistence, ADR-0009): a plans table storing the Plan IR
graph JSON plus name/version/draft state. Adds ONLY this table — no changes
to any other table. ``graph`` stores the caller-supplied Plan IR document
verbatim (byte-faithful round-trip); ``draft``/``runnable`` are derived at
save time from the graph's source-node materialization state (ADR-0009
draft semantics) and persisted alongside it so reads don't need to re-walk
the JSON.
"""
import sqlalchemy as sa
from alembic import op

revision = "z6u7v8w9x0y1"
down_revision = "y5t6u7v8w9x0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("graph", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("draft", sa.Boolean(), nullable=False),
        sa.Column("runnable", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("plans")
