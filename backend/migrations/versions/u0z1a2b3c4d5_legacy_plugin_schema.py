"""recognize the legacy plugin-hub migration head

Revision ID: u0z1a2b3c4d5
Revises: w2c3d4e5f6g7

The original plugin-hub branch used ``t9y0z1a2b3c4`` for record graph
ownership while main used that same revision ID for source cursor versioning.
Its next revision, ``u0z1a2b3c4d5``, created ``feed_providers``.

Main later re-chained equivalent record-graph and feed-provider migrations as
``v1b2c3d4e5f6`` and ``w2c3d4e5f6g7``. Keeping this historical revision ID as a
no-op successor lets databases already stamped at the plugin head rejoin the
canonical chain. The following migration repairs the two canonical columns
that the legacy path did not create.
"""

revision = "u0z1a2b3c4d5"
down_revision = "w2c3d4e5f6g7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
