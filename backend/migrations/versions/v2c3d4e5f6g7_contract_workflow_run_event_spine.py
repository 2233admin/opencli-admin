"""contract the WorkflowRun event spine after writer reconciliation

Revision ID: v2c3d4e5f6g7
Revises: v1b2c3d4e5f7
Create Date: 2026-07-23

Deploy this revision only after workflow writers have been stopped, counters
reconciled to MAX(sequence) + 1, and every writer has moved to the shared
append-only service. The preflight aborts rather than repairing conflicts.
"""

import sqlalchemy as sa
from alembic import op

revision = "v2c3d4e5f6g7"
down_revision = "v1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    duplicate_sequences = connection.execute(
        sa.text(
            """
            SELECT run_id, sequence, COUNT(*) AS duplicate_count
            FROM workflow_run_events
            GROUP BY run_id, sequence
            HAVING COUNT(*) > 1
            """
        )
    ).first()
    duplicate_event_ids = connection.execute(
        sa.text(
            """
            SELECT event_id, COUNT(*) AS duplicate_count
            FROM workflow_run_events
            GROUP BY event_id
            HAVING COUNT(*) > 1
            """
        )
    ).first()
    counter_drift = connection.execute(
        sa.text(
            """
            SELECT workflow_runs.id, workflow_runs.next_event_sequence,
                   COALESCE(MAX(workflow_run_events.sequence), 0) + 1 AS expected_sequence
            FROM workflow_runs
            LEFT JOIN workflow_run_events
              ON workflow_run_events.run_id = workflow_runs.id
            GROUP BY workflow_runs.id, workflow_runs.next_event_sequence
            HAVING workflow_runs.next_event_sequence
                <> COALESCE(MAX(workflow_run_events.sequence), 0) + 1
            """
        )
    ).first()
    failures = []
    if duplicate_sequences is not None:
        failures.append(f"duplicate run sequence: {tuple(duplicate_sequences)}")
    if duplicate_event_ids is not None:
        failures.append(f"duplicate event_id: {tuple(duplicate_event_ids)}")
    if counter_drift is not None:
        failures.append(f"counter drift: {tuple(counter_drift)}")
    if failures:
        raise RuntimeError(
            "WorkflowRun event spine contract preflight failed: " + "; ".join(failures)
        )

    op.drop_index("ix_workflow_run_events_event_id", table_name="workflow_run_events")
    op.create_index(
        "ix_workflow_run_events_event_id",
        "workflow_run_events",
        ["event_id"],
        unique=True,
    )
    op.create_index(
        "ux_workflow_run_events_run_id_sequence",
        "workflow_run_events",
        ["run_id", "sequence"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ux_workflow_run_events_run_id_sequence",
        table_name="workflow_run_events",
    )
    op.drop_index("ix_workflow_run_events_event_id", table_name="workflow_run_events")
    op.create_index(
        "ix_workflow_run_events_event_id",
        "workflow_run_events",
        ["event_id"],
        unique=False,
    )
