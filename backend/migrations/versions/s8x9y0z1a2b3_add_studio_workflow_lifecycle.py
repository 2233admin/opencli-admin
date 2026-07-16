"""add Studio workflow validation and immutable versions

Revision ID: s8x9y0z1a2b3
Revises: r7w8x9y0z1a2
"""

import sqlalchemy as sa
from alembic import op

revision = "s8x9y0z1a2b3"
down_revision = "r7w8x9y0z1a2"
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
    with op.batch_alter_table("studio_projects") as batch:
        batch.add_column(
            sa.Column("primary_workflow_id", sa.String(36), nullable=True)
        )
        batch.create_foreign_key(
            "fk_studio_projects_primary_workflow_id",
            "studio_workflows",
            ["primary_workflow_id"],
            ["id"],
            ondelete="SET NULL",
        )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE studio_projects
            SET primary_workflow_id = (
                SELECT studio_workflows.id
                FROM studio_workflows
                WHERE studio_workflows.project_id = studio_projects.id
                ORDER BY studio_workflows.created_at ASC, studio_workflows.id ASC
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1
                FROM studio_workflows
                WHERE studio_workflows.project_id = studio_projects.id
            )
            """
        )
    )

    op.create_table(
        "studio_workflow_validation_runs",
        sa.Column("workflow_id", sa.String(36), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("valid", sa.Boolean(), nullable=False),
        sa.Column("errors", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("compile_version", sa.String(32), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["workflow_id"], ["studio_workflows.id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_studio_workflow_validation_runs_workflow_id",
        "studio_workflow_validation_runs",
        ["workflow_id"],
    )
    op.create_table(
        "studio_workflow_versions",
        sa.Column("workflow_id", sa.String(36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("draft_revision", sa.Integer(), nullable=False),
        sa.Column("graph", sa.JSON(), nullable=False),
        sa.Column("compile_version", sa.String(32), nullable=False),
        sa.Column("validation_run_id", sa.String(36), nullable=False),
        sa.Column("published_by_user_id", sa.String(100), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["workflow_id"], ["studio_workflows.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["validation_run_id"],
            ["studio_workflow_validation_runs.id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("workflow_id", "version"),
    )
    op.create_index(
        "ix_studio_workflow_versions_workflow_id",
        "studio_workflow_versions",
        ["workflow_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_studio_workflow_versions_workflow_id",
        table_name="studio_workflow_versions",
    )
    op.drop_table("studio_workflow_versions")
    op.drop_index(
        "ix_studio_workflow_validation_runs_workflow_id",
        table_name="studio_workflow_validation_runs",
    )
    op.drop_table("studio_workflow_validation_runs")
    with op.batch_alter_table("studio_projects") as batch:
        batch.drop_constraint(
            "fk_studio_projects_primary_workflow_id",
            type_="foreignkey",
        )
        batch.drop_column("primary_workflow_id")
