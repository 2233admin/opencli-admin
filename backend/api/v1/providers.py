"""CRUD endpoints for model providers, plus GOAL-6 PR-C's provider-scoped
API: test-connection, model-catalog sync, and model catalog CRUD (decision
#10). DB logic for the PR-C additions lives in
``backend.services.provider_model_service`` (thin-endpoint convention); this
module only does HTTP concerns (404 lookups, response shaping)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.llm.base import LlmAdapterError
from backend.models.provider import ModelProvider
from backend.schemas.common import ApiResponse
from backend.schemas.provider import ModelProviderCreate, ModelProviderRead, ModelProviderUpdate
from backend.schemas.provider_model import (
    ProviderModelManualCreate,
    ProviderModelRead,
    ProviderModelUpdate,
)
from backend.services import provider_model_service

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
    # GOAL-6 PR-C (decision #3 / PR-A note): sqlite here never runs with
    # PRAGMA foreign_keys=ON, so provider_models' ondelete=CASCADE never
    # fires at runtime -- clean up the catalog explicitly or it orphans.
    await provider_model_service.delete_provider_models(db, provider_id)
    await db.delete(provider)
    await db.commit()
    return ApiResponse.ok(None)


# ---------------------------------------------------------------------------
# GOAL-6 PR-C: test connection / model catalog sync + CRUD (decision #10)
# ---------------------------------------------------------------------------


@router.post("/{provider_id}/test", response_model=ApiResponse[dict])
async def test_provider_connection(
    provider_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Probe the provider via its adapter (PR-B factory). Never echoes
    ``api_key`` — ``ConnectionTestResult``/adapters guarantee that, not this
    endpoint (see ``backend.llm.base.redact_secret``)."""
    result = await provider_model_service.test_connection(db, provider_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    return ApiResponse.ok(result)


@router.post("/{provider_id}/models/sync", response_model=ApiResponse[dict])
async def sync_provider_models(
    provider_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Discover this provider's models and upsert them into its catalog
    (decision #3: manual rows are never touched; stale discovered rows are
    pruned — see ``provider_model_service.sync_models`` for the full policy).
    A genuine discovery failure (connection error, bad key, ...) surfaces as
    502, not 500 — the adapter already sanitized the message."""
    try:
        result = await provider_model_service.sync_models(db, provider_id)
    except LlmAdapterError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    return ApiResponse.ok(dict(result))


@router.get("/{provider_id}/models", response_model=ApiResponse[list[ProviderModelRead]])
async def list_provider_models(
    provider_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    provider = await provider_model_service.get_provider(db, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    rows = await provider_model_service.list_models(db, provider_id)
    return ApiResponse.ok([ProviderModelRead.model_validate(r) for r in rows])


@router.post(
    "/{provider_id}/models", response_model=ApiResponse[ProviderModelRead], status_code=201
)
async def add_provider_model(
    provider_id: str,
    body: ProviderModelManualCreate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    """Hand-register a catalog entry (``source="manual"`` — decision #3;
    the request body has no ``source`` field, it's always forced manual
    server-side)."""
    provider = await provider_model_service.get_provider(db, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    row = await provider_model_service.add_manual_model(db, provider_id, body)
    return ApiResponse.ok(ProviderModelRead.model_validate(row))


@router.patch(
    "/{provider_id}/models/{model_row_id}", response_model=ApiResponse[ProviderModelRead]
)
async def update_provider_model(
    provider_id: str,
    model_row_id: str,
    body: ProviderModelUpdate,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    existing = await provider_model_service.get_model(db, model_row_id)
    if existing is None or existing.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="Model not found")
    row = await provider_model_service.update_model(db, model_row_id, body)
    return ApiResponse.ok(ProviderModelRead.model_validate(row))


@router.delete("/{provider_id}/models/{model_row_id}", response_model=ApiResponse[None])
async def delete_provider_model(
    provider_id: str, model_row_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    existing = await provider_model_service.get_model(db, model_row_id)
    if existing is None or existing.provider_id != provider_id:
        raise HTTPException(status_code=404, detail="Model not found")
    await provider_model_service.delete_model(db, model_row_id)
    return ApiResponse.ok(None)
