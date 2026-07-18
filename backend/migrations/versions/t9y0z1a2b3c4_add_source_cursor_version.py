"""add version column to source_cursors (optimistic-concurrency cursor save)

Revision ID: t9y0z1a2b3c4
Revises: s8x9y0z1a2b3

AUDIT C10: ``DBCursorStore.save()`` used ``SELECT ... FOR UPDATE`` to guard
against two concurrent runs of the same source losing an update, but that
clause is a silent no-op on SQLite (the dialect accepts it but never takes a
row lock) — so the lost-update protection only ever existed on a Postgres
deployment. This adds an integer ``version`` column so ``save()`` can use
optimistic concurrency (``UPDATE ... WHERE version = ?``) instead, which
works identically on SQLite and Postgres.
"""

import sqlalchemy as sa
from alembic import op

revision = "t9y0z1a2b3c4"
down_revision = "s8x9y0z1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("source_cursors") as batch:
        batch.add_column(
            sa.Column("version", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("source_cursors") as batch:
        batch.drop_column("version")
