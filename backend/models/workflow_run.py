from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import TimestampMixin


class WorkflowRun(TimestampMixin):
    """Persisted WorkflowProject run projection and restart input."""

    __tablename__ = "workflow_runs"

    workflow_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    trace_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    package_node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    request: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    projection: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    events: Mapped[list["WorkflowRunEvent"]] = relationship(
        "WorkflowRunEvent",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="WorkflowRunEvent.sequence",
    )


class WorkflowRunEvent(TimestampMixin):
    """A replayable node-level event emitted by the workflow runtime."""

    __tablename__ = "workflow_run_events"

    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workflow_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    trace_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    event_id: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    run: Mapped["WorkflowRun"] = relationship("WorkflowRun", back_populates="events")
