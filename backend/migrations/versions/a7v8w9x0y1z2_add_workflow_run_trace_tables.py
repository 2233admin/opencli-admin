"""add workflow run trace tables

Revision ID: a7v8w9x0y1z2
Revises: c9d0e1f2a3b4
Create Date: 2026-07-05

Persist WorkflowProject run projections and replayable node events so Canvas
run trace can survive process restarts and late source-output continuations can
resume from the latest stored request.
"""

import sqlalchemy as sa
from alembic import op

revision = "a7v8w9x0y1z2"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=255), nullable=False),
        sa.Column("trace_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("valid", sa.Boolean(), nullable=False),
        sa.Column("package_node_id", sa.String(length=255), nullable=True),
        sa.Column("request", sa.JSON(), nullable=False),
        sa.Column("projection", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_runs_trace_id", "workflow_runs", ["trace_id"])
    op.create_index("ix_workflow_runs_workflow_id", "workflow_runs", ["workflow_id"])

    op.create_table(
        "workflow_run_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=255), nullable=False),
        sa.Column("trace_id", sa.String(length=255), nullable=False),
        sa.Column("event_id", sa.String(length=512), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["workflow_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_run_events_node_id", "workflow_run_events", ["node_id"])
    op.create_index("ix_workflow_run_events_event_id", "workflow_run_events", ["event_id"])
    op.create_index("ix_workflow_run_events_run_id", "workflow_run_events", ["run_id"])
    op.create_index("ix_workflow_run_events_trace_id", "workflow_run_events", ["trace_id"])
    op.create_index("ix_workflow_run_events_workflow_id", "workflow_run_events", ["workflow_id"])


def downgrade() -> None:
    op.drop_index("ix_workflow_run_events_workflow_id", table_name="workflow_run_events")
    op.drop_index("ix_workflow_run_events_trace_id", table_name="workflow_run_events")
    op.drop_index("ix_workflow_run_events_run_id", table_name="workflow_run_events")
    op.drop_index("ix_workflow_run_events_event_id", table_name="workflow_run_events")
    op.drop_index("ix_workflow_run_events_node_id", table_name="workflow_run_events")
    op.drop_table("workflow_run_events")
    op.drop_index("ix_workflow_runs_workflow_id", table_name="workflow_runs")
    op.drop_index("ix_workflow_runs_trace_id", table_name="workflow_runs")
    op.drop_table("workflow_runs")
