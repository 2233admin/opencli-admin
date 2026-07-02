"""add objective_override column to data_sources

Revision ID: x4s5t6u7v8w9
Revises: w3r4s5t6u7v8
Create Date: 2026-07-02

Issue 02 (per-source objective override): a nullable JSON column holding a
partial SourceObjective override (backend.control.objectives.
SourceObjectiveOverride). Null means "no override, use the global default
SourceObjective()" — the existing behavior for every pre-existing row, so no
backfill is needed. Resolution (override merged over defaults) happens
uniformly through backend.control.objectives.resolve_objective at both
consumption sites (control-state decision path, outcome judgment).
"""
import sqlalchemy as sa
from alembic import op

revision = "x4s5t6u7v8w9"
down_revision = "w3r4s5t6u7v8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_sources",
        sa.Column("objective_override", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("data_sources", "objective_override")
