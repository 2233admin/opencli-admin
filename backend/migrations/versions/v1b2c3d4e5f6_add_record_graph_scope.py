"""add indexed workflow ownership for project record graphs

Revision ID: v1b2c3d4e5f6
Revises: u0a1b2c3d4e5
Create Date: 2026-07-18

Project record previews must remain bounded when collected_records reaches
hundreds of thousands of rows. Workflow ownership previously lived only in JSON
payloads, which forced full scans. These nullable, indexed columns provide the
query seam for project-scoped aggregation while preserving legacy collectors.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "v1b2c3d4e5f6"
down_revision = "u0a1b2c3d4e5"
branch_labels = None
depends_on = None


def _object(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


def upgrade() -> None:
    with op.batch_alter_table("collected_records") as batch:
        batch.add_column(sa.Column("workflow_id", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("workflow_run_id", sa.String(length=36), nullable=True))
        batch.create_index("ix_collected_records_task_id", ["task_id"], unique=False)
        batch.create_index("ix_collected_records_source_id", ["source_id"], unique=False)
        batch.create_index("ix_collected_records_workflow_id", ["workflow_id"], unique=False)
        batch.create_index(
            "ix_collected_records_workflow_run_id", ["workflow_run_id"], unique=False
        )

    connection = op.get_bind()
    records = sa.table(
        "collected_records",
        sa.column("id", sa.String()),
        sa.column("task_id", sa.String()),
        sa.column("raw_data", sa.JSON()),
        sa.column("workflow_id", sa.String()),
        sa.column("workflow_run_id", sa.String()),
    )
    tasks = sa.table(
        "collection_tasks",
        sa.column("id", sa.String()),
        sa.column("parameters", sa.JSON()),
    )

    task_workflow: dict[str, tuple[str | None, str | None]] = {}
    for task_id, parameters in connection.execute(
        sa.select(tasks.c.id, tasks.c.parameters)
    ):
        payload = _object(parameters)
        task_workflow[str(task_id)] = (
            payload.get("workflowId") if isinstance(payload.get("workflowId"), str) else None,
            payload.get("workflowRunId")
            if isinstance(payload.get("workflowRunId"), str)
            else None,
        )

    for record_id, task_id, raw_data in connection.execute(
        sa.select(records.c.id, records.c.task_id, records.c.raw_data)
    ):
        raw = _object(raw_data)
        workflow_id, task_run_id = task_workflow.get(str(task_id), (None, None))
        raw_run_id = raw.get("_workflowRunId")
        workflow_run_id = (
            raw_run_id if isinstance(raw_run_id, str) and raw_run_id else task_run_id
        )
        if workflow_id or workflow_run_id:
            connection.execute(
                records.update()
                .where(records.c.id == record_id)
                .values(
                    workflow_id=workflow_id,
                    workflow_run_id=workflow_run_id,
                )
            )


def downgrade() -> None:
    with op.batch_alter_table("collected_records") as batch:
        batch.drop_index("ix_collected_records_workflow_run_id")
        batch.drop_index("ix_collected_records_workflow_id")
        batch.drop_index("ix_collected_records_source_id")
        batch.drop_index("ix_collected_records_task_id")
        batch.drop_column("workflow_run_id")
        batch.drop_column("workflow_id")
