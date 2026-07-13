"""Workspace-scoped Workflow authoring, publication, and versioned execution."""

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.workflow import Project, Workflow, WorkflowDraft, WorkflowVersion
from backend.models.workflow_run import WorkflowRun as WorkflowRunRow
from backend.schemas import workflow as workflow_schemas
from backend.schemas.common import ApiResponse
from backend.schemas.workflow import WORKFLOW_COMPILE_VERSION
from backend.schemas.workflow_asset import (
    ProjectCreate,
    ProjectRead,
    WorkflowCreate,
    WorkflowDraftRead,
    WorkflowDraftUpdate,
    WorkflowPublish,
    WorkflowRead,
    WorkflowVersionRead,
    WorkflowVersionRunCreate,
)
from backend.security.identity import RequestIdentity, get_request_identity
from backend.security.workspace_rbac import (
    WorkspacePermission,
    get_workspace_access,
    require_permission,
)
from backend.workflow.compiler import compile_workflow_project
from backend.workflow.hda_templates import freeze_hda_templates
from backend.workflow.opencli_hda_tracer import (
    continue_workflow_run_with_source_outputs,
    get_workflow_run_projection,
    start_workflow_run,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/projects",
    tags=["workflow-assets"],
)


async def _project(db: AsyncSession, workspace_id: str, project_id: str) -> Project:
    project = await db.scalar(
        select(Project).where(Project.id == project_id).where(Project.workspace_id == workspace_id)
    )
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project


async def _workflow(
    db: AsyncSession,
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    *,
    lock: bool = False,
) -> Workflow:
    query = (
        select(Workflow)
        .join(Project, Project.id == Workflow.project_id)
        .where(Workflow.id == workflow_id)
        .where(Workflow.project_id == project_id)
        .where(Project.workspace_id == workspace_id)
    )
    if lock:
        query = query.with_for_update()
    workflow = await db.scalar(query)
    if workflow is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    return workflow


async def _version(
    db: AsyncSession,
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    version_number: int,
) -> WorkflowVersion:
    workflow = await _workflow(db, workspace_id, project_id, workflow_id)
    version = await db.scalar(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow.id)
        .where(WorkflowVersion.version == version_number)
    )
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow Version not found")
    return version


async def _version_run(
    db: AsyncSession,
    version_id: str,
    run_id: str,
) -> WorkflowRunRow:
    run = await db.scalar(
        select(WorkflowRunRow)
        .where(WorkflowRunRow.id == run_id)
        .where(WorkflowRunRow.workflow_version_id == version_id)
    )
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow run not found")
    return run


