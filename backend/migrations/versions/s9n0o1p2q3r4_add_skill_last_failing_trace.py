"""add skills.last_failing_trace

Revision ID: s9n0o1p2q3r4
Revises: q7l8m9n0o1p2
Create Date: 2026-07-01

Full journey_trace_v1 of the most recent failing run — self_eval/evidence only
ever stored a trace_id + outcome summary, so a human looking at a
correction_proposed entry had no trace body to redistill from later. Overwritten
on each fail (v1: most recent only, same call as re_distill's single-trace
redistillation).
"""
import sqlalchemy as sa
from alembic import op

revision = "s9n0o1p2q3r4"
down_revision = "q7l8m9n0o1p2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skills", sa.Column("last_failing_trace", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("skills", "last_failing_trace")
