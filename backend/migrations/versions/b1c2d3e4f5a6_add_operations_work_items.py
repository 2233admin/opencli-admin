"""add operations work items

Revision ID: b1c2d3e4f5a6
Revises: z6u7v8w9x0y1
"""

import sqlalchemy as sa
from alembic import op

revision = "b1c2d3e4f5a6"
down_revision = "z6u7v8w9x0y1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "operations_work_items",
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("owning_team_id", sa.String(36), nullable=True),
        sa.Column("assignee_id", sa.String(36), nullable=True),
        sa.Column("author_actor_type", sa.String(32), nullable=True),
        sa.Column("author_actor_id", sa.String(255), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("parent_id", sa.String(36), nullable=True),
        sa.Column("proposal_id", sa.String(36), nullable=True),
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('incident', 'approval', 'change_proposal', 'review')",
            name="ck_operations_work_items_type",
        ),
        sa.CheckConstraint(
            "status IN ('open', 'in_progress', 'resolved', 'closed', 'dismissed')",
            name="ck_operations_work_items_status",
        ),
        sa.CheckConstraint(
            "severity IN ('critical', 'high', 'medium', 'low')",
            name="ck_operations_work_items_severity",
        ),
        sa.CheckConstraint(
            "priority IN ('urgent', 'high', 'normal', 'low')",
            name="ck_operations_work_items_priority",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "workspace_id",
        "owning_team_id",
        "assignee_id",
        "author_actor_id",
        "parent_id",
        "proposal_id",
    ):
        op.create_index(f"ix_operations_work_items_{column}", "operations_work_items", [column])


def downgrade() -> None:
    op.drop_table("operations_work_items")
