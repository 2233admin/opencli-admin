from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.automation import Automation
from backend.schemas.automation import AutomationCreate, AutomationRead, AutomationUpdate
from backend.schemas.common import ApiResponse
from backend.security.identity import RequestIdentity, get_request_identity
from backend.security.workspace_rbac import WorkspacePermission, get_workspace_access, require_permission

router = APIRouter(prefix="/workspaces/{workspace_id}/automations", tags=["automations"])


@router.get("", response_model=ApiResponse[list[AutomationRead]])
async def list_automations(
    workspace_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    rows = (await db.execute(
        select(Automation).where(Automation.workspace_id == workspace_id).order_by(Automation.created_at)
    )).scalars().all()
    return ApiResponse.ok([AutomationRead.model_validate(row) for row in rows])


@router.post("", response_model=ApiResponse[AutomationRead], status_code=201)
async def create_automation(
    workspace_id: str,
    body: AutomationCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_AGENT_IDENTITIES)
    row = Automation(workspace_id=workspace_id, created_by_user_id=access.user_id, **body.model_dump())
    db.add(row)
    await db.flush()
    return ApiResponse.ok(AutomationRead.model_validate(row))


@router.patch("/{automation_id}", response_model=ApiResponse[AutomationRead])
async def update_automation(
    workspace_id: str,
    automation_id: str,
    body: AutomationUpdate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_AGENT_IDENTITIES)
    row = await db.scalar(select(Automation).where(
        Automation.workspace_id == workspace_id, Automation.id == automation_id
    ).with_for_update())
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Automation not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.flush()
    return ApiResponse.ok(AutomationRead.model_validate(row))
