"""add plan_source_index table

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-03

Issue 05 (dataflow triggering, ADR-0009): a cheap (source_id -> plan_id)
membership index maintained alongside ``plans.graph`` so a source's own
collection completing can ask "is this source part of any runnable Plan?"
via one indexed lookup instead of scanning/parsing every Plan's graph JSON.
Adds ONLY this table.
"""
import sqlalchemy as sa
from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_source_index",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("plan_id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.String(length=36), nullable=False),
        sa.Column("source_node_id", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plan_id", "source_node_id", name="uq_plan_source_node"),
    )
    op.create_index("ix_plan_source_index_plan_id", "plan_source_index", ["plan_id"])
    op.create_index("ix_plan_source_index_source_id", "plan_source_index", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_plan_source_index_source_id", table_name="plan_source_index")
    op.drop_index("ix_plan_source_index_plan_id", table_name="plan_source_index")
    op.drop_table("plan_source_index")
