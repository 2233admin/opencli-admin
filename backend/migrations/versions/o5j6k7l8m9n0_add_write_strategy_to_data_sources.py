"""add write_strategy to data_sources (strangler-fig sink selection)

Revision ID: o5j6k7l8m9n0
Revises: n4i5j6k7l8m9
Create Date: 2026-07-01

Adds ``data_sources.write_strategy`` — the per-source state that selects which
write sink the pipeline uses (``backend.pipeline.sinks.strategy.select_sink``):
``legacy | odp_shadow | odp_dual_required | odp_primary | odp_only``.

``server_default='legacy'`` so every existing row keeps the original behavior
(DB write with its env-gated ODP shadow-forward); the column is non-null. Wrapped
in ``batch_alter_table`` for SQLite, which rewrites the table to add/drop columns.
"""
import sqlalchemy as sa
from alembic import op

revision = "o5j6k7l8m9n0"
down_revision = "n4i5j6k7l8m9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("data_sources") as batch:
        batch.add_column(
            sa.Column(
                "write_strategy",
                sa.String(length=32),
                nullable=False,
                server_default="legacy",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("data_sources") as batch:
        batch.drop_column("write_strategy")
