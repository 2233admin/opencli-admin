"""add notification ack fields

Revision ID: m2n3o4p5q6r7
Revises: d8e9f0a1b2c3
Create Date: 2026-06-21

"""
import sqlalchemy as sa
from alembic import op

revision = 'm2n3o4p5q6r7'
down_revision = 'd8e9f0a1b2c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'notification_logs',
        sa.Column(
            'ack_status',
            sa.String(length=50),
            nullable=False,
            server_default='not_required',
        ),
    )
    op.add_column(
        'notification_logs',
        sa.Column('ack_data', sa.JSON(), nullable=True),
    )
    op.add_column(
        'notification_logs',
        sa.Column('acked_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('notification_logs', 'acked_at')
    op.drop_column('notification_logs', 'ack_data')
    op.drop_column('notification_logs', 'ack_status')
