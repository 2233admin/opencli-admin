"""Workflow asset and mutable Draft routes for Studio."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.v1.studio_helpers import (
    LOCAL_USER_ID,
    canonicalize_studio_graph,
    get_project,
    get_workflow,
)
from backend.api.v1.studio_schemas import DraftRead, DraftUpdate, WorkflowCreate, WorkflowRead
from backend.database import get_db
from backend.models.studio import StudioProject, StudioWorkflow, StudioWorkflowDraft
from backend.schemas.common import ApiResponse

router = APIRouter()


@router.get(
    "/workspaces/{workspace_id}/projects/{project_id}/workflows",
    response_model=ApiResponse[list[WorkflowRead]],
)
async def list_workflows(
    workspace_id: str, project_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    await get_project(db, workspace_id, project_id)
    rows = (
        (
            await db.execute(
                select(StudioWorkflow)
                .where(
                    StudioWorkflow.project_id == project_id,
                    StudioWorkflow.archived.is_(False),
                )
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
    project = await db.scalar(
        select(StudioProject)
        .where(
            StudioProject.id == project_id,
            StudioProject.workspace_id == workspace_id,
        )
        .with_for_update()
    )
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    row = StudioWorkflow(project_id=project_id, name=body.name, description=body.description)
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow name already exists") from exc
    graph = canonicalize_studio_graph(body.graph, workflow_id=row.id)
    db.add(
        StudioWorkflowDraft(
            workflow_id=row.id,
            graph=graph,
            updated_by_user_id=LOCAL_USER_ID,
        )
    )
    await db.flush()
    if project.primary_workflow_id is None:
        project.primary_workflow_id = row.id
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
    await get_workflow(db, workspace_id, project_id, workflow_id)
    row = await db.scalar(
        select(StudioWorkflowDraft).where(StudioWorkflowDraft.workflow_id == workflow_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow draft not found")
    draft = DraftRead.model_validate(row, from_attributes=True)
    return ApiResponse.ok(
        draft.model_copy(
            update={
                "graph": canonicalize_studio_graph(
                    draft.graph,
                    workflow_id=workflow_id,
                )
            }
        )
    )


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
    await get_workflow(db, workspace_id, project_id, workflow_id)
    row = await db.scalar(
        select(StudioWorkflowDraft)
        .where(StudioWorkflowDraft.workflow_id == workflow_id)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow draft not found")
    if row.revision != body.revision:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow draft revision conflict")
    row.graph = canonicalize_studio_graph(body.graph, workflow_id=workflow_id)
    row.revision += 1
    row.updated_by_user_id = LOCAL_USER_ID
    await db.flush()
    return ApiResponse.ok(DraftRead.model_validate(row, from_attributes=True))
