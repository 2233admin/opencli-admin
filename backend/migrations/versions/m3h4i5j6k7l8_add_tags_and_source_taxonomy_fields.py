"""add tags/tag_bindings tables and data_sources public/default_category columns

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-07-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'm3h4i5j6k7l8'
down_revision: Union[str, None] = 'l2g3h4i5j6k7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tags',
        sa.Column('id', sa.String(36), nullable=False),
        # category | subtag
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tags_type_name', 'tags', ['type', 'name'])

    op.create_table(
        'tag_bindings',
        sa.Column('id', sa.String(36), nullable=False),
        # No DB-level FK on tag_id/target_id (Dify pattern) — integrity is
        # enforced at the service layer (TagService, PR-B).
        sa.Column('tag_id', sa.String(36), nullable=False),
        sa.Column('target_id', sa.String(36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tag_bindings_tag_id', 'tag_bindings', ['tag_id'])
    op.create_index('ix_tag_bindings_target_id', 'tag_bindings', ['target_id'])

    op.add_column(
        'data_sources',
        sa.Column('public', sa.Boolean(), nullable=False, server_default='0'),
    )
    op.add_column(
        'data_sources',
        sa.Column('default_category', sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('data_sources', 'default_category')
    op.drop_column('data_sources', 'public')

    op.drop_index('ix_tag_bindings_target_id', table_name='tag_bindings')
    op.drop_index('ix_tag_bindings_tag_id', table_name='tag_bindings')
    op.drop_table('tag_bindings')

    op.drop_index('ix_tags_type_name', table_name='tags')
    op.drop_table('tags')
