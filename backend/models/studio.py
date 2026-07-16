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


class StudioWorkspace(TimestampMixin):
    __tablename__ = "studio_workspaces"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class StudioProject(TimestampMixin):
    __tablename__ = "studio_projects"
    __table_args__ = (
        UniqueConstraint("workspace_id", "slug"),
        CheckConstraint(
            "app_type IN ('chatbot', 'agent', 'chatflow', 'workflow', 'text-generator')",
            name="ck_studio_projects_app_type",
        ),
    )

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("studio_workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    app_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="workflow", server_default="workflow"
    )
    primary_workflow_id: Mapped[str | None] = mapped_column(
        ForeignKey(
            "studio_workflows.id",
            name="fk_studio_projects_primary_workflow_id",
            ondelete="SET NULL",
            use_alter=True,
        ),
        nullable=True,
    )
    created_by_user_id: Mapped[str] = mapped_column(String(100), nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class StudioWorkflow(TimestampMixin):
    __tablename__ = "studio_workflows"
    __table_args__ = (UniqueConstraint("project_id", "name"),)

    project_id: Mapped[str] = mapped_column(
        ForeignKey("studio_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_published_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class StudioWorkflowDraft(TimestampMixin):
    __tablename__ = "studio_workflow_drafts"

    workflow_id: Mapped[str] = mapped_column(
        ForeignKey("studio_workflows.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    graph: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_by_user_id: Mapped[str] = mapped_column(String(100), nullable=False)


class StudioWorkflowValidationRun(TimestampMixin):
    __tablename__ = "studio_workflow_validation_runs"

    workflow_id: Mapped[str] = mapped_column(
        ForeignKey("studio_workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    valid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    errors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    warnings: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    compile_version: Mapped[str] = mapped_column(String(32), nullable=False)


class StudioWorkflowVersion(TimestampMixin):
    __tablename__ = "studio_workflow_versions"
    __table_args__ = (UniqueConstraint("workflow_id", "version"),)

    workflow_id: Mapped[str] = mapped_column(
        ForeignKey("studio_workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    graph: Mapped[dict] = mapped_column(JSON, nullable=False)
    compile_version: Mapped[str] = mapped_column(String(32), nullable=False)
    validation_run_id: Mapped[str] = mapped_column(
        ForeignKey("studio_workflow_validation_runs.id", ondelete="RESTRICT"),
        nullable=False,
    )
    published_by_user_id: Mapped[str] = mapped_column(String(100), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