@router.get("", response_model=ApiResponse[list[ProjectRead]])
async def list_projects(
    workspace_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    projects = (
        (
            await db.execute(
                select(Project)
                .where(Project.workspace_id == workspace_id)
                .where(Project.archived.is_(False))
                .order_by(Project.created_at)
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([ProjectRead.model_validate(project) for project in projects])


@router.post("", response_model=ApiResponse[ProjectRead], status_code=201)
async def create_project(
    workspace_id: str,
    body: ProjectCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_CONFIGURATION)
    project = Project(
        workspace_id=workspace_id,
        name=body.name,
        slug=body.slug,
        description=body.description,
        created_by_user_id=access.user_id,
    )
    db.add(project)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Project slug already exists") from exc
    return ApiResponse.ok(ProjectRead.model_validate(project))


@router.post(
    "/{project_id}/workflows",
    response_model=ApiResponse[WorkflowRead],
    status_code=201,
)
async def create_workflow(
    workspace_id: str,
    project_id: str,
    body: WorkflowCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_CONFIGURATION)
    await _project(db, workspace_id, project_id)
    workflow = Workflow(
        project_id=project_id,
        name=body.name,
        description=body.description,
    )
    db.add(workflow)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow name already exists") from exc
    graph = body.graph.model_copy(update={"id": workflow.id}, deep=True)
    db.add(
        WorkflowDraft(
            workflow_id=workflow.id,
            graph=graph.model_dump(mode="json"),
            updated_by_user_id=access.user_id,
        )
    )
    await db.flush()
    return ApiResponse.ok(WorkflowRead.model_validate(workflow))


@router.get(
    "/{project_id}/workflows",
    response_model=ApiResponse[list[WorkflowRead]],
)
async def list_workflows(
    workspace_id: str,
    project_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    await _project(db, workspace_id, project_id)
    workflows = (
        (
            await db.execute(
                select(Workflow)
                .where(Workflow.project_id == project_id)
                .where(Workflow.archived.is_(False))
                .order_by(Workflow.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([WorkflowRead.model_validate(workflow) for workflow in workflows])


@router.get(
    "/{project_id}/workflows/{workflow_id}/draft",
    response_model=ApiResponse[WorkflowDraftRead],
    response_model_exclude_none=True,
)
async def get_workflow_draft(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    workflow = await _workflow(db, workspace_id, project_id, workflow_id)
    draft = await db.scalar(select(WorkflowDraft).where(WorkflowDraft.workflow_id == workflow.id))
    if draft is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow draft is missing")
    return ApiResponse.ok(WorkflowDraftRead.model_validate(draft))


@router.put(
    "/{project_id}/workflows/{workflow_id}/draft",
    response_model=ApiResponse[WorkflowDraftRead],
    response_model_exclude_none=True,
)
async def update_workflow_draft(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    body: WorkflowDraftUpdate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_CONFIGURATION)
    workflow = await _workflow(db, workspace_id, project_id, workflow_id, lock=True)
    if workflow.archived:
        raise HTTPException(status.HTTP_409_CONFLICT, "Archived Workflow cannot be edited")
    draft = await db.scalar(
        select(WorkflowDraft).where(WorkflowDraft.workflow_id == workflow.id).with_for_update()
    )
    if draft is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow draft is missing")
    if draft.revision != body.revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "draft_revision_conflict",
                "latestRevision": draft.revision,
            },
        )
    graph = body.graph.model_copy(update={"id": workflow.id}, deep=True)
    draft.revision += 1
    draft.graph = graph.model_dump(mode="json")
    draft.updated_by_user_id = access.user_id
    await db.flush()
    return ApiResponse.ok(WorkflowDraftRead.model_validate(draft))


@router.post(
    "/{project_id}/workflows/{workflow_id}/versions",
    response_model=ApiResponse[WorkflowVersionRead],
    status_code=201,
)
async def publish_workflow_version(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    body: WorkflowPublish,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_CONFIGURATION)
    workflow = await _workflow(db, workspace_id, project_id, workflow_id, lock=True)
    if workflow.archived:
        raise HTTPException(status.HTTP_409_CONFLICT, "Archived Workflow cannot publish")
    draft = await db.scalar(
        select(WorkflowDraft).where(WorkflowDraft.workflow_id == workflow.id).with_for_update()
    )
    if draft is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow draft is missing")
    if draft.revision != body.expected_revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "stale_validation",
                "message": "Workflow Draft changed after validation",
                "expectedRevision": body.expected_revision,
                "latestRevision": draft.revision,
            },
        )
    validation_run = await _completed_draft_validation(
        db,
        workflow_id=workflow.id,
        draft_revision=draft.revision,
        validation_run_id=body.validation_run_id,
    )
    if validation_run is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "stale_validation",
                "message": "Publish requires a completed Validation Run for this Draft revision",
                "draftRevision": draft.revision,
                "validationRunId": body.validation_run_id,
            },
        )
    graph = workflow_schemas.WorkflowRunStartRequest.model_validate(
        validation_run.request
    ).project
    compiled = compile_workflow_project(graph, trust_frozen_templates=True)
    if not compiled.valid:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": "Workflow draft is invalid",
                "errors": compiled.model_dump()["errors"],
            },
        )
    number = (workflow.current_published_version or 0) + 1
    version = WorkflowVersion(
        workflow_id=workflow.id,
        version=number,
        draft_revision=draft.revision,
        graph=graph.model_dump(mode="json"),
        content_hash=hashlib.sha256(
            json.dumps(
                graph.model_dump(mode="json"),
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest(),
        compile_version=WORKFLOW_COMPILE_VERSION,
        published_by_user_id=access.user_id,
        reason=body.reason,
    )
    db.add(version)
    workflow.current_published_version = number
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Workflow Version was published concurrently; retry publication",
        ) from exc
    return ApiResponse.ok(WorkflowVersionRead.model_validate(version))


async def _completed_draft_validation(
    db: AsyncSession,
    *,
    workflow_id: str,
    draft_revision: int,
    validation_run_id: str,
) -> WorkflowRunRow | None:
    run = await db.get(WorkflowRunRow, validation_run_id)
    if run is None or run.workflow_id != workflow_id or run.status != "completed" or not run.valid:
        return None
    expected = {"workflowId": workflow_id, "draftRevision": draft_revision}
    return run if run.request.get("validation") == expected else None


@router.post(
    "/{project_id}/workflows/{workflow_id}/draft/validation-runs",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
    status_code=202,
)
async def validate_workflow_draft(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    body: WorkflowVersionRunCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.RUN_OPERATIONS_AGENTS)
    workflow = await _workflow(db, workspace_id, project_id, workflow_id)
    draft = await db.scalar(select(WorkflowDraft).where(WorkflowDraft.workflow_id == workflow.id))
    if draft is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Workflow draft is missing")
    request = workflow_schemas.WorkflowRunStartRequest(
        project=freeze_hda_templates(
            workflow_schemas.WorkflowProject.model_validate(draft.graph)
        ),
        **body.model_dump(by_alias=True),
    )
    projection = await start_workflow_run(request, session=db)
    run = await db.get(WorkflowRunRow, projection.runId)
    if run is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Validation run was not persisted",
        )
    run.request = {
        **run.request,
        "validation": {"workflowId": workflow.id, "draftRevision": draft.revision},
    }
    await db.flush()
    return ApiResponse.ok(projection)


@router.get(
    "/{project_id}/workflows/{workflow_id}/versions",
    response_model=ApiResponse[list[WorkflowVersionRead]],
)
async def list_workflow_versions(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    workflow = await _workflow(db, workspace_id, project_id, workflow_id)
    versions = (
        (
            await db.execute(
                select(WorkflowVersion)
                .where(WorkflowVersion.workflow_id == workflow.id)
                .order_by(WorkflowVersion.version.desc())
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok(
        [WorkflowVersionRead.model_validate(version) for version in versions]
    )


@router.get(
    "/{project_id}/workflows/{workflow_id}/versions/{version_number}",
    response_model=ApiResponse[WorkflowVersionRead],
)
async def get_workflow_version(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    version_number: int,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    version = await _version(db, workspace_id, project_id, workflow_id, version_number)
    return ApiResponse.ok(WorkflowVersionRead.model_validate(version))


@router.post(
    "/{project_id}/workflows/{workflow_id}/versions/{version_number}/runs",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
    status_code=202,
)
async def start_versioned_workflow_run(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    version_number: int,
    body: WorkflowVersionRunCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.RUN_OPERATIONS_AGENTS)
    version = await _version(db, workspace_id, project_id, workflow_id, version_number)
    request = workflow_schemas.WorkflowRunStartRequest(
        project=workflow_schemas.WorkflowProject.model_validate(version.graph),
        **body.model_dump(by_alias=True),
    )
    return ApiResponse.ok(
        await start_workflow_run(
            request,
            session=db,
            workflow_version_id=version.id,
        )
    )


@router.get(
    "/{project_id}/workflows/{workflow_id}/versions/{version_number}/runs/{run_id}",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
)
async def get_versioned_workflow_run(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    version_number: int,
    run_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    version = await _version(db, workspace_id, project_id, workflow_id, version_number)
    await _version_run(db, version.id, run_id)
    projection = await get_workflow_run_projection(run_id, session=db)
    if projection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow run not found")
    return ApiResponse.ok(projection)


@router.post(
    "/{project_id}/workflows/{workflow_id}/versions/{version_number}/runs/{run_id}/source-outputs",
    response_model=ApiResponse[workflow_schemas.WorkflowRunProjection],
    status_code=202,
)
async def continue_versioned_workflow_run(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    version_number: int,
    run_id: str,
    body: workflow_schemas.WorkflowRunSourceOutputsRequest,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.RUN_OPERATIONS_AGENTS)
    version = await _version(db, workspace_id, project_id, workflow_id, version_number)
    await _version_run(db, version.id, run_id)
    projection = await continue_workflow_run_with_source_outputs(run_id, body, session=db)
    if projection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow run not found")
    return ApiResponse.ok(projection)
