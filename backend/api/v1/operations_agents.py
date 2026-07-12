from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.identity import Team, WorkspaceRole
from backend.models.operations_agent import (
    AgentPermissionProfile,
    AgentProfileMode,
    OperationsAgentDraft,
    OperationsAgentIdentity,
    OperationsAgentRun,
    PublishedOperationsAgentVersion,
)
from backend.schemas.common import ApiResponse
from backend.schemas.operations_agent import (
    AgentProfileCreate,
    AgentProfileRead,
    OperationsAgentCreate,
    OperationsAgentDraftRead,
    OperationsAgentDraftUpdate,
    OperationsAgentPatch,
    OperationsAgentPublish,
    OperationsAgentRead,
    OperationsAgentRunCreate,
    OperationsAgentRunRead,
    PublishedOperationsAgentVersionRead,
)
from backend.security.identity import RequestIdentity, get_request_identity
from backend.security.workspace_rbac import (
    WorkspacePermission,
    get_workspace_access,
    require_permission,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/operations-agents", tags=["operations-agents"]
)


@router.get("/activity", response_model=ApiResponse[list[OperationsAgentRunRead]])
async def list_operations_agent_activity(
    workspace_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    runs = (
        (
            await db.execute(
                select(OperationsAgentRun)
                .where(OperationsAgentRun.workspace_id == workspace_id)
                .order_by(OperationsAgentRun.updated_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([OperationsAgentRunRead.model_validate(run) for run in runs])


async def _get_agent(
    db: AsyncSession, workspace_id: str, agent_id: str, *, lock: bool = False
) -> OperationsAgentIdentity:
    query = (
        select(OperationsAgentIdentity)
        .where(OperationsAgentIdentity.workspace_id == workspace_id)
        .where(OperationsAgentIdentity.id == agent_id)
    )
    if lock:
        query = query.with_for_update()
    agent = await db.scalar(query)
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operations Agent not found")
    return agent


async def _get_profile(db: AsyncSession, agent: OperationsAgentIdentity) -> AgentPermissionProfile:
    profile = await db.scalar(
        select(AgentPermissionProfile)
        .where(AgentPermissionProfile.operations_agent_id == agent.id)
        .where(AgentPermissionProfile.version == agent.current_profile_version)
    )
    if profile is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Current Agent Permission Profile is missing")
    return profile


def _read_agent(
    agent: OperationsAgentIdentity, profile: AgentPermissionProfile
) -> OperationsAgentRead:
    current = AgentProfileRead.model_validate(profile)
    return OperationsAgentRead(
        id=agent.id,
        workspace_id=agent.workspace_id,
        owning_team_id=agent.owning_team_id,
        name=agent.name,
        description=agent.description,
        disabled=agent.disabled,
        current_profile=current,
        effective_profile=None if agent.disabled else current,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


@router.get("", response_model=ApiResponse[list[OperationsAgentRead]])
async def list_operations_agents(
    workspace_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    agents = (
        (
            await db.execute(
                select(OperationsAgentIdentity)
                .where(OperationsAgentIdentity.workspace_id == workspace_id)
                .order_by(OperationsAgentIdentity.created_at)
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([_read_agent(agent, await _get_profile(db, agent)) for agent in agents])


@router.post("", response_model=ApiResponse[OperationsAgentRead], status_code=201)
async def create_operations_agent(
    workspace_id: str,
    body: OperationsAgentCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_AGENT_IDENTITIES)
    team = await db.scalar(
        select(Team).where(Team.id == body.owning_team_id).where(Team.workspace_id == workspace_id)
    )
    if team is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Owning Team must belong to Workspace",
        )

    agent = OperationsAgentIdentity(
        workspace_id=workspace_id,
        owning_team_id=team.id,
        name=body.name,
        description=body.description,
        current_profile_version=1,
    )
    db.add(agent)
    await db.flush()
    profile = AgentPermissionProfile(
        operations_agent_id=agent.id,
        version=1,
        mode=AgentProfileMode.OBSERVE_ONLY,
        assigned_by_user_id=access.user_id,
        reason="Default Observe Only profile",
    )
    draft = OperationsAgentDraft(
        operations_agent_id=agent.id,
        updated_by_user_id=access.user_id,
    )
    db.add_all((profile, draft))
    await db.flush()
    return ApiResponse.ok(_read_agent(agent, profile))


@router.patch("/{agent_id}", response_model=ApiResponse[OperationsAgentRead])
async def patch_operations_agent(
    workspace_id: str,
    agent_id: str,
    body: OperationsAgentPatch,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_AGENT_IDENTITIES)
    agent = await _get_agent(db, workspace_id, agent_id, lock=True)
    profile = await _get_profile(db, agent)
    if (
        agent.disabled
        and not body.disabled
        and profile.mode == AgentProfileMode.LOW_RISK_AUTOMATIC
        and access.role != WorkspaceRole.ADMIN
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only Workspace Admins may re-enable automatic Operations Agents",
        )
    agent.disabled = body.disabled
    if body.disabled:
        await db.execute(
            update(OperationsAgentRun)
            .where(OperationsAgentRun.workspace_id == workspace_id)
            .where(OperationsAgentRun.operations_agent_id == agent.id)
            .where(OperationsAgentRun.status.in_(("queued", "running", "paused")))
            .values(status="cancelled")
        )
    await db.flush()
    return ApiResponse.ok(_read_agent(agent, profile))


@router.put(
    "/{agent_id}/draft",
    response_model=ApiResponse[OperationsAgentDraftRead],
)
async def update_agent_draft(
    workspace_id: str,
    agent_id: str,
    body: OperationsAgentDraftUpdate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_AGENT_IDENTITIES)
    agent = await _get_agent(db, workspace_id, agent_id, lock=True)
    if agent.disabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Disabled Operations Agent cannot be edited")
    draft = await db.scalar(
        select(OperationsAgentDraft)
        .where(OperationsAgentDraft.operations_agent_id == agent.id)
        .with_for_update()
    )
    if draft is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Operations Agent draft is missing")
    draft.revision += 1
    draft.instructions = body.instructions
    draft.model_configuration = body.model_configuration
    draft.tool_configuration = body.tool_configuration
    draft.updated_by_user_id = access.user_id
    await db.flush()
    return ApiResponse.ok(OperationsAgentDraftRead.model_validate(draft))


@router.post(
    "/{agent_id}/versions",
    response_model=ApiResponse[PublishedOperationsAgentVersionRead],
    status_code=201,
)
async def publish_agent_version(
    workspace_id: str,
    agent_id: str,
    body: OperationsAgentPublish,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_AGENT_IDENTITIES)
    agent = await _get_agent(db, workspace_id, agent_id, lock=True)
    if agent.disabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Disabled Operations Agent cannot publish")
    profile = await _get_profile(db, agent)
    if profile.mode == AgentProfileMode.LOW_RISK_AUTOMATIC and access.role != WorkspaceRole.ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Automatic Operations Agent releases require Workspace Admin approval",
        )
    draft = await db.scalar(
        select(OperationsAgentDraft).where(OperationsAgentDraft.operations_agent_id == agent.id)
    )
    if draft is None or not draft.instructions.strip():
        raise HTTPException(status.HTTP_409_CONFLICT, "A non-empty Agent Draft is required")
    version_number = (agent.current_published_version or 0) + 1
    version = PublishedOperationsAgentVersion(
        operations_agent_id=agent.id,
        version=version_number,
        draft_revision=draft.revision,
        instructions=draft.instructions,
        model_configuration=draft.model_configuration,
        tool_configuration=draft.tool_configuration,
        published_by_user_id=access.user_id,
        reason=body.reason,
    )
    db.add(version)
    agent.current_published_version = version_number
    await db.flush()
    return ApiResponse.ok(PublishedOperationsAgentVersionRead.model_validate(version))


@router.post(
    "/{agent_id}/runs",
    response_model=ApiResponse[OperationsAgentRunRead],
    status_code=201,
)
async def start_agent_run(
    workspace_id: str,
    agent_id: str,
    body: OperationsAgentRunCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.RUN_OPERATIONS_AGENTS)
    agent = await _get_agent(db, workspace_id, agent_id, lock=True)
    if agent.disabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Disabled Operations Agent cannot run")
    if agent.current_published_version is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Published Agent Version required")
    await _get_profile(db, agent)
    run = OperationsAgentRun(
        workspace_id=workspace_id,
        operations_agent_id=agent.id,
        published_version=agent.current_published_version,
        profile_version=agent.current_profile_version,
        trigger_type="manual",
        target_resource_type=body.target_resource_type,
        target_resource_id=body.target_resource_id,
        status="queued",
        started_by_user_id=access.user_id,
    )
    db.add(run)
    await db.flush()
    return ApiResponse.ok(OperationsAgentRunRead.model_validate(run))


@router.post(
    "/{agent_id}/runs/{run_id}/pause",
    response_model=ApiResponse[OperationsAgentRunRead],
)
async def pause_agent_run(
    workspace_id: str,
    agent_id: str,
    run_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.RUN_OPERATIONS_AGENTS)
    run = await db.scalar(
        select(OperationsAgentRun)
        .where(OperationsAgentRun.workspace_id == workspace_id)
        .where(OperationsAgentRun.operations_agent_id == agent_id)
        .where(OperationsAgentRun.id == run_id)
        .with_for_update()
    )
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operations Agent Run not found")
    if run.status not in {"queued", "running"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "Operations Agent Run cannot be paused")
    run.status = "paused"
    await db.flush()
    return ApiResponse.ok(OperationsAgentRunRead.model_validate(run))


@router.post(
    "/{agent_id}/profiles",
    response_model=ApiResponse[AgentProfileRead],
    status_code=201,
)
async def assign_agent_profile(
    workspace_id: str,
    agent_id: str,
    body: AgentProfileCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.ASSIGN_AGENT_PROFILES)
    if body.mode == AgentProfileMode.LOW_RISK_AUTOMATIC and access.role != WorkspaceRole.ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only Workspace Admins may assign Low-Risk Automatic profiles",
        )

    agent = await _get_agent(db, workspace_id, agent_id, lock=True)
    if agent.disabled:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Disabled Operations Agent has no active profile",
        )
    profile = AgentPermissionProfile(
        operations_agent_id=agent.id,
        version=agent.current_profile_version + 1,
        mode=body.mode,
        tool_scope=body.tool_scope,
        resource_scope=body.resource_scope,
        action_scope=body.action_scope,
        assigned_by_user_id=access.user_id,
        reason=body.reason,
    )
    db.add(profile)
    agent.current_profile_version = profile.version
    await db.flush()
    return ApiResponse.ok(AgentProfileRead.model_validate(profile))
