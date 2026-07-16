"""Validation and immutable Version lifecycle routes for Studio Workflows."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.v1.studio_helpers import (
    LOCAL_USER_ID,
    get_project,
    get_workflow,
    validation_projection,
)
from backend.api.v1.studio_schemas import ValidationRunRead, VersionCreate, VersionRead
from backend.database import get_db
from backend.models.studio import (
    StudioWorkflow,
    StudioWorkflowDraft,
    StudioWorkflowValidationRun,
    StudioWorkflowVersion,
)
from backend.schemas import workflow as workflow_schemas
from backend.schemas.common import ApiResponse
from backend.workflow.compiler import compile_workflow_project

router = APIRouter()


@router.post(
    (
        "/workspaces/{workspace_id}/projects/{project_id}/workflows/{workflow_id}"
        "/draft/validation-runs"
    ),
    response_model=ApiResponse[ValidationRunRead],
    status_code=201,
)
async def validate_draft(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await get_workflow(db, workspace_id, project_id, workflow_id)
    draft = await db.scalar(
        select(StudioWorkflowDraft).where(StudioWorkflowDraft.workflow_id == workflow_id)
    )
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow draft not found")

    try:
        project = workflow_schemas.WorkflowProject.model_validate(draft.graph)
    except ValidationError as exc:
        errors = [
            workflow_schemas.WorkflowCompileError(
                code="invalid_workflow_project",
                message=error["msg"],
                path=[str(part) for part in error["loc"]],
            )
            for error in exc.errors()
        ]
        valid = False
    else:
        result = compile_workflow_project(project)
        errors = result.errors
        valid = result.valid

    row = StudioWorkflowValidationRun(
        workflow_id=workflow_id,
        draft_revision=draft.revision,
        status="completed" if valid else "failed",
        valid=valid,
        errors=[error.model_dump(mode="json") for error in errors],
        warnings=[],
        compile_version=workflow_schemas.WORKFLOW_COMPILE_VERSION,
    )
    db.add(row)
    await db.flush()
    return ApiResponse.ok(validation_projection(row))


@router.get(
    "/workspaces/{workspace_id}/projects/{project_id}/workflows/{workflow_id}/versions",
    response_model=ApiResponse[list[VersionRead]],
)
async def list_versions(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await get_workflow(db, workspace_id, project_id, workflow_id)
    rows = (
        (
            await db.execute(
                select(StudioWorkflowVersion)
                .where(StudioWorkflowVersion.workflow_id == workflow_id)
                .order_by(StudioWorkflowVersion.version.desc())
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([VersionRead.model_validate(row) for row in rows])


@router.post(
    "/workspaces/{workspace_id}/projects/{project_id}/workflows/{workflow_id}/versions",
    response_model=ApiResponse[VersionRead],
    status_code=201,
)
async def publish_version(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    body: VersionCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    await get_project(db, workspace_id, project_id)
    workflow = await db.scalar(
        select(StudioWorkflow)
        .where(
            StudioWorkflow.id == workflow_id,
            StudioWorkflow.project_id == project_id,
        )
        .with_for_update()
    )
    if workflow is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    draft = await db.scalar(
        select(StudioWorkflowDraft)
        .where(StudioWorkflowDraft.workflow_id == workflow_id)
        .with_for_update()
    )
    if draft is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow draft not found")
    if body.expected_revision != draft.revision:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow draft revision conflict")

    validation = await db.scalar(
        select(StudioWorkflowValidationRun).where(
            StudioWorkflowValidationRun.id == body.validation_run_id,
            StudioWorkflowValidationRun.workflow_id == workflow_id,
        )
    )
    if validation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Validation run not found")
    if (
        not validation.valid
        or validation.status != "completed"
        or validation.draft_revision != draft.revision
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Current workflow draft revision has not passed validation",
        )

    try:
        async with db.begin_nested():
            row = StudioWorkflowVersion(
                workflow_id=workflow_id,
                version=(workflow.current_published_version or 0) + 1,
                draft_revision=draft.revision,
                graph=draft.graph,
                compile_version=validation.compile_version,
                validation_run_id=validation.id,
                published_by_user_id=LOCAL_USER_ID,
                reason=body.reason,
            )
            db.add(row)
            workflow.current_published_version = row.version
            await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Workflow version publish conflict",
        ) from exc
    return ApiResponse.ok(VersionRead.model_validate(row))
