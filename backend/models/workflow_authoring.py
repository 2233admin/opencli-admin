from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.base import TimestampMixin


class Workspace(TimestampMixin):
    """A top-level container for Projects and their shared settings."""

    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    settings: Mapped["WorkspaceSettings"] = relationship(
        "WorkspaceSettings",
        back_populates="workspace",
        uselist=False,
        cascade="all, delete-orphan",
    )
    projects: Mapped[list["Project"]] = relationship(
        "Project",
        back_populates="workspace",
        cascade="all, delete-orphan",
    )


class WorkspaceSettings(TimestampMixin):
    """Workspace-scoped defaults applied to new WorkflowDraft snapshots."""

    __tablename__ = "workspace_settings"

    workspace_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Shanghai")
    deterministic_simulation: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    max_items_per_run: Mapped[int] = mapped_column(Integer, nullable=False, default=20)

    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="settings")


class Project(TimestampMixin):
    """A named unit of workflow authoring inside a Workspace."""

    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("workspace_id", "slug", name="uq_projects_workspace_slug"),)

    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)

    workspace: Mapped["Workspace"] = relationship("Workspace", back_populates="projects")
    drafts: Mapped[list["WorkflowDraft"]] = relationship(
        "WorkflowDraft",
        back_populates="project",
        cascade="all, delete-orphan",
    )
    versions: Mapped[list["WorkflowVersion"]] = relationship(
        "WorkflowVersion",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="WorkflowVersion.version_number",
    )


class WorkflowDraft(TimestampMixin):
    """A mutable, revision-guarded WorkflowProject snapshot under authoring."""

    __tablename__ = "workflow_drafts"

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    project: Mapped["Project"] = relationship("Project", back_populates="drafts")
    versions: Mapped[list["WorkflowVersion"]] = relationship(
        "WorkflowVersion",
        back_populates="draft",
    )


class WorkflowVersion(TimestampMixin):
    """An immutable, published WorkflowProject snapshot."""

    __tablename__ = "workflow_versions"
    __table_args__ = (
        UniqueConstraint("project_id", "version_number", name="uq_workflow_versions_project_number"),
    )

    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    draft_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workflow_drafts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    validation_run_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("validation_runs.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    project: Mapped["Project"] = relationship("Project", back_populates="versions")
    draft: Mapped["WorkflowDraft | None"] = relationship("WorkflowDraft", back_populates="versions")
    validation_run: Mapped["ValidationRun"] = relationship("ValidationRun", back_populates="version")
