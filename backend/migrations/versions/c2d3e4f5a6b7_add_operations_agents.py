"""add versioned operations agent identities and permission profiles"""

import sqlalchemy as sa
from alembic import op

revision = "c2d3e4f5a6b7"
down_revision = "b9c0d1e2f3a4"
branch_labels = None
depends_on = None


def _timestamps():
    return (
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def upgrade() -> None:
    op.create_table(
        "operations_agent_identities",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owning_team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("disabled", sa.Boolean(), nullable=False),
        sa.Column("current_profile_version", sa.Integer(), nullable=False),
        sa.Column("current_published_version", sa.Integer()),
        sa.UniqueConstraint("workspace_id", "name"),
        *_timestamps(),
    )
    op.create_index(
        "ix_operations_agent_identities_workspace_id",
        "operations_agent_identities",
        ["workspace_id"],
    )
    op.create_index(
        "ix_operations_agent_identities_owning_team_id",
        "operations_agent_identities",
        ["owning_team_id"],
    )
    op.create_table(
        "operations_agent_drafts",
        sa.Column(
            "operations_agent_id",
            sa.String(36),
            sa.ForeignKey("operations_agent_identities.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("model_configuration", sa.JSON(), nullable=False),
        sa.Column("tool_configuration", sa.JSON(), nullable=False),
        sa.Column(
            "updated_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        *_timestamps(),
    )
    op.create_table(
        "published_operations_agent_versions",
        sa.Column(
            "operations_agent_id",
            sa.String(36),
            sa.ForeignKey("operations_agent_identities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("model_configuration", sa.JSON(), nullable=False),
        sa.Column("tool_configuration", sa.JSON(), nullable=False),
        sa.Column(
            "published_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.UniqueConstraint("operations_agent_id", "version"),
        *_timestamps(),
    )
    op.create_index(
        "ix_published_operations_agent_versions_operations_agent_id",
        "published_operations_agent_versions",
        ["operations_agent_id"],
    )
    op.create_table(
        "agent_permission_profiles",
        sa.Column(
            "operations_agent_id",
            sa.String(36),
            sa.ForeignKey("operations_agent_identities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("tool_scope", sa.JSON(), nullable=False),
        sa.Column("resource_scope", sa.JSON(), nullable=False),
        sa.Column("action_scope", sa.JSON(), nullable=False),
        sa.Column(
            "assigned_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "mode IN ('observe_only', 'suggest_changes', 'low_risk_automatic')",
            name="ck_agent_permission_profiles_mode",
        ),
        sa.UniqueConstraint("operations_agent_id", "version"),
        *_timestamps(),
    )
    op.create_index(
        "ix_agent_permission_profiles_operations_agent_id",
        "agent_permission_profiles",
        ["operations_agent_id"],
    )
    op.create_table(
        "operations_agent_runs",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "operations_agent_id",
            sa.String(36),
            sa.ForeignKey("operations_agent_identities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("published_version", sa.Integer(), nullable=False),
        sa.Column("profile_version", sa.Integer(), nullable=False),
        sa.Column("trigger_type", sa.String(16), nullable=False),
        sa.Column("trigger_reference", sa.String(255)),
        sa.Column("target_resource_type", sa.String(100), nullable=False),
        sa.Column("target_resource_id", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column(
            "started_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')",
            name="ck_operations_agent_runs_status",
        ),
        sa.CheckConstraint(
            "trigger_type IN ('manual', 'scheduled', 'event')",
            name="ck_operations_agent_runs_trigger_type",
        ),
        *_timestamps(),
    )
    op.create_index(
        "ix_operations_agent_runs_workspace_id",
        "operations_agent_runs",
        ["workspace_id"],
    )
    op.create_index(
        "ix_operations_agent_runs_operations_agent_id",
        "operations_agent_runs",
        ["operations_agent_id"],
    )


def downgrade() -> None:
    op.drop_table("operations_agent_runs")
    op.drop_table("agent_permission_profiles")
    op.drop_table("published_operations_agent_versions")
    op.drop_table("operations_agent_drafts")
    op.drop_table("operations_agent_identities")
