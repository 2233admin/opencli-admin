"""add workspace-scoped consumer grants"""

import sqlalchemy as sa
from alembic import op

revision = "d3e4f5a6b7c8"
down_revision = "c2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "consumer_grants",
        sa.Column(
            "service_identity_id",
            sa.String(36),
            sa.ForeignKey("service_identities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("resource_scope", sa.JSON(), nullable=False),
        sa.Column("data_scope", sa.JSON(), nullable=False),
        sa.Column("quota", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "created_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column(
            "revoked_by_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
        ),
        sa.Column("revocation_reason", sa.Text()),
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("service_identity_id", "name"),
    )
    op.create_index(
        "ix_consumer_grants_service_identity_id",
        "consumer_grants",
        ["service_identity_id"],
    )


def downgrade() -> None:
    op.drop_table("consumer_grants")
