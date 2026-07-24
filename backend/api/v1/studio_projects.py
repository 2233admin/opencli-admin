"""Workspace, Project, and transactional bootstrap routes for Studio."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.v1.studio_helpers import LOCAL_USER_ID, get_workspace
from backend.api.v1.studio_schemas import (
    DraftRead,
    ProjectBootstrapCreate,
    ProjectBootstrapRead,
    ProjectRead,
    WorkflowRead,
    WorkspaceRead,
)
from backend.database import get_db
from backend.models.studio import (
    StudioProject,
    StudioWorkflow,
    StudioWorkflowDraft,
    StudioWorkspace,
)
from backend.schemas.common import ApiResponse

router = APIRouter()


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
    await get_workspace(db, workspace_id)
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
    "/workspaces/{workspace_id}/projects/bootstrap",
    response_model=ApiResponse[ProjectBootstrapRead],
    status_code=201,
)
async def bootstrap_project(
    workspace_id: str,
    body: ProjectBootstrapCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await get_workspace(db, workspace_id)
    existing = await db.scalar(
        select(StudioProject.id).where(
            StudioProject.workspace_id == workspace_id,
            StudioProject.slug == body.project.slug,
        )
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Project slug already exists")

    try:
        async with db.begin_nested():
            project = StudioProject(
                workspace_id=workspace_id,
                name=body.project.name,
                slug=body.project.slug,
                description=body.project.description,
                app_type=body.project.app_type,
                created_by_user_id=LOCAL_USER_ID,
            )
            db.add(project)
            await db.flush()

            workflow = StudioWorkflow(
                project_id=project.id,
                name=body.workflow.name,
                description=body.workflow.description,
            )
            db.add(workflow)
            await db.flush()

            graph = {
                **body.workflow.graph.model_dump(mode="json", exclude_none=True),
                "id": workflow.id,
            }
            draft = StudioWorkflowDraft(
                workflow_id=workflow.id,
                graph=graph,
                updated_by_user_id=LOCAL_USER_ID,
            )
            db.add(draft)
            project.primary_workflow_id = workflow.id
            await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Project or primary workflow already exists",
        ) from exc

    return ApiResponse.ok(
        ProjectBootstrapRead(
            project=ProjectRead.model_validate(project),
            primary_workflow=WorkflowRead.model_validate(workflow),
            draft=DraftRead.model_validate(draft, from_attributes=True),
        )
    )
