"""recognize the final legacy plugin-workspace migration head

Revision ID: z5f6g7h8i9j0
Revises: u0z1a2b3c4d5

Some persisted Studio workspaces were last written by the historical plugin
branch and are stamped at ``z5f6g7h8i9j0``. That branch's plugin registry is no
longer consumed by the native runtime, so the current schema only needs the
revision marker to rejoin those databases without replaying obsolete plugin DDL.

Fresh databases also pass through this no-op marker, which keeps one linear
Alembic history while allowing both legacy and current workspaces to upgrade to
the native event-spine and IntelligenceSession migrations that follow.
"""

revision = "z5f6g7h8i9j0"
down_revision = "u0z1a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
