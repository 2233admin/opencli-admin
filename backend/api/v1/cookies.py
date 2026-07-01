"""Admin endpoint for CookieCloud sync — manual trigger only (v1; no scheduled
sync, see backend/auth/cookiecloud_sync.py docstring). Credentials are passed
per call, not persisted, matching the "no new settings storage" tight scope."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.auth.cookiecloud_sync import CookieCloudSyncError, sync_from_cookiecloud
from backend.schemas.common import ApiResponse

router = APIRouter(prefix="/cookies", tags=["cookies"])


class CookieCloudSyncRequest(BaseModel):
    url: str
    uuid: str
    password: str


@router.post("/sync", response_model=ApiResponse[dict])
async def sync_cookies(body: CookieCloudSyncRequest) -> ApiResponse:
    try:
        synced = await sync_from_cookiecloud(body.url, body.uuid, body.password)
    except CookieCloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ApiResponse.ok({"synced": synced})
