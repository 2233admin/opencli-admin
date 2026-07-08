"""add actuator fields (review_required, paused_until) to data_sources

Revision ID: y5t6u7v8w9x0
Revises: x4s5t6u7v8w9
Create Date: 2026-07-02

Issue 03 (Control Cycle + Actuator): the actuator whitelist's `pause` and
`require_review` executed actions need somewhere durable to record their
effect on a source, distinct from the Evidence Ledger row that records WHY:

  * `review_required` — a boolean review flag surfaced in the UI. Set True by
    an executed `require_review` action (including the Require-Review
    Downgrade for out-of-whitelist suggestions); cleared by a human, not by
    the Control Cycle.
  * `paused_until` — a nullable TTL timestamp. Set by an executed `pause`
    action (alongside `DataSource.enabled = False`); the Control Cycle
    auto-resumes (re-enables, clears this column) sources whose TTL has
    expired and records the inverse action in the ledger.

Both default to their "no actuator effect yet" value so every pre-existing
row is unaffected; no backfill needed.
"""
import sqlalchemy as sa
from alembic import op

revision = "y5t6u7v8w9x0"
down_revision = "x4s5t6u7v8w9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_sources",
        sa.Column(
            "review_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "data_sources",
        sa.Column("paused_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("data_sources", "paused_until")
    op.drop_column("data_sources", "review_required")
