"""add workflow authoring tables

Revision ID: r5s6t7u8v9w0
Revises: m2n3o4p5q6r7
Create Date: 2026-07-13

Persist the Workspace -> Project -> WorkflowDraft -> WorkflowVersion authoring
closed loop, plus the ValidationRun publish gate that a WorkflowVersion must
reference before it can be inserted.
"""

import sqlalchemy as sa
from alembic import op

revision = "r5s6t7u8v9w0"
down_revision = "m2n3o4p5q6r7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workspaces_slug", "workspaces", ["slug"], unique=True)

    op.create_table(
        "workspace_settings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("deterministic_simulation", sa.Boolean(), nullable=False),
        sa.Column("max_items_per_run", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_workspace_settings_workspace_id",
        "workspace_settings",
        ["workspace_id"],
        unique=True,
    )

    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_projects_workspace_slug"),
    )
    op.create_index("ix_projects_workspace_id", "projects", ["workspace_id"])

    op.create_table(
        "workflow_drafts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_drafts_project_id", "workflow_drafts", ["project_id"])

    op.create_table(
        "validation_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("draft_id", sa.String(length=36), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("compile_valid", sa.Boolean(), nullable=False),
        sa.Column("compile_errors", sa.JSON(), nullable=True),
        sa.Column("conformance_mode", sa.String(length=50), nullable=False),
        sa.Column("expected_events", sa.JSON(), nullable=True),
        sa.Column("conformance_result", sa.JSON(), nullable=True),
        sa.Column("runtime_passport", sa.JSON(), nullable=True),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("failure_reason", sa.String(length=2000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["draft_id"], ["workflow_drafts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["workflow_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_validation_runs_draft_id", "validation_runs", ["draft_id"])

    op.create_table(
        "workflow_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("draft_id", sa.String(length=36), nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.Column("validation_run_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["draft_id"], ["workflow_drafts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["validation_run_id"], ["validation_runs.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "version_number", name="uq_workflow_versions_project_number"
        ),
    )
    op.create_index("ix_workflow_versions_project_id", "workflow_versions", ["project_id"])
    op.create_index("ix_workflow_versions_draft_id", "workflow_versions", ["draft_id"])
    op.create_index(
        "ix_workflow_versions_validation_run_id",
        "workflow_versions",
        ["validation_run_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_workflow_versions_validation_run_id", table_name="workflow_versions")
    op.drop_index("ix_workflow_versions_draft_id", table_name="workflow_versions")
    op.drop_index("ix_workflow_versions_project_id", table_name="workflow_versions")
    op.drop_table("workflow_versions")
    op.drop_index("ix_validation_runs_draft_id", table_name="validation_runs")
    op.drop_table("validation_runs")
    op.drop_index("ix_workflow_drafts_project_id", table_name="workflow_drafts")
    op.drop_table("workflow_drafts")
    op.drop_index("ix_projects_workspace_id", table_name="projects")
    op.drop_table("projects")
    op.drop_index("ix_workspace_settings_workspace_id", table_name="workspace_settings")
    op.drop_table("workspace_settings")
    op.drop_index("ix_workspaces_slug", table_name="workspaces")
    op.drop_table("workspaces")
