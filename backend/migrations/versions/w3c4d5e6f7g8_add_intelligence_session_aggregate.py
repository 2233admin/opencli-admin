"""add the native IntelligenceSession aggregate and transactional outbox

Revision ID: w3c4d5e6f7g8
Revises: v2c3d4e5f6g7
Create Date: 2026-07-23
"""

import sqlalchemy as sa
from alembic import op

revision = "w3c4d5e6f7g8"
down_revision = "v2c3d4e5f6g7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intelligence_sessions",
        sa.Column("created_by_run_id", sa.String(length=36), nullable=True),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("version", sa.Integer(), server_default="0", nullable=False),
        sa.Column("transition_sequence", sa.Integer(), server_default="0", nullable=False),
        sa.Column("workflow_projection", sa.JSON(), nullable=False),
        sa.Column("retry_metadata", sa.JSON(), nullable=True),
        sa.Column("operation_id", sa.String(length=255), nullable=True),
        sa.Column("operation_command", sa.String(length=50), nullable=True),
        sa.Column("operation_idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("operation_request_hash", sa.String(length=64), nullable=True),
        sa.Column("lease_owner", sa.String(length=255), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("operation_attempt", sa.Integer(), nullable=True),
        sa.Column("checkpoint_manifest", sa.JSON(), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_run_id"], ["workflow_runs.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_intelligence_sessions_created_by_run_id",
        "intelligence_sessions",
        ["created_by_run_id"],
    )
    op.create_index(
        "ix_intelligence_sessions_lease_expires_at",
        "intelligence_sessions",
        ["lease_expires_at"],
    )

    op.create_table(
        "intelligence_artifacts",
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("artifact_id", sa.String(length=255), nullable=False),
        sa.Column("schema_version", sa.String(length=50), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("simulated", sa.Boolean(), nullable=False),
        sa.Column("provenance", sa.JSON(), nullable=False),
        sa.Column("algorithm_version", sa.String(length=100), nullable=False),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["intelligence_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "artifact_id",
            name="uq_intelligence_artifacts_session_artifact",
        ),
    )
    op.create_index(
        "ix_intelligence_artifacts_session_id",
        "intelligence_artifacts",
        ["session_id"],
    )
    op.create_index(
        "ix_intelligence_artifacts_session_kind",
        "intelligence_artifacts",
        ["session_id", "kind"],
    )

    op.create_table(
        "intelligence_artifact_references",
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("source_artifact_id", sa.String(length=255), nullable=False),
        sa.Column("target_artifact_id", sa.String(length=255), nullable=False),
        sa.Column(
            "relation",
            sa.String(length=50),
            server_default="grounded_by",
            nullable=False,
        ),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id", "source_artifact_id"],
            ["intelligence_artifacts.session_id", "intelligence_artifacts.artifact_id"],
            name="fk_intelligence_reference_source_same_session",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["session_id", "target_artifact_id"],
            ["intelligence_artifacts.session_id", "intelligence_artifacts.artifact_id"],
            name="fk_intelligence_reference_target_same_session",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "source_artifact_id",
            "target_artifact_id",
            "relation",
            name="uq_intelligence_artifact_reference",
        ),
    )
    op.create_index(
        "ix_intelligence_artifact_references_session_id",
        "intelligence_artifact_references",
        ["session_id"],
    )

    op.create_table(
        "intelligence_transitions",
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("command", sa.String(length=50), nullable=False),
        sa.Column("from_state", sa.String(length=50), nullable=False),
        sa.Column("to_state", sa.String(length=50), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"], ["workflow_runs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["intelligence_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "sequence",
            name="uq_intelligence_transitions_session_sequence",
        ),
    )
    op.create_index(
        "ix_intelligence_transitions_event_id",
        "intelligence_transitions",
        ["event_id"],
        unique=True,
    )
    op.create_index(
        "ix_intelligence_transitions_run_id",
        "intelligence_transitions",
        ["run_id"],
    )
    op.create_index(
        "ix_intelligence_transitions_session_id",
        "intelligence_transitions",
        ["session_id"],
    )

    op.create_table(
        "intelligence_command_records",
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("command", sa.String(length=50), nullable=False),
        sa.Column("resulting_version", sa.Integer(), nullable=False),
        sa.Column("transition_event_id", sa.String(length=255), nullable=True),
        sa.Column("result_artifact_ids", sa.JSON(), nullable=False),
        sa.Column("result_payload", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["intelligence_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "idempotency_key",
            name="uq_intelligence_commands_session_idempotency",
        ),
    )
    op.create_index(
        "ix_intelligence_command_records_session_id",
        "intelligence_command_records",
        ["session_id"],
    )

    op.create_table(
        "intelligence_outbox",
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("topic", sa.String(length=100), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], ["intelligence_sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_intelligence_outbox_delivery",
        "intelligence_outbox",
        ["state", "available_at"],
    )
    op.create_index(
        "ix_intelligence_outbox_event_id",
        "intelligence_outbox",
        ["event_id"],
        unique=True,
    )
    op.create_index(
        "ix_intelligence_outbox_session_id",
        "intelligence_outbox",
        ["session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_intelligence_outbox_session_id", table_name="intelligence_outbox")
    op.drop_index("ix_intelligence_outbox_event_id", table_name="intelligence_outbox")
    op.drop_index("ix_intelligence_outbox_delivery", table_name="intelligence_outbox")
    op.drop_table("intelligence_outbox")
    op.drop_index(
        "ix_intelligence_command_records_session_id",
        table_name="intelligence_command_records",
    )
    op.drop_table("intelligence_command_records")
    op.drop_index(
        "ix_intelligence_transitions_session_id",
        table_name="intelligence_transitions",
    )
    op.drop_index(
        "ix_intelligence_transitions_run_id",
        table_name="intelligence_transitions",
    )
    op.drop_index(
        "ix_intelligence_transitions_event_id",
        table_name="intelligence_transitions",
    )
    op.drop_table("intelligence_transitions")
    op.drop_index(
        "ix_intelligence_artifact_references_session_id",
        table_name="intelligence_artifact_references",
    )
    op.drop_table("intelligence_artifact_references")
    op.drop_index(
        "ix_intelligence_artifacts_session_kind",
        table_name="intelligence_artifacts",
    )
    op.drop_index(
        "ix_intelligence_artifacts_session_id",
        table_name="intelligence_artifacts",
    )
    op.drop_table("intelligence_artifacts")
    op.drop_index(
        "ix_intelligence_sessions_lease_expires_at",
        table_name="intelligence_sessions",
    )
    op.drop_index(
        "ix_intelligence_sessions_created_by_run_id",
        table_name="intelligence_sessions",
    )
    op.drop_table("intelligence_sessions")
