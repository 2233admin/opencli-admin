"""add workspace RBAC foundation"""

import sqlalchemy as sa
from alembic import op

revision = "b9c0d1e2f3a4"
down_revision = ("b1c2d3e4f5a6", "d8e9f0a1b2c3", "m2n3o4p5q6r7")
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
    role = sa.Enum("admin", "maintainer", "operator", "viewer", name="workspace_role")
    op.create_table(
        "users",
        sa.Column("subject", sa.String(255), nullable=False, unique=True),
        sa.Column("email", sa.String(320)),
        sa.Column("display_name", sa.String(255)),
        sa.Column("disabled", sa.Boolean(), nullable=False),
        *_timestamps(),
    )
    op.create_table(
        "workspaces",
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        *_timestamps(),
    )
    op.create_table(
        "workspace_memberships",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", role, nullable=False),
        sa.UniqueConstraint("workspace_id", "user_id"),
        *_timestamps(),
    )
    op.create_table(
        "teams",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.UniqueConstraint("workspace_id", "slug"),
        *_timestamps(),
    )
    op.create_table(
        "team_memberships",
        sa.Column(
            "team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.UniqueConstraint("team_id", "user_id"),
        *_timestamps(),
    )
    op.create_table(
        "service_identities",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("disabled", sa.Boolean(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("workspace_id", "name"),
        *_timestamps(),
    )


def downgrade() -> None:
    for table in (
        "service_identities",
        "team_memberships",
        "teams",
        "workspace_memberships",
        "workspaces",
        "users",
    ):
        op.drop_table(table)
    sa.Enum(name="workspace_role").drop(op.get_bind(), checkfirst=True)
