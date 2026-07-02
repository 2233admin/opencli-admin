"""add control_actions table (advisory evidence ledger)

Revision ID: w3r4s5t6u7v8
Revises: v2q3r4s5t6u7
Create Date: 2026-07-02

PR-Control-3.5: persist every advisory ControlAction suggestion the
control-state endpoint surfaces (backend/control/ledger.py), so a later
outcome pass (backend/control/outcomes.py) can judge each suggestion against
the source's subsequent source_measurements rows — recovered / persisted /
insufficient_data. The aggregated agreement/recovery report over this table
is the gate data for ever flipping Settings.control_mode="automatic".

mode + executed columns are reserved for PR-Control-4's actuator to reuse
the same ledger; in this PR mode is always "advisory" and executed is always
False — nothing executes, and writing here never mutates a DataSource.

Table is new/empty, so the NOT NULL columns need no backfill.
"""
import sqlalchemy as sa
from alembic import op

revision = "w3r4s5t6u7v8"
down_revision = "v2q3r4s5t6u7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "control_actions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("measurement_id", sa.String(length=36), nullable=True),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("action_type", sa.String(length=64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("executed", sa.Boolean(), nullable=False),
        sa.Column("measurement_before", sa.JSON(), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome", sa.String(length=32), nullable=True),
        sa.Column("outcome_detail", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_control_actions_source_id", "control_actions", ["source_id"])
    op.create_index("ix_control_actions_run_id", "control_actions", ["run_id"])
    op.create_index("ix_control_actions_measurement_id", "control_actions", ["measurement_id"])


def downgrade() -> None:
    op.drop_index("ix_control_actions_measurement_id", table_name="control_actions")
    op.drop_index("ix_control_actions_run_id", table_name="control_actions")
    op.drop_index("ix_control_actions_source_id", table_name="control_actions")
    op.drop_table("control_actions")
