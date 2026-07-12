from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.workspace_settings import SettingsPatch, SettingsRead
from backend.services import workspace_settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=ApiResponse[SettingsRead])
async def read_settings(db: AsyncSession = Depends(get_db)) -> ApiResponse:
    return ApiResponse.ok(await workspace_settings_service.get_settings(db))


@router.patch("", response_model=ApiResponse[SettingsRead])
async def patch_settings(body: SettingsPatch, db: AsyncSession = Depends(get_db)) -> ApiResponse:
    return ApiResponse.ok(await workspace_settings_service.update_settings(db, body))


@router.delete("", response_model=ApiResponse[SettingsRead])
async def reset_settings(db: AsyncSession = Depends(get_db)) -> ApiResponse:
    return ApiResponse.ok(await workspace_settings_service.reset_settings(db))
