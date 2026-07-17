"""Alembic migration for browser worker profile/session resources."""

import sqlalchemy as sa
from alembic import op

revision = "aa1b2c3d4e5f"
down_revision = "z6u7v8w9x0y1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profile_bindings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("profile_id", sa.String(length=255), nullable=False),
        sa.Column("site", sa.String(length=100), nullable=False),
        sa.Column("browser_endpoint", sa.String(length=255), nullable=False),
        sa.Column("mutation_mode", sa.String(length=20), nullable=False, server_default="read"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("profile_id", name="uq_profile_bindings_profile_id"),
    )
    op.create_index("ix_profile_bindings_site", "profile_bindings", ["site"])

    op.create_table(
        "session_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("profile_binding_id", sa.String(length=36), nullable=False),
        sa.Column("blob_uri", sa.String(length=512), nullable=True),
        sa.Column("snapshot_id", sa.String(length=255), nullable=False),
        sa.Column("snapshot_type", sa.String(length=20), nullable=False, server_default="read"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("snapshot_id", name="uq_session_snapshots_snapshot_id"),
    )
    op.create_index(
        "ix_session_snapshots_profile_binding_id",
        "session_snapshots",
        ["profile_binding_id"],
    )

    op.create_table(
        "profile_locks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("profile_binding_id", sa.String(length=36), nullable=False),
        sa.Column("worker_slot_id", sa.String(length=255), nullable=False),
        sa.Column("lock_token", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("profile_binding_id", name="uq_profile_locks_binding"),
        sa.UniqueConstraint("lock_token", name="uq_profile_locks_lock_token"),
    )
    op.create_index("ix_profile_locks_profile_binding_id", "profile_locks", ["profile_binding_id"])


def downgrade() -> None:
    op.drop_index("ix_profile_locks_profile_binding_id", table_name="profile_locks")
    op.drop_table("profile_locks")
    op.drop_index("ix_session_snapshots_profile_binding_id", table_name="session_snapshots")
    op.drop_table("session_snapshots")
    op.drop_index("ix_profile_bindings_site", table_name="profile_bindings")
    op.drop_table("profile_bindings")
