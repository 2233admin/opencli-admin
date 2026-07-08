"""GET /api/public/daily, /api/public/daily/{date}, /api/public/dailies — PR-G.

Thin HTTP adapter over backend.services.digest_service. Digest rows are
snapshots (see that module's docstring — "not computed in real time"), built
by a scheduled job (backend/worker/tasks.py's ``run_daily_digest`` Celery
task / backend/worker/digest_job.py's standalone entrypoint), never by these
read-only endpoints. Records referenced by a digest are re-mapped through the
same ``PublicRecordRead`` whitelist (backend/api/public/schemas.py, PR-E)
``/api/public/items`` and ``/api/public/rss`` already use — this module must
never expose ``raw_data``/``normalized_data`` or any other internal field a
digest happens to reference, and (via
``digest_service.get_records_for_digest``'s re-applied ``DataSource.public``
gate) must never surface a record whose source has since gone private, even
though the digest snapshot itself is otherwise static.
"""

from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.public.schemas import PublicRecordRead, to_public_record_read
from backend.database import get_db
from backend.models.digest import DailyDigest
from backend.models.source import DataSource
from backend.schemas.common import ApiResponse
from backend.services import digest_service, tag_service

# Two routers (distinct prefixes) mounted onto the same public_router — see
# backend/api/public/router.py. "/daily" (exact + "/{digest_date}") and
# "/dailies" (list) don't collide as path patterns, but sharing one
# APIRouter with two different prefixes isn't possible, hence two objects
# here (mirrors the general one-router-per-resource pattern used by
# items.py/rss.py, just split across two prefixes in a single module since
# they're small and tightly related).
router = APIRouter(prefix="/daily", tags=["public"])
dailies_router = APIRouter(prefix="/dailies", tags=["public"])


class DailyDigestRead(BaseModel):
    date: date_type
    summary: Optional[str] = None
    records: list[PublicRecordRead] = []


class DailyDigestSummary(BaseModel):
    date: date_type
    record_count: int


async def _to_digest_read(db: AsyncSession, digest: DailyDigest) -> DailyDigestRead:
    """Map a ``DailyDigest`` row to the public response shape, resolving its
    referenced records through the same whitelist mapper + batch source/tag
    lookups ``backend/api/public/items.py`` uses (avoids N+1 queries)."""
    records = await digest_service.get_records_for_digest(db, digest)
    if not records:
        return DailyDigestRead(date=digest.date, summary=digest.summary, records=[])

    source_ids = list({r.source_id for r in records})
    sources = (
        await db.execute(select(DataSource).where(DataSource.id.in_(source_ids)))
    ).scalars().all()
    name_map = {s.id: s.name for s in sources}

    data: list[PublicRecordRead] = []
    for record in records:
        tags = await tag_service.get_tags(db, record.id)
        category = next((t.name for t in tags if t.type == "category"), None)
        subtags = [t.name for t in tags if t.type == "subtag"]
        data.append(
            to_public_record_read(
                record,
                source_name=name_map.get(record.source_id, ""),
                category=category,
                subtags=subtags,
            )
        )

    return DailyDigestRead(date=digest.date, summary=digest.summary, records=data)


@router.get("", response_model=ApiResponse[DailyDigestRead])
async def get_latest_daily_digest(db: AsyncSession = Depends(get_db)) -> ApiResponse:
    """Today's digest if it has been built, else the most recently built one.
    404 only when no digest has ever been built (see
    ``digest_service.get_latest_digest``)."""
    digest = await digest_service.get_latest_digest(db)
    if digest is None:
        raise HTTPException(status_code=404, detail="No daily digest available yet")
    return ApiResponse.ok(data=await _to_digest_read(db, digest))


@router.get("/{digest_date}", response_model=ApiResponse[DailyDigestRead])
async def get_daily_digest_by_date(
    digest_date: date_type, db: AsyncSession = Depends(get_db)
) -> ApiResponse:
    digest = await digest_service.get_digest_by_date(db, digest_date)
    if digest is None:
        raise HTTPException(
            status_code=404, detail=f"No digest found for {digest_date.isoformat()}"
        )
    return ApiResponse.ok(data=await _to_digest_read(db, digest))


@dailies_router.get("", response_model=ApiResponse[list[DailyDigestSummary]])
async def list_daily_digests(
    take: int = Query(30, description="Max number of digest dates to return (most recent first)"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    digests = await digest_service.list_digest_dates(db, take=take)
    data = [
        DailyDigestSummary(date=d.date, record_count=len(d.record_ids or []))
        for d in digests
    ]
    return ApiResponse.ok(data=data)
