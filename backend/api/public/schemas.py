"""Response whitelist for the public API (PR-E, GOAL-5.md 架构决策 #11).

``PublicRecordRead`` only ever exposes ``id/title/url/summary/source_name/
published_at/category/subtags``. ``CollectedRecord`` stores nearly everything
else inside JSON blobs (``raw_data``/``normalized_data``/``ai_enrichment``) —
building this schema via ``PublicRecordRead.model_validate(record)`` with
``from_attributes=True`` would read those blobs (or future columns) by
arbitrary attribute access and could silently leak fields the moment someone
adds one to the ORM model. ``to_public_record_read`` below is the only
sanctioned path from a ``CollectedRecord`` row to this schema: it names each
source field explicitly and nothing else.
"""

from typing import TYPE_CHECKING, Optional

from pydantic import BaseModel

if TYPE_CHECKING:
    from backend.models.record import CollectedRecord


class PublicRecordRead(BaseModel):
    id: str
    title: str
    url: str
    summary: str
    source_name: str
    # Raw per-source string, not a parsed datetime — see
    # backend/services/public_content_service.py's docstring on `since`:
    # normalized_data.published_at has no guaranteed format across sources,
    # so it is passed through as-is rather than coerced.
    published_at: Optional[str] = None
    category: Optional[str] = None
    subtags: list[str] = []


def _extract_summary(record: "CollectedRecord", normalized: dict) -> str:
    """Prefer an LLM-produced summary if the configured enrichment prompt
    happened to emit one in ``ai_enrichment`` (opportunistic read, same
    pattern as backend/pipeline/classification.py's category/subtags
    extraction — no new LLM call here), else fall back to the normalized
    ``content`` field. Never raises on malformed/missing ``ai_enrichment``.
    """
    enrichment = record.ai_enrichment
    if isinstance(enrichment, dict):
        summary = enrichment.get("summary")
        if isinstance(summary, str) and summary.strip():
            return summary
    content = normalized.get("content")
    return content if isinstance(content, str) else ""


def to_public_record_read(
    record: "CollectedRecord",
    *,
    source_name: str,
    category: Optional[str],
    subtags: list[str],
) -> PublicRecordRead:
    """Map a ``CollectedRecord`` ORM row onto the public whitelist schema.

    ``source_name``, ``category`` and ``subtags`` are passed in by the
    caller (see backend/api/public/items.py) rather than looked up here,
    because the caller batch-fetches ``DataSource`` names and ``Tag``
    bindings for the whole result page up front to avoid N+1 queries; this
    function only ever reads ``record.id``/``record.normalized_data``/
    ``record.ai_enrichment`` — never ``record.raw_data`` and never any
    ``DataSource`` config field.
    """
    normalized = record.normalized_data if isinstance(record.normalized_data, dict) else {}
    title = normalized.get("title")
    url = normalized.get("url")
    published_at = normalized.get("published_at")
    return PublicRecordRead(
        id=record.id,
        title=title if isinstance(title, str) else "",
        url=url if isinstance(url, str) else "",
        summary=_extract_summary(record, normalized),
        source_name=source_name,
        published_at=published_at if isinstance(published_at, str) and published_at else None,
        category=category,
        subtags=subtags,
    )
