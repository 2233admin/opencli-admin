from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.consumer_grant import ConsumerGrant
from backend.models.identity import ServiceIdentity
from backend.schemas.common import ApiResponse
from backend.schemas.consumer_grant import (
    ConsumerGrantCreate,
    ConsumerGrantPatch,
    ConsumerGrantRead,
    ConsumerGrantRevoke,
)
from backend.security.identity import RequestIdentity, get_request_identity
from backend.security.workspace_rbac import (
    WorkspacePermission,
    get_workspace_access,
    require_permission,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/consumer-grants", tags=["consumer-grants"])


def _read_grant(grant: ConsumerGrant) -> ConsumerGrantRead:
    if grant.revoked_at is not None:
        grant_status = "revoked"
    else:
        grant_status = "enabled" if grant.enabled else "disabled"
    return ConsumerGrantRead(
        id=grant.id,
        service_identity_id=grant.service_identity_id,
        name=grant.name,
        resource_scope=grant.resource_scope,
        data_scope=grant.data_scope,
        quota=grant.quota,
        status=grant_status,
        enabled=grant.enabled,
        created_by_user_id=grant.created_by_user_id,
        revoked_at=grant.revoked_at,
        revoked_by_user_id=grant.revoked_by_user_id,
        revocation_reason=grant.revocation_reason,
        created_at=grant.created_at,
        updated_at=grant.updated_at,
    )


async def _get_grant(
    db: AsyncSession, workspace_id: str, grant_id: str, *, lock: bool = False
) -> ConsumerGrant:
    query = (
        select(ConsumerGrant)
        .join(ServiceIdentity, ServiceIdentity.id == ConsumerGrant.service_identity_id)
        .where(ServiceIdentity.workspace_id == workspace_id)
        .where(ConsumerGrant.id == grant_id)
    )
    if lock:
        query = query.with_for_update()
    grant = await db.scalar(query)
    if grant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Consumer Grant not found")
    return grant


@router.get("", response_model=ApiResponse[list[ConsumerGrantRead]])
async def list_consumer_grants(
    workspace_id: str,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.READ)
    grants = (
        (
            await db.execute(
                select(ConsumerGrant)
                .join(
                    ServiceIdentity,
                    ServiceIdentity.id == ConsumerGrant.service_identity_id,
                )
                .where(ServiceIdentity.workspace_id == workspace_id)
                .order_by(ConsumerGrant.created_at)
            )
        )
        .scalars()
        .all()
    )
    return ApiResponse.ok([_read_grant(grant) for grant in grants])


@router.post("", response_model=ApiResponse[ConsumerGrantRead], status_code=201)
async def create_consumer_grant(
    workspace_id: str,
    body: ConsumerGrantCreate,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_CONSUMER_GRANTS)
    service_identity = await db.scalar(
        select(ServiceIdentity)
        .where(ServiceIdentity.id == body.service_identity_id)
        .where(ServiceIdentity.workspace_id == workspace_id)
    )
    if service_identity is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Service Identity must belong to Workspace",
        )
    if service_identity.disabled:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Disabled Service Identity cannot receive a Consumer Grant",
        )
    existing = await db.scalar(
        select(ConsumerGrant)
        .where(ConsumerGrant.service_identity_id == service_identity.id)
        .where(ConsumerGrant.name == body.name)
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Consumer Grant name already exists")

    grant = ConsumerGrant(
        service_identity_id=service_identity.id,
        name=body.name,
        resource_scope=body.resource_scope.model_dump(mode="json"),
        data_scope=body.data_scope.model_dump(mode="json"),
        quota=body.quota.model_dump(mode="json"),
        created_by_user_id=access.user_id,
    )
    db.add(grant)
    await db.flush()
    return ApiResponse.ok(_read_grant(grant))


@router.patch("/{grant_id}", response_model=ApiResponse[ConsumerGrantRead])
async def patch_consumer_grant(
    workspace_id: str,
    grant_id: str,
    body: ConsumerGrantPatch,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_CONSUMER_GRANTS)
    grant = await _get_grant(db, workspace_id, grant_id, lock=True)
    if grant.revoked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Revoked Consumer Grant cannot be changed")
    grant.enabled = body.enabled
    await db.flush()
    return ApiResponse.ok(_read_grant(grant))


@router.post("/{grant_id}/revoke", response_model=ApiResponse[ConsumerGrantRead])
async def revoke_consumer_grant(
    workspace_id: str,
    grant_id: str,
    body: ConsumerGrantRevoke,
    identity: RequestIdentity = Depends(get_request_identity),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    access = await get_workspace_access(db, workspace_id, identity)
    require_permission(access, WorkspacePermission.MANAGE_CONSUMER_GRANTS)
    grant = await _get_grant(db, workspace_id, grant_id, lock=True)
    if grant.revoked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Consumer Grant is already revoked")
    grant.enabled = False
    grant.revoked_at = datetime.now(UTC)
    grant.revoked_by_user_id = access.user_id
    grant.revocation_reason = body.reason
    await db.flush()
    return ApiResponse.ok(_read_grant(grant))
