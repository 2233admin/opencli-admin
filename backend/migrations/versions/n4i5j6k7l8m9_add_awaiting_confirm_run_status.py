"""add awaiting_confirm run status (anchor for the skill confirm gate)

Revision ID: n4i5j6k7l8m9
Revises: m3h4i5j6k7l8
Create Date: 2026-06-30

Anchor migration for the skill execute-loop risk-tiered confirm gate (issue 04 /
ADR-0003 D4/D5/D8, PRD §5). It introduces the ``awaiting_confirm`` ``TaskRun``
status: a headless run that reaches a confirm-required action (a write matching
the skill's ``red_lines`` or the ``submit|pay|post|delete`` pattern, without
``auto_confirm``) aborts at this status instead of completing.

``TaskRun.status`` is free-text ``String(50)`` (``backend/models/task.py``), so
storing the new value needs **no DDL** — ``upgrade()`` is a documented no-op. The
migration exists so the feature owns the Alembic head and the new status string is
documented in the chain (the string itself is centralized as
``backend.skills.risk.AWAITING_CONFIRM``). The Phase-4 ``run.status`` write that
reads ``pipeline_result.metadata[AWAITING_CONFIRM]`` is issue 05.
"""
import sqlalchemy as sa  # noqa: F401
from alembic import op  # noqa: F401

revision = "n4i5j6k7l8m9"
down_revision = "m3h4i5j6k7l8"   # current head (m3h4i5j6k7l8_add_skills)
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No-op: TaskRun.status is free-text String(50); the new 'awaiting_confirm'
    # value needs no DDL. This migration is the anchor so the skill confirm-gate
    # feature owns the Alembic head and the status string is documented in the
    # chain. (PRD §5.)
    pass


def downgrade() -> None:
    pass
