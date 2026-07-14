from datetime import datetime
from enum import StrEnum

from sqlalchemy import JSON, DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class AcquisitionExecutionStatus(StrEnum):
    ACCEPTED = "accepted"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def accepts_cancel_request(self) -> bool:
        return self in {
            self.ACCEPTED,
            self.QUEUED,
            self.RUNNING,
            self.CANCELLED,
        }

    def cancel(self) -> "AcquisitionExecutionStatus":
        if self in {self.ACCEPTED, self.QUEUED, self.RUNNING}:
            return self.CANCELLED
        return self


class AcquisitionExecution(TimestampMixin):
    """Durable executor-owned work accepted from a GEO deployment."""

    __tablename__ = "acquisition_executions"

    request_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    capability_id: Mapped[str] = mapped_column(String(255), nullable=False)
    capability_version: Mapped[str] = mapped_column(String(50), nullable=False)
    output_schema_version: Mapped[str] = mapped_column(String(50), nullable=False)
    input_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    environment: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    required_artifacts: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    geo_refs: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[AcquisitionExecutionStatus] = mapped_column(
        Enum(
            AcquisitionExecutionStatus,
            values_callable=lambda statuses: [status.value for status in statuses],
            native_enum=False,
            length=50,
        ),
        nullable=False,
        default=AcquisitionExecutionStatus.ACCEPTED,
    )
    result_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    failure: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    trace_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_refs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    lease_owner: Mapped[str | None] = mapped_column(String(36), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
