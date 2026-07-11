from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class AgentProfileMode(StrEnum):
    OBSERVE_ONLY = "observe_only"
    SUGGEST_CHANGES = "suggest_changes"
    LOW_RISK_AUTOMATIC = "low_risk_automatic"


class OperationsAgentIdentity(TimestampMixin):
    """Stable Workspace identity for an internal operations agent."""

    __tablename__ = "operations_agent_identities"
    __table_args__ = (UniqueConstraint("workspace_id", "name"),)

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owning_team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    current_profile_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    current_published_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


class OperationsAgentDraft(TimestampMixin):
    """Mutable behavior draft; publishing copies it into an immutable version."""

    __tablename__ = "operations_agent_drafts"
    __table_args__ = (UniqueConstraint("operations_agent_id"),)

    operations_agent_id: Mapped[str] = mapped_column(
        ForeignKey("operations_agent_identities.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model_configuration: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    tool_configuration: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class PublishedOperationsAgentVersion(TimestampMixin):
    """Immutable behavior snapshot selected by operations agent runs."""

    __tablename__ = "published_operations_agent_versions"
    __table_args__ = (UniqueConstraint("operations_agent_id", "version"),)

    operations_agent_id: Mapped[str] = mapped_column(
        ForeignKey("operations_agent_identities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    instructions: Mapped[str] = mapped_column(Text, nullable=False)
    model_configuration: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    tool_configuration: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    published_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)


class AgentPermissionProfile(TimestampMixin):
    """Immutable, versioned preauthorization assigned to one operations agent."""

    __tablename__ = "agent_permission_profiles"
    __table_args__ = (
        UniqueConstraint("operations_agent_id", "version"),
        CheckConstraint(
            "mode IN ('observe_only', 'suggest_changes', 'low_risk_automatic')",
            name="ck_agent_permission_profiles_mode",
        ),
    )

    operations_agent_id: Mapped[str] = mapped_column(
        ForeignKey("operations_agent_identities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    tool_scope: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    resource_scope: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    action_scope: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    assigned_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)


class OperationsAgentRun(TimestampMixin):
    """Bound execution record for one published behavior and permission version."""

    __tablename__ = "operations_agent_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')",
            name="ck_operations_agent_runs_status",
        ),
        CheckConstraint(
            "trigger_type IN ('manual', 'scheduled', 'event')",
            name="ck_operations_agent_runs_trigger_type",
        ),
    )

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operations_agent_id: Mapped[str] = mapped_column(
        ForeignKey("operations_agent_identities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    published_version: Mapped[int] = mapped_column(Integer, nullable=False)
    profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(16), nullable=False)
    trigger_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_resource_type: Mapped[str] = mapped_column(String(100), nullable=False)
    target_resource_id: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    started_by_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
