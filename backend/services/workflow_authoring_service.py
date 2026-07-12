from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.workflow_authoring import (
    Project,
    Workspace,
    WorkspaceSettings,
    WorkflowDraft,
    WorkflowVersion,
)
from backend.schemas.workflow_authoring import (
    ProjectCreate,
    WorkspaceCreate,
    WorkspaceSettingsUpdate,
    WorkspaceUpdate,
    WorkflowDraftCreate,
    WorkflowDraftUpdate,
)


class DraftRevisionConflictError(ValueError):
    """Raised when a draft update's expectedRevision no longer matches the stored revision."""


async def create_workspace(session: AsyncSession, data: WorkspaceCreate) -> Workspace:
    workspace = Workspace(**data.model_dump())
    session.add(workspace)
    await session.flush()
    session.add(WorkspaceSettings(workspace_id=workspace.id))
    await session.flush()
    await session.refresh(workspace)
    return workspace


async def list_workspaces(session: AsyncSession) -> list[Workspace]:
    result = await session.execute(select(Workspace).order_by(Workspace.created_at.desc()))
    return list(result.scalars().all())


async def get_workspace(session: AsyncSession, workspace_id: str) -> Optional[Workspace]:
    result = await session.execute(select(Workspace).where(Workspace.id == workspace_id))
    return result.scalar_one_or_none()


async def update_workspace(
    session: AsyncSession, workspace: Workspace, data: WorkspaceUpdate
) -> Workspace:
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(workspace, key, value)
    await session.flush()
    await session.refresh(workspace)
    return workspace


async def get_workspace_settings(
    session: AsyncSession, workspace_id: str
) -> Optional[WorkspaceSettings]:
    result = await session.execute(
        select(WorkspaceSettings).where(WorkspaceSettings.workspace_id == workspace_id)
    )
    return result.scalar_one_or_none()


async def update_workspace_settings(
    session: AsyncSession, settings: WorkspaceSettings, data: WorkspaceSettingsUpdate
) -> WorkspaceSettings:
    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(settings, key, value)
    await session.flush()
    await session.refresh(settings)
    return settings


async def create_project(
    session: AsyncSession, workspace: Workspace, data: ProjectCreate
) -> Project:
    project = Project(workspace_id=workspace.id, **data.model_dump())
    session.add(project)
    await session.flush()
    await session.refresh(project)
    return project


async def list_projects(session: AsyncSession, workspace_id: str) -> list[Project]:
    result = await session.execute(
        select(Project)
        .where(Project.workspace_id == workspace_id)
        .order_by(Project.created_at.desc())
    )
    return list(result.scalars().all())


async def get_project(session: AsyncSession, project_id: str) -> Optional[Project]:
    result = await session.execute(select(Project).where(Project.id == project_id))
    return result.scalar_one_or_none()


async def create_draft(
    session: AsyncSession, project: Project, data: WorkflowDraftCreate
) -> WorkflowDraft:
    draft = WorkflowDraft(
        project_id=project.id,
        name=data.name,
        revision=1,
        snapshot=data.snapshot.model_dump(mode="json"),
    )
    session.add(draft)
    await session.flush()
    await session.refresh(draft)
    return draft


async def get_draft(session: AsyncSession, draft_id: str) -> Optional[WorkflowDraft]:
    result = await session.execute(select(WorkflowDraft).where(WorkflowDraft.id == draft_id))
    return result.scalar_one_or_none()


async def update_draft(
    session: AsyncSession, draft: WorkflowDraft, data: WorkflowDraftUpdate
) -> WorkflowDraft:
    if draft.revision != data.expected_revision:
        raise DraftRevisionConflictError(
            f"draft revision {draft.revision} does not match expected "
            f"{data.expected_revision}"
        )
    draft.snapshot = data.snapshot.model_dump(mode="json")
    draft.revision += 1
    await session.flush()
    await session.refresh(draft)
    return draft


async def list_versions(session: AsyncSession, project_id: str) -> list[WorkflowVersion]:
    result = await session.execute(
        select(WorkflowVersion)
        .where(WorkflowVersion.project_id == project_id)
        .order_by(WorkflowVersion.version_number.desc())
    )
    return list(result.scalars().all())


async def get_version(session: AsyncSession, version_id: str) -> Optional[WorkflowVersion]:
    result = await session.execute(
        select(WorkflowVersion).where(WorkflowVersion.id == version_id)
    )
    return result.scalar_one_or_none()
