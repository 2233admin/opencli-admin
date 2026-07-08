"""CRUD endpoints for model providers."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models.provider import ModelProvider
from backend.schemas.common import ApiResponse
from backend.schemas.provider import ModelProviderCreate, ModelProviderRead, ModelProviderUpdate

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("", response_model=ApiResponse[list[ModelProviderRead]])
async def list_providers(db: AsyncSession = Depends(get_db)) -> ApiResponse:
    result = await db.execute(select(ModelProvider).order_by(ModelProvider.created_at.desc()))
    # ModelProviderRead.from_model masks api_key (has_api_key/api_key_preview
    # only) — see AUDIT item B3. Built explicitly rather than relying on
    # response_model's from_attributes, since api_key -> has_api_key/
    # api_key_preview isn't a 1:1 attribute mapping.
    providers = [ModelProviderRead.from_model(p) for p in result.scalars().all()]
    return ApiResponse.ok(providers)


@router.post("", response_model=ApiResponse[ModelProviderRead], status_code=201)
async def create_provider(body: ModelProviderCreate, db: AsyncSession = Depends(get_db)) -> ApiResponse:
    provider = ModelProvider(**body.model_dump())
    db.add(provider)
    await db.commit()
    await db.refresh(provider)
    return ApiResponse.ok(ModelProviderRead.from_model(provider))


@router.patch("/{provider_id}", response_model=ApiResponse[ModelProviderRead])
async def update_provider(
    provider_id: str, body: ModelProviderUpdate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    result = await db.execute(select(ModelProvider).where(ModelProvider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(provider, field, value)
    await db.commit()
    await db.refresh(provider)
    return ApiResponse.ok(ModelProviderRead.from_model(provider))


@router.delete("/{provider_id}", response_model=ApiResponse[None])
async def delete_provider(provider_id: str, db: AsyncSession = Depends(get_db)) -> ApiResponse:
    result = await db.execute(select(ModelProvider).where(ModelProvider.id == provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    await db.delete(provider)
    await db.commit()
    return ApiResponse.ok(None)
