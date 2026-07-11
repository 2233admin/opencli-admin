"""Request identity endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends

from backend.schemas.common import ApiResponse
from backend.security.identity import RequestIdentity, get_request_identity

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=ApiResponse[dict])
async def read_identity(
    identity: Annotated[RequestIdentity, Depends(get_request_identity)],
) -> ApiResponse:
    return ApiResponse.ok(
        {
            "subject": identity.subject,
            "email": identity.email,
            "name": identity.name,
            "is_platform_admin": identity.is_platform_admin,
            "auth_method": identity.auth_method,
        }
    )
