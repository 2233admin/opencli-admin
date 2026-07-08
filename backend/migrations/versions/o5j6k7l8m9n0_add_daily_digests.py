"""add daily_digests table

Revision ID: o5j6k7l8m9n0
Revises: n4i5j6k7l8m9
Create Date: 2026-07-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'o5j6k7l8m9n0'
down_revision: Union[str, None] = 'n4i5j6k7l8m9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'daily_digests',
        sa.Column('id', sa.String(36), nullable=False),
        # Calendar date the digest snapshots (one row per day, not a timestamp).
        sa.Column('date', sa.Date(), nullable=False),
        # CollectedRecord.id values captured for this date (架构决策 #10).
        sa.Column('record_ids', sa.JSON(), nullable=False),
        # Optional LLM-generated summary; unused (no writer) in this PR.
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('date', name='uq_daily_digests_date'),
    )
    op.create_index('ix_daily_digests_date', 'daily_digests', ['date'])


def downgrade() -> None:
    op.drop_index('ix_daily_digests_date', table_name='daily_digests')
    op.drop_table('daily_digests')
