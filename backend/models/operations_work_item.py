from enum import StrEnum

from sqlalchemy import JSON, CheckConstraint, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class WorkItemType(StrEnum):
    INCIDENT = "incident"
    APPROVAL = "approval"
    CHANGE_PROPOSAL = "change_proposal"
    REVIEW = "review"


class WorkItemStatus(StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"
    DISMISSED = "dismissed"


class Severity(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Priority(StrEnum):
    URGENT = "urgent"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class OperationsWorkItem(TimestampMixin):
    """One authoritative item in a Workspace's shared Operations Inbox."""

    __tablename__ = "operations_work_items"
    __table_args__ = (
        CheckConstraint(
            "type IN ('incident', 'approval', 'change_proposal', 'review')",
            name="ck_operations_work_items_type",
        ),
        CheckConstraint(
            "status IN ('open', 'in_progress', 'resolved', 'closed', 'dismissed')",
            name="ck_operations_work_items_status",
        ),
        CheckConstraint(
            "severity IN ('critical', 'high', 'medium', 'low')",
            name="ck_operations_work_items_severity",
        ),
        CheckConstraint(
            "priority IN ('urgent', 'high', 'normal', 'low')",
            name="ck_operations_work_items_priority",
        ),
    )

    workspace_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=WorkItemStatus.OPEN)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default=Severity.LOW)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default=Priority.NORMAL)
    owning_team_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    assignee_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    author_actor_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    author_actor_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    evidence: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    proposal_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
