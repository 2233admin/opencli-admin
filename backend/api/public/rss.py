"""GET /api/public/rss — PR-F (GOAL-5.md).

Publishing direction only. This is unrelated to backend/channels/rss_channel.py
(which pulls entries FROM external RSS/Atom feeds INTO the pipeline as an
ingestion channel) — this module instead serves a feed built FROM our own
public content, going the opposite direction. Per GOAL-5.md 架构决策 #8, it
does not reuse rss_channel.py's ingestion logic at all; it only reuses
backend.services.public_content_service.query_public_records (PR-D, the same
single "what's safe to expose publicly" gate that backend/api/public/items.py
(PR-E) calls) plus the PublicRecordRead whitelist mapper (PR-E,
backend/api/public/schemas.py) so this endpoint can never leak a field the
REST endpoint wouldn't also expose.

Route naming vs. wire format: the path segment is "rss" (matching the AIHOT
reference and GOAL-5.md's own PR-F heading), but 架构决策 #8 explicitly locks
the serialization format to Atom via the `feedgen` library — so the response
body is Atom XML (`application/atom+xml`), not RSS 2.0. This is intentional,
not a mismatch: keep both the path and the content-type as-is.

Error handling (GOAL-5.md PR-F acceptance criteria): if anything fails while
building or serializing the feed (bad data shape, a `feedgen` internal error,
an unexpected DB issue after the request already passed query-param
validation), the endpoint logs the exception server-side and still returns a
200 with a valid, empty Atom feed shell — never a 500. That fallback shell is
hand-built as a plain string (see `_empty_feed_xml`), not via `feedgen`, so it
keeps working even if `feedgen` itself is what raised.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

import dateutil.parser
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from feedgen.feed import FeedGenerator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.public.schemas import to_public_record_read
from backend.database import get_db
from backend.models.source import DataSource
from backend.services import tag_service
from backend.services.public_content_service import VALID_MODES, query_public_records
from backend.taxonomy import TOP_LEVEL_CATEGORIES, is_valid_category

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rss", tags=["public"])

ATOM_CONTENT_TYPE = "application/atom+xml"

FEED_ID = "urn:opencli-admin:public-feed"
FEED_TITLE = "opencli-admin Public Feed"
FEED_LINK = "/api/public/rss"


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    """Best-effort parse of a raw, per-source date string (same
    ``normalized_data.published_at`` values described in
    ``public_content_service.py`` — no guaranteed format) into a tz-aware
    ``datetime``. Returns ``None`` on any failure rather than raising —
    ``feedgen`` requires tz-aware datetimes for ``updated``/``published``, so
    a naive result is promoted to UTC instead of being passed through."""
    if not value:
        return None
    try:
        parsed = dateutil.parser.parse(value)
    except (ValueError, OverflowError, TypeError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _empty_feed_xml() -> bytes:
    """Valid-but-empty Atom feed shell, hand-built without ``feedgen`` so this
    fallback path survives even when ``feedgen`` itself is the thing that
    failed (see module docstring)."""
    now = datetime.now(timezone.utc).isoformat()
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">\n'
        f"  <id>{FEED_ID}</id>\n"
        f"  <title>{FEED_TITLE}</title>\n"
        f"  <updated>{now}</updated>\n"
        "</feed>\n"
    )
    return xml.encode("utf-8")


@router.get("", response_class=Response)
async def public_rss_feed(
    mode: str = Query("selected", description="'selected' (curated only) or 'all'"),
    category: Optional[str] = Query(None, description="Top-level taxonomy category name"),
    since: Optional[datetime] = Query(None, description="ISO-8601 lower bound on ingestion time"),
    q: Optional[str] = Query(None, description="Case-insensitive keyword search"),
    take: Optional[int] = Query(None, description="Max rows (default 50, hard cap 200)"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # Same query-param validation as backend/api/public/items.py (PR-E),
    # against the same VALID_MODES / is_valid_category / TOP_LEVEL_CATEGORIES
    # constants — kept intentionally identical so malformed input behaves the
    # same across both public endpoints.
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

    try:
        xml_bytes = await _build_feed_xml(
            db, mode=mode, category=category, since=since, q=q, take=take
        )
    except Exception:
        logger.exception("Failed to build/serialize public RSS feed; returning empty feed shell")
        xml_bytes = _empty_feed_xml()

    return Response(content=xml_bytes, media_type=ATOM_CONTENT_TYPE)


async def _build_feed_xml(
    db: AsyncSession,
    *,
    mode: str,
    category: Optional[str],
    since: Optional[datetime],
    q: Optional[str],
    take: Optional[int],
) -> bytes:
    """Query -> whitelist-map -> serialize. Split out from the route handler
    so the route's try/except has a single, obvious seam covering the whole
    build (query_public_records call, tag/source lookups, and feedgen
    construction/serialization all count as "serialization failed" for the
    purposes of the empty-feed fallback)."""
    records = await query_public_records(
        db, mode=mode, category=category, since=since, q=q, take=take
    )

    fg = FeedGenerator()
    fg.id(FEED_ID)
    fg.title(FEED_TITLE)
    fg.link(href=FEED_LINK, rel="self")
    fg.subtitle(FEED_TITLE)
    fg.updated(datetime.now(timezone.utc))

    if not records:
        return fg.atom_str(pretty=True)

    # Batch-fetch DataSource names up front — same N+1 avoidance as
    # backend/api/public/items.py.
    source_ids = list({r.source_id for r in records})
    sources = (
        await db.execute(select(DataSource).where(DataSource.id.in_(source_ids)))
    ).scalars().all()
    name_map = {s.id: s.name for s in sources}

    for record in records:
        tags = await tag_service.get_tags(db, record.id)
        record_category = next((t.name for t in tags if t.type == "category"), None)
        subtags = [t.name for t in tags if t.type == "subtag"]

        # Same whitelist mapper as the REST endpoint (PR-E) — never touches
        # record.raw_data/normalized_data directly, only fields
        # to_public_record_read already decided are safe to expose.
        item = to_public_record_read(
            record,
            source_name=name_map.get(record.source_id, ""),
            category=record_category,
            subtags=subtags,
        )

        fe = fg.add_entry()
        fe.id(item.id)
        fe.title(item.title or "(untitled)")
        # Atom requires either an alternate link or a content element; always
        # supply a non-empty href so entries with a blank url still validate.
        fe.link(href=item.url or f"urn:opencli-admin:record:{item.id}")
        if item.summary:
            fe.summary(item.summary)

        published_dt = _parse_datetime(item.published_at)
        if published_dt is not None:
            fe.published(published_dt)
            fe.updated(published_dt)

        if item.category:
            fe.category(term=item.category)

    return fg.atom_str(pretty=True)
