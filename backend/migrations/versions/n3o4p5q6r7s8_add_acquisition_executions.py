"""add acquisition executions

Revision ID: n3o4p5q6r7s8
Revises: m2n3o4p5q6r7
Create Date: 2026-07-13

"""

import sqlalchemy as sa
from alembic import op

revision = "n3o4p5q6r7s8"
down_revision = "m2n3o4p5q6r7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "acquisition_executions",
        sa.Column("request_id", sa.String(length=255), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("capability_id", sa.String(length=255), nullable=False),
        sa.Column("capability_version", sa.String(length=50), nullable=False),
        sa.Column("output_schema_version", sa.String(length=50), nullable=False),
        sa.Column("input_payload", sa.JSON(), nullable=False),
        sa.Column("environment", sa.JSON(), nullable=False),
        sa.Column("required_artifacts", sa.JSON(), nullable=False),
        sa.Column("geo_refs", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("result_payload", sa.JSON(), nullable=True),
        sa.Column("failure", sa.JSON(), nullable=True),
        sa.Column("trace_ref", sa.Text(), nullable=True),
        sa.Column("artifact_refs", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_acquisition_executions_idempotency_key"),
        "acquisition_executions",
        ["idempotency_key"],
        unique=True,
    )
    op.create_index(
        op.f("ix_acquisition_executions_request_id"),
        "acquisition_executions",
        ["request_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_acquisition_executions_request_id"),
        table_name="acquisition_executions",
    )
    op.drop_index(
        op.f("ix_acquisition_executions_idempotency_key"),
        table_name="acquisition_executions",
    )
    op.drop_table("acquisition_executions")
