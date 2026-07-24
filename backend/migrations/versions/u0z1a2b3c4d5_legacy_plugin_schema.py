"""prepare the canonical chain for legacy plugin workspace heads

Revision ID: u0z1a2b3c4d5
Revises: u0a1b2c3d4e5

The historical plugin branch continued beyond this marker to
``z5f6g7h8i9j0``. The following compatibility revision recognizes that final
head, while this no-op keeps fresh canonical databases on the same linear
history without replaying obsolete plugin DDL.
"""

revision = "u0z1a2b3c4d5"
down_revision = "u0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
