"""add persistent Studio authoring tables

Revision ID: q6v7w8x9y0z1
Revises: p5q6r7s8t9u0
"""

import sqlalchemy as sa
from alembic import op

revision = "q6v7w8x9y0z1"
down_revision = "p5q6r7s8t9u0"
branch_labels = None
depends_on = None


def _timestamps() -> tuple[sa.Column, ...]:
    return (
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def upgrade() -> None:
    op.create_table(
        "studio_workspaces",
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        *_timestamps(),
    )
    op.create_index("ix_studio_workspaces_slug", "studio_workspaces", ["slug"], unique=True)
    op.create_table(
        "studio_projects",
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(100), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["studio_workspaces.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workspace_id", "slug"),
    )
    op.create_index("ix_studio_projects_workspace_id", "studio_projects", ["workspace_id"])
    op.create_table(
        "studio_workflows",
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("current_published_version", sa.Integer(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["project_id"], ["studio_projects.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("project_id", "name"),
    )
    op.create_index("ix_studio_workflows_project_id", "studio_workflows", ["project_id"])
    op.create_table(
        "studio_workflow_drafts",
        sa.Column("workflow_id", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("graph", sa.JSON(), nullable=False),
        sa.Column("updated_by_user_id", sa.String(100), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workflow_id"], ["studio_workflows.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workflow_id"),
    )
    op.create_index(
        "ix_studio_workflow_drafts_workflow_id",
        "studio_workflow_drafts",
        ["workflow_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_studio_workflow_drafts_workflow_id", table_name="studio_workflow_drafts")
    op.drop_table("studio_workflow_drafts")
    op.drop_index("ix_studio_workflows_project_id", table_name="studio_workflows")
    op.drop_table("studio_workflows")
    op.drop_index("ix_studio_projects_workspace_id", table_name="studio_projects")
    op.drop_table("studio_projects")
    op.drop_index("ix_studio_workspaces_slug", table_name="studio_workspaces")
    op.drop_table("studio_workspaces")
