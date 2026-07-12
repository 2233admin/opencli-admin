from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import TimestampMixin


class ValidationRun(TimestampMixin):
    """A single compile+conformance validation attempt gating draft publish."""

    __tablename__ = "validation_runs"

    draft_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workflow_drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    compile_valid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    compile_errors: Mapped[list | None] = mapped_column(JSON, nullable=True)
    conformance_mode: Mapped[str] = mapped_column(String(50), nullable=False, default="passthrough")
    expected_events: Mapped[list | None] = mapped_column(JSON, nullable=True)
    conformance_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    runtime_passport: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    run_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True
    )
    failure_reason: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    version: Mapped["WorkflowVersion | None"] = relationship(
        "WorkflowVersion", back_populates="validation_run", uselist=False
    )
