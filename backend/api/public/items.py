"""GET /api/public/items — PR-E (GOAL-5.md).

Thin HTTP adapter over backend.services.public_content_service.
query_public_records (PR-D, the single "what's safe to expose publicly"
gate) — this module must never reimplement that filtering logic, only
translate HTTP query params to/from it and map results through the
PublicRecordRead whitelist (backend/api/public/schemas.py).
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.public.schemas import PublicRecordRead, to_public_record_read
from backend.database import get_db
from backend.models.source import DataSource
from backend.schemas.common import ApiResponse
from backend.services import tag_service
from backend.services.public_content_service import VALID_MODES, query_public_records
from backend.taxonomy import TOP_LEVEL_CATEGORIES, is_valid_category

router = APIRouter(prefix="/items", tags=["public"])


@router.get("", response_model=ApiResponse[list[PublicRecordRead]])
async def list_public_items(
    mode: str = Query("selected", description="'selected' (curated only) or 'all'"),
    category: Optional[str] = Query(None, description="Top-level taxonomy category name"),
    since: Optional[datetime] = Query(None, description="ISO-8601 lower bound on ingestion time"),
    q: Optional[str] = Query(None, description="Case-insensitive keyword search"),
    take: Optional[int] = Query(None, description="Max rows (default 50, hard cap 200)"),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse:
    # Validated here (rather than only inside query_public_records) so the
    # 400 response bodies can be shaped for API consumers — the valid
    # category list in particular (架构决策 #11 / PR-E acceptance criteria).
    if mode not in VALID_MODES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode: {mode!r}; must be one of {list(VALID_MODES)}",
        )
    if category is not None and not is_valid_category(category):
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Invalid category: {category!r}",
                "valid_categories": list(TOP_LEVEL_CATEGORIES),
            },
        )

    records = await query_public_records(
        db, mode=mode, category=category, since=since, q=q, take=take
    )

    if not records:
        return ApiResponse.ok(data=[])

    # Batch-fetch DataSource names and Tag bindings for the whole page up
    # front (same pattern as backend/api/v1/tasks.py's source name_map) to
    # avoid one query per record.
    source_ids = list({r.source_id for r in records})
    sources = (
        await db.execute(select(DataSource).where(DataSource.id.in_(source_ids)))
    ).scalars().all()
    name_map = {s.id: s.name for s in sources}

    data: list[PublicRecordRead] = []
    for record in records:
        tags = await tag_service.get_tags(db, record.id)
        record_category = next((t.name for t in tags if t.type == "category"), None)
        subtags = [t.name for t in tags if t.type == "subtag"]
        data.append(
            to_public_record_read(
                record,
                source_name=name_map.get(record.source_id, ""),
                category=record_category,
                subtags=subtags,
            )
        )

    return ApiResponse.ok(data=data)
