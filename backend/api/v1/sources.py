from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.manager import AuthManager
from backend.database import get_db
from backend.schemas.common import ApiResponse, PaginationMeta
from backend.schemas.credential import CredentialCreate, CredentialKeyRead
from backend.schemas.source import DataSourceCreate, DataSourceDetail, DataSourceRead, DataSourceUpdate
from backend.services import source_service

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=ApiResponse[list[DataSourceRead]])
async def list_sources(
    enabled: Optional[bool] = None,
    channel_type: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    sources, total = await source_service.list_sources(
        db, enabled=enabled, channel_type=channel_type, page=page, limit=limit
    )
    return ApiResponse.ok(
        data=[DataSourceRead.model_validate(s) for s in sources],
        meta=PaginationMeta(
            total=total, page=page, limit=limit, pages=max(1, -(-total // limit))
        ),
    )


@router.post("", response_model=ApiResponse[DataSourceRead], status_code=201)
async def create_source(
    body: DataSourceCreate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.create_source(db, body)
    return ApiResponse.ok(DataSourceRead.model_validate(source))


class FeedDiscoveryRequest(BaseModel):
    url: str


class FeedCandidate(BaseModel):
    url: str
    title: Optional[str] = None


@router.post("/discover-feed", response_model=ApiResponse[list[FeedCandidate]])
async def discover_feed(body: FeedDiscoveryRequest) -> ApiResponse:
    """Given a site's homepage, find candidate RSS/Atom feeds — setup-time
    convenience, not a scheduled channel action. Returns every candidate found
    (never auto-picks "the main one"); empty list if none found."""
    candidates = await source_service.discover_feeds(body.url)
    return ApiResponse.ok([FeedCandidate(**c) for c in candidates])


class OpmlImportResult(BaseModel):
    created: list[DataSourceRead]
    skipped_existing: list[str]


@router.post("/import-opml", response_model=ApiResponse[OpmlImportResult])
async def import_opml(
    file: UploadFile = File(...), db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Bulk-create channel_type="rss" sources from an OPML export. Created
    rows land disabled (human reviews + enables); already-stored feed_urls and
    duplicates within the same file are skipped, not re-created."""
    raw = await file.read()
    try:
        entries = source_service.parse_opml(raw.decode("utf-8"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    created, skipped = await source_service.bulk_import_rss(db, entries)
    await db.commit()
    return ApiResponse.ok(
        OpmlImportResult(
            created=[DataSourceRead.model_validate(s) for s in created],
            skipped_existing=skipped,
        )
    )


@router.get("/{source_id}", response_model=ApiResponse[DataSourceDetail])
async def get_source(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return ApiResponse.ok(DataSourceDetail.model_validate(source))


@router.patch("/{source_id}", response_model=ApiResponse[DataSourceRead])
async def update_source(
    source_id: str, body: DataSourceUpdate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    updated = await source_service.update_source(db, source, body)
    return ApiResponse.ok(DataSourceRead.model_validate(updated))


@router.delete("/{source_id}", response_model=ApiResponse[None])
async def delete_source(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    await source_service.delete_source(db, source)
    return ApiResponse.ok(None)


@router.post("/{source_id}/test", response_model=ApiResponse[dict])
async def test_source(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    ok, errors = await source_service.test_source_connectivity(source)
    return ApiResponse.ok({"connected": ok, "errors": errors})


@router.get("/{source_id}/credentials", response_model=ApiResponse[list[CredentialKeyRead]])
async def list_source_credentials(
    source_id: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Which credential keys are stored for this source — never the values."""
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    keys = await AuthManager().list_keys(source_id)
    return ApiResponse.ok([CredentialKeyRead(key_name=k) for k in keys])


@router.post(
    "/{source_id}/credentials", response_model=ApiResponse[None], status_code=201
)
async def store_source_credential(
    source_id: str, body: CredentialCreate, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    """Encrypt and store a secret for this source (``AuthManager``-backed).
    Migrates a source off plaintext ``channel_config.auth`` / env indirection —
    channels that read via ``AuthManager`` (e.g. ``api``) prefer this over the
    legacy inline config once a matching key is stored."""
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    await AuthManager().store(source_id, body.key_name, body.secret)
    return ApiResponse.ok(None)


@router.delete("/{source_id}/credentials/{key_name}", response_model=ApiResponse[None])
async def delete_source_credential(
    source_id: str, key_name: str, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    await AuthManager().delete(source_id, key_name)
    return ApiResponse.ok(None)
