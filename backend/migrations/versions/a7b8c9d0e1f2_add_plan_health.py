"""add plan_health table

Revision ID: a7b8c9d0e1f2
Revises: z6u7v8w9x0y1
Create Date: 2026-07-03

Issue 04 (executor v2 — shared segments + Two-Tier Attribution, ADR-0009):
Plan Health is the shared-segment's own per-node health dimension, entirely
separate from ``source_measurements``/``control_actions`` (which stay
per-source and untouched by shared-segment execution). Adds ONLY this table.
"""
import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "z6u7v8w9x0y1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_health",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("plan_id", sa.String(length=36), nullable=False),
        sa.Column("run_key", sa.String(length=36), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("node_type", sa.String(length=64), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("items_in", sa.Integer(), nullable=False),
        sa.Column("items_out", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_plan_health_plan_id", "plan_health", ["plan_id"])
    op.create_index("ix_plan_health_run_key", "plan_health", ["run_key"])
    op.create_index("ix_plan_health_node_id", "plan_health", ["node_id"])


def downgrade() -> None:
    op.drop_index("ix_plan_health_node_id", table_name="plan_health")
    op.drop_index("ix_plan_health_run_key", table_name="plan_health")
    op.drop_index("ix_plan_health_plan_id", table_name="plan_health")
    op.drop_table("plan_health")
