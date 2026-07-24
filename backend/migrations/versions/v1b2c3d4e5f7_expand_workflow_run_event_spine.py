"""expand the WorkflowRun event spine

Revision ID: v1b2c3d4e5f7
Revises: z5f6g7h8i9j0
Create Date: 2026-07-23

This revision is compatible with legacy event writers. Before deploying the
shared writer, operators must stop all writers and reconcile the counter again;
the contract revision performs the later audit gate.
"""

import sqlalchemy as sa
from alembic import op

revision = "v1b2c3d4e5f7"
down_revision = "z5f6g7h8i9j0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workflow_runs",
        sa.Column(
            "next_event_sequence",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.execute(
        """
        UPDATE workflow_runs
        SET next_event_sequence = COALESCE(
            (
                SELECT MAX(workflow_run_events.sequence) + 1
                FROM workflow_run_events
                WHERE workflow_run_events.run_id = workflow_runs.id
            ),
            1
        )
        """
    )


def downgrade() -> None:
    op.drop_column("workflow_runs", "next_event_sequence")
