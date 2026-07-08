"""add curated column to collected_records

Revision ID: n4i5j6k7l8m9
Revises: m3h4i5j6k7l8
Create Date: 2026-07-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'n4i5j6k7l8m9'
down_revision: Union[str, None] = 'm3h4i5j6k7l8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # "精选" flag (架构决策 #6): human-curated only in v1, defaults to False for
    # all existing rows.
    op.add_column(
        'collected_records',
        sa.Column('curated', sa.Boolean(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('collected_records', 'curated')
