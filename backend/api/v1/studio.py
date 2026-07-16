"""Persistent Workspace -> Project -> Workflow authoring API used by Studio."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.studio import (
    StudioProject,
    StudioWorkflow,
    StudioWorkflowDraft,
    StudioWorkspace,
)
from backend.schemas.common import ApiResponse, UTCModel

router = APIRouter(tags=["studio-authoring"])
LOCAL_USER_ID = "local-development-user"
ProjectAppType = Literal["chatbot", "agent", "chatflow", "workflow", "text-generator"]


class WorkspaceRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    slug: str
    active: bool
    created_at: datetime
    updated_at: datetime


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=1, max_length=100)
    description: str | None = None
    app_type: ProjectAppType = "workflow"


class ProjectRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    workspace_id: str
    name: str
    slug: str
    description: str | None
    app_type: ProjectAppType
    created_by_user_id: str
    archived: bool
    created_at: datetime
    updated_at: datetime


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    graph: dict


class WorkflowRead(UTCModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    name: str
    description: str | None
    current_published_version: int | None
    archived: bool
    created_at: datetime
    updated_at: datetime


class DraftUpdate(BaseModel):
    graph: dict
    revision: int = Field(ge=1)


class DraftRead(UTCModel):
    revision: int
    graph: dict
    updated_by_user_id: str
    updated_at: datetime


async def _workspace(db: AsyncSession, workspace_id: str) -> StudioWorkspace:
    row = await db.get(StudioWorkspace, workspace_id)
    if row is None or not row.active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return row


async def _project(db: AsyncSession, workspace_id: str, project_id: str) -> StudioProject:
    row = await db.scalar(
        select(StudioProject).where(
            StudioProject.id == project_id,
            StudioProject.workspace_id == workspace_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return row


async def _workflow(
    db: AsyncSession, workspace_id: str, project_id: str, workflow_id: str
) -> StudioWorkflow:
    await _project(db, workspace_id, project_id)
    row = await db.scalar(
        select(StudioWorkflow).where(
            StudioWorkflow.id == workflow_id,
            StudioWorkflow.project_id == project_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    return row


@router.get("/workspaces", response_model=ApiResponse[list[WorkspaceRead]])
async def list_workspaces(db: AsyncSession = Depends(get_db)) -> ApiResponse:
    rows = (
        (await db.execute(select(StudioWorkspace).order_by(StudioWorkspace.name)))
        .scalars()
        .all()
    )
    if not rows:
        default = StudioWorkspace(name="OpenCLI 工作区", slug="opencli-default")
        db.add(default)
        await db.flush()
        rows = [default]
    return ApiResponse.ok([WorkspaceRead.model_validate(row) for row in rows if row.active])


@router.get(
    "/workspaces/{workspace_id}/projects", response_model=ApiResponse[list[ProjectRead]]
)
async def list_projects(workspace_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse:
    await _workspace(db, workspace_id)
    rows = (
        (
            await db.execute(
                select(StudioProject)
                .where(
                    StudioProject.workspace_id == workspace_id,
                    StudioProject.archived.is_(False),
                )
                .order_by(StudioProject.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([ProjectRead.model_validate(row) for row in rows])


@router.post(
    "/workspaces/{workspace_id}/projects",
    response_model=ApiResponse[ProjectRead],
    status_code=201,
)
async def create_project(
    workspace_id: str, body: ProjectCreate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    await _workspace(db, workspace_id)
    row = StudioProject(
        workspace_id=workspace_id,
        name=body.name,
        slug=body.slug,
        description=body.description,
        app_type=body.app_type,
        created_by_user_id=LOCAL_USER_ID,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Project slug already exists") from exc
    return ApiResponse.ok(ProjectRead.model_validate(row))


@router.get(
    "/workspaces/{workspace_id}/projects/{project_id}/workflows",
    response_model=ApiResponse[list[WorkflowRead]],
)
async def list_workflows(
    workspace_id: str, project_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    await _project(db, workspace_id, project_id)
    rows = (
        (
            await db.execute(
                select(StudioWorkflow)
                .where(StudioWorkflow.project_id == project_id, StudioWorkflow.archived.is_(False))
                .order_by(StudioWorkflow.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([WorkflowRead.model_validate(row) for row in rows])


@router.post(
    "/workspaces/{workspace_id}/projects/{project_id}/workflows",
    response_model=ApiResponse[WorkflowRead],
    status_code=201,
)
async def create_workflow(
    workspace_id: str,
    project_id: str,
    body: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await _project(db, workspace_id, project_id)
    row = StudioWorkflow(project_id=project_id, name=body.name, description=body.description)
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow name already exists") from exc
    graph = {**body.graph, "id": row.id}
    db.add(
        StudioWorkflowDraft(
            workflow_id=row.id,
            graph=graph,
            updated_by_user_id=LOCAL_USER_ID,
        )
    )
    await db.flush()
    return ApiResponse.ok(WorkflowRead.model_validate(row))


@router.get(
    "/workspaces/{workspace_id}/projects/{project_id}/workflows/{workflow_id}/draft",
    response_model=ApiResponse[DraftRead],
)
async def get_draft(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await _workflow(db, workspace_id, project_id, workflow_id)
    row = await db.scalar(
        select(StudioWorkflowDraft).where(StudioWorkflowDraft.workflow_id == workflow_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow draft not found")
    return ApiResponse.ok(DraftRead.model_validate(row, from_attributes=True))


@router.put(
    "/workspaces/{workspace_id}/projects/{project_id}/workflows/{workflow_id}/draft",
    response_model=ApiResponse[DraftRead],
)
async def update_draft(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    body: DraftUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await _workflow(db, workspace_id, project_id, workflow_id)
    row = await db.scalar(
        select(StudioWorkflowDraft)
        .where(StudioWorkflowDraft.workflow_id == workflow_id)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow draft not found")
    if row.revision != body.revision:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow draft revision conflict")
    row.graph = {**body.graph, "id": workflow_id}
    row.revision += 1
    row.updated_by_user_id = LOCAL_USER_ID
    await db.flush()
    return ApiResponse.ok(DraftRead.model_validate(row, from_attributes=True))
