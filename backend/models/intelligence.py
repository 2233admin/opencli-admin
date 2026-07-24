"""Durable persistence for the native IntelligenceSession aggregate."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin
from backend.workflow.native_intelligence_state import IntelligenceState


class IntelligenceSession(TimestampMixin):
    __tablename__ = "intelligence_sessions"

    created_by_run_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("workflow_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    state: Mapped[IntelligenceState] = mapped_column(
        Enum(
            IntelligenceState,
            values_callable=lambda values: [value.value for value in values],
            native_enum=False,
            length=50,
        ),
        nullable=False,
        default=IntelligenceState.CREATED,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    transition_sequence: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    workflow_projection: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    retry_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    operation_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    operation_command: Mapped[str | None] = mapped_column(String(50), nullable=True)
    operation_idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    operation_request_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    operation_attempt: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checkpoint_manifest: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class IntelligenceArtifact(TimestampMixin):
    __tablename__ = "intelligence_artifacts"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "artifact_id",
            name="uq_intelligence_artifacts_session_artifact",
        ),
        Index("ix_intelligence_artifacts_session_kind", "session_id", "kind"),
    )

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("intelligence_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    artifact_id: Mapped[str] = mapped_column(String(255), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(50), nullable=False)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    simulated: Mapped[bool] = mapped_column(nullable=False)
    provenance: Mapped[dict] = mapped_column(JSON, nullable=False)
    algorithm_version: Mapped[str] = mapped_column(String(100), nullable=False)
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)


class IntelligenceArtifactReference(TimestampMixin):
    __tablename__ = "intelligence_artifact_references"
    __table_args__ = (
        ForeignKeyConstraint(
            ["session_id", "source_artifact_id"],
            ["intelligence_artifacts.session_id", "intelligence_artifacts.artifact_id"],
            ondelete="CASCADE",
            name="fk_intelligence_reference_source_same_session",
        ),
        ForeignKeyConstraint(
            ["session_id", "target_artifact_id"],
            ["intelligence_artifacts.session_id", "intelligence_artifacts.artifact_id"],
            ondelete="RESTRICT",
            name="fk_intelligence_reference_target_same_session",
        ),
        UniqueConstraint(
            "session_id",
            "source_artifact_id",
            "target_artifact_id",
            "relation",
            name="uq_intelligence_artifact_reference",
        ),
    )

    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    source_artifact_id: Mapped[str] = mapped_column(String(255), nullable=False)
    target_artifact_id: Mapped[str] = mapped_column(String(255), nullable=False)
    relation: Mapped[str] = mapped_column(
        String(50), nullable=False, default="grounded_by", server_default="grounded_by"
    )


class IntelligenceTransition(TimestampMixin):
    __tablename__ = "intelligence_transitions"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "sequence",
            name="uq_intelligence_transitions_session_sequence",
        ),
        Index("ix_intelligence_transitions_event_id", "event_id", unique=True),
    )

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("intelligence_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    command: Mapped[str] = mapped_column(String(50), nullable=False)
    from_state: Mapped[str] = mapped_column(String(50), nullable=False)
    to_state: Mapped[str] = mapped_column(String(50), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    run_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("workflow_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)


class IntelligenceCommandRecord(TimestampMixin):
    __tablename__ = "intelligence_command_records"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "idempotency_key",
            name="uq_intelligence_commands_session_idempotency",
        ),
    )

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("intelligence_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    command: Mapped[str] = mapped_column(String(50), nullable=False)
    resulting_version: Mapped[int] = mapped_column(Integer, nullable=False)
    transition_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    result_artifact_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    result_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class IntelligenceOutbox(TimestampMixin):
    __tablename__ = "intelligence_outbox"
    __table_args__ = (
        Index("ix_intelligence_outbox_event_id", "event_id", unique=True),
        Index("ix_intelligence_outbox_delivery", "state", "available_at"),
    )

    event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("intelligence_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    topic: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


__all__ = [
    "IntelligenceArtifact",
    "IntelligenceArtifactReference",
    "IntelligenceCommandRecord",
    "IntelligenceOutbox",
    "IntelligenceSession",
    "IntelligenceTransition",
]
