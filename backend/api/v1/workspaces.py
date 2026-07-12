"""Workspace / Project / WorkflowDraft / WorkflowVersion authoring endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.schemas import workflow_authoring as schemas
from backend.schemas.common import ApiResponse
from backend.services import workflow_authoring_service as authoring_service
from backend.services import validation_run_service
from backend.services.workflow_authoring_service import DraftRevisionConflictError
from backend.services.validation_run_service import (
    ValidationRunAlreadyConsumedError,
    ValidationRunNotFoundError,
    ValidationRunNotPassedError,
    ValidationRunRequestError,
    ValidationRunStaleError,
)

router = APIRouter(tags=["workflow-authoring"])


@router.post("/workspaces", response_model=ApiResponse[schemas.WorkspaceRead], status_code=201)
async def create_workspace(
    body: schemas.WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[schemas.WorkspaceRead]:
    try:
        workspace = await authoring_service.create_workspace(db, body)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Workspace slug {body.slug!r} already exists") from exc
    await db.refresh(workspace)
    return ApiResponse.ok(schemas.WorkspaceRead.model_validate(workspace))


@router.get("/workspaces", response_model=ApiResponse[list[schemas.WorkspaceRead]])
async def list_workspaces(db: AsyncSession = Depends(get_db)) -> ApiResponse[list[schemas.WorkspaceRead]]:
    workspaces = await authoring_service.list_workspaces(db)
    return ApiResponse.ok([schemas.WorkspaceRead.model_validate(w) for w in workspaces])


@router.get("/workspaces/{workspace_id}", response_model=ApiResponse[schemas.WorkspaceRead])
async def get_workspace(
    workspace_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse[schemas.WorkspaceRead]:
    workspace = await authoring_service.get_workspace(db, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ApiResponse.ok(schemas.WorkspaceRead.model_validate(workspace))


@router.get(
    "/workspaces/{workspace_id}/settings",
    response_model=ApiResponse[schemas.WorkspaceSettingsRead],
)
async def get_workspace_settings(
    workspace_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse[schemas.WorkspaceSettingsRead]:
    settings = await authoring_service.get_workspace_settings(db, workspace_id)
    if settings is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ApiResponse.ok(schemas.WorkspaceSettingsRead.model_validate(settings))


@router.put(
    "/workspaces/{workspace_id}/settings",
    response_model=ApiResponse[schemas.WorkspaceSettingsRead],
)
async def update_workspace_settings(
    workspace_id: str,
    body: schemas.WorkspaceSettingsUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[schemas.WorkspaceSettingsRead]:
    settings = await authoring_service.get_workspace_settings(db, workspace_id)
    if settings is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    settings = await authoring_service.update_workspace_settings(db, settings, body)
    await db.commit()
    await db.refresh(settings)
    return ApiResponse.ok(schemas.WorkspaceSettingsRead.model_validate(settings))


@router.post(
    "/workspaces/{workspace_id}/projects",
    response_model=ApiResponse[schemas.ProjectRead],
    status_code=201,
)
async def create_project(
    workspace_id: str,
    body: schemas.ProjectCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[schemas.ProjectRead]:
    workspace = await authoring_service.get_workspace(db, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    try:
        project = await authoring_service.create_project(db, workspace, body)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail=f"Project slug {body.slug!r} already exists in this workspace"
        ) from exc
    await db.refresh(project)
    return ApiResponse.ok(schemas.ProjectRead.model_validate(project))


@router.get(
    "/workspaces/{workspace_id}/projects",
    response_model=ApiResponse[list[schemas.ProjectRead]],
)
async def list_projects(
    workspace_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse[list[schemas.ProjectRead]]:
    workspace = await authoring_service.get_workspace(db, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    projects = await authoring_service.list_projects(db, workspace_id)
    return ApiResponse.ok([schemas.ProjectRead.model_validate(p) for p in projects])


@router.get(
    "/workspaces/{workspace_id}/projects/{project_id}",
    response_model=ApiResponse[schemas.ProjectRead],
)
async def get_project_in_workspace(
    workspace_id: str, project_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse[schemas.ProjectRead]:
    project = await authoring_service.get_project(db, project_id)
    if project is None or project.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return ApiResponse.ok(schemas.ProjectRead.model_validate(project))


@router.post(
    "/projects/{project_id}/drafts",
    response_model=ApiResponse[schemas.WorkflowDraftRead],
    status_code=201,
)
async def create_draft(
    project_id: str,
    body: schemas.WorkflowDraftCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[schemas.WorkflowDraftRead]:
    project = await authoring_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    draft = await authoring_service.create_draft(db, project, body)
    await db.commit()
    await db.refresh(draft)
    return ApiResponse.ok(schemas.WorkflowDraftRead.model_validate(draft))


@router.get("/drafts/{draft_id}", response_model=ApiResponse[schemas.WorkflowDraftRead])
async def get_draft(draft_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse[schemas.WorkflowDraftRead]:
    draft = await authoring_service.get_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return ApiResponse.ok(schemas.WorkflowDraftRead.model_validate(draft))


@router.put("/drafts/{draft_id}", response_model=ApiResponse[schemas.WorkflowDraftRead])
async def update_draft(
    draft_id: str,
    body: schemas.WorkflowDraftUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[schemas.WorkflowDraftRead]:
    draft = await authoring_service.get_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    try:
        draft = await authoring_service.update_draft(db, draft, body)
    except DraftRevisionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    await db.refresh(draft)
    return ApiResponse.ok(schemas.WorkflowDraftRead.model_validate(draft))


@router.post(
    "/drafts/{draft_id}/validation-runs",
    response_model=ApiResponse[schemas.ValidationRunRead],
    status_code=201,
)
async def create_validation_run(
    draft_id: str,
    body: schemas.ValidationRunCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[schemas.ValidationRunRead]:
    draft = await authoring_service.get_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    try:
        validation_run = await validation_run_service.run_validation(
            db, draft, mode=body.mode, expected_events=body.expected_events
        )
    except ValidationRunRequestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await db.commit()
    await db.refresh(validation_run)
    return ApiResponse.ok(schemas.ValidationRunRead.model_validate(validation_run))


@router.get(
    "/drafts/{draft_id}/validation-runs/{validation_run_id}",
    response_model=ApiResponse[schemas.ValidationRunRead],
)
async def get_validation_run(
    draft_id: str, validation_run_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse[schemas.ValidationRunRead]:
    validation_run = await validation_run_service.get_validation_run(db, validation_run_id)
    if validation_run is None or validation_run.draft_id != draft_id:
        raise HTTPException(status_code=404, detail="Validation run not found")
    return ApiResponse.ok(schemas.ValidationRunRead.model_validate(validation_run))


@router.post("/drafts/{draft_id}/publish", response_model=ApiResponse[schemas.WorkflowVersionRead])
async def publish_draft(
    draft_id: str,
    body: schemas.WorkflowDraftPublishRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[schemas.WorkflowVersionRead]:
    draft = await authoring_service.get_draft(db, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    try:
        version = await validation_run_service.publish_draft(
            db,
            draft,
            validation_run_id=body.validation_run_id,
            expected_revision=body.expected_revision,
        )
        await db.commit()
    except DraftRevisionConflictError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValidationRunNotFoundError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValidationRunStaleError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValidationRunNotPassedError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValidationRunAlreadyConsumedError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Validation run has already been published (concurrent publish)"
        ) from exc
    await db.refresh(version)
    return ApiResponse.ok(schemas.WorkflowVersionRead.model_validate(version))


@router.get(
    "/projects/{project_id}/versions",
    response_model=ApiResponse[list[schemas.WorkflowVersionRead]],
)
async def list_versions(
    project_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse[list[schemas.WorkflowVersionRead]]:
    project = await authoring_service.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    versions = await authoring_service.list_versions(db, project_id)
    return ApiResponse.ok([schemas.WorkflowVersionRead.model_validate(v) for v in versions])


@router.get("/versions/{version_id}", response_model=ApiResponse[schemas.WorkflowVersionRead])
async def get_version(
    version_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse[schemas.WorkflowVersionRead]:
    version = await authoring_service.get_version(db, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Workflow version not found")
    return ApiResponse.ok(schemas.WorkflowVersionRead.model_validate(version))
