from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import TimestampMixin


class StudioWorkspace(TimestampMixin):
    __tablename__ = "studio_workspaces"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class StudioProject(TimestampMixin):
    __tablename__ = "studio_projects"
    __table_args__ = (UniqueConstraint("workspace_id", "slug"),)

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("studio_workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
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
