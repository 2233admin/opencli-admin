"""The single query entry point for all publicly-exposed content.

Both the REST API (PR-E) and the RSS feed (PR-F) call ``query_public_records``
instead of writing their own "what may be shown publicly" filter — see
GOAL-5.md 架构决策 #7. This module is security-critical: it is the ONLY place
allowed to decide which ``CollectedRecord`` rows may leave the system through
a public, unauthenticated channel.

Hard, non-optional invariant: ``DataSource.public == True``. This predicate
is applied unconditionally, before any other parameter is considered, and is
never wrapped in a branch that another parameter could skip. No combination
of ``mode``/``category``/``since``/``q``/``take`` can surface a record whose
parent source has ``public=False`` — see
``tests/unit/test_public_content_service.py`` for the adversarial-parameter
regression coverage that pins this down.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.tag import Tag, TagBinding
from backend.taxonomy import is_valid_category

# take: sane default + hard cap so a caller can never force an unbounded scan.
DEFAULT_TAKE = 50
MAX_TAKE = 200

VALID_MODES: tuple[str, ...] = ("selected", "all")


def _normalize_take(take: Optional[int]) -> int:
    """Resolve the effective LIMIT: default when omitted, always clamped to
    ``[0, MAX_TAKE]`` (negative values collapse to 0 rather than erroring —
    this is a read-only query gate, so "asked for a nonsensical amount"
    degrades to "return nothing" rather than raising)."""
    if take is None:
        return DEFAULT_TAKE
    return max(0, min(take, MAX_TAKE))


async def query_public_records(
    session: AsyncSession,
    mode: str = "selected",
    category: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    q: Optional[str] = None,
    take: Optional[int] = None,
) -> list[CollectedRecord]:
    """Query ``CollectedRecord`` rows that are safe to show on a public,
    anonymous channel.

    Args:
        mode: ``"selected"`` (default) — only human-curated
            (``CollectedRecord.curated == True``) records. ``"all"`` drops the
            curated requirement but keeps the public-source gate. Any other
            value raises ``ValueError``.
        category: optional top-level taxonomy category name (see
            ``backend.taxonomy.TOP_LEVEL_CATEGORIES``). Invalid names raise
            ``ValueError`` (callers such as the REST layer translate this
            into a 400 + the valid-value list).
        since: optional ISO-8601 datetime lower bound. Filters on
            ``CollectedRecord.created_at`` (ingestion time) rather than the
            ``published_at`` value embedded in ``normalized_data`` — that
            field is a raw, per-source string with no guaranteed format
            (see ``backend.pipeline.normalizer``'s multi-key fallback list),
            so it cannot be safely compared as a datetime. ``created_at`` is
            a real, always-populated ``DateTime`` column.
        until: optional ISO-8601 datetime upper bound (exclusive), same
            ``created_at`` column as ``since``. Added for
            ``backend.services.digest_service`` (PR-G), which needs a closed
            ``[start, end)`` window for "this calendar date" rather than an
            open-ended lower bound — every existing caller omits it, so this
            is purely additive and changes no prior behavior.
        q: optional keyword search. Matched with a case-insensitive
            substring test against ``normalized_data`` cast to text (same
            approach as ``record_service.list_records``) — a plain
            LIKE/CONTAINS scan, not an indexed full-text search. Fine for
            this PR's data volume; a real search index (e.g. pg_trgm/GIN) is
            out of scope here and would need its own migration/PR.
        take: max rows to return. ``None`` -> ``DEFAULT_TAKE`` (50).
            Always clamped to at most ``MAX_TAKE`` (200), regardless of what
            the caller asks for.

    Returns:
        Matching ``CollectedRecord`` rows, newest (``created_at``) first.
    """
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode: {mode!r}; must be one of {VALID_MODES}")
    if category is not None and not is_valid_category(category):
        raise ValueError(f"Invalid category: {category!r}")

    query = (
        select(CollectedRecord)
        .join(DataSource, DataSource.id == CollectedRecord.source_id)
        # --- HARD GATE: unconditional, applied before any other filter. ---
        .where(DataSource.public.is_(True))
    )

    if mode == "selected":
        query = query.where(CollectedRecord.curated.is_(True))

    if category is not None:
        # Composed as a subquery (rather than reusing
        # TagService.list_by_category + a Python-side `.in_(ids)` list) so
        # the category filter joins in the same single SQL statement as the
        # public/curated/since/q filters, instead of a second round trip
        # that materializes a potentially large record-id list in Python.
        category_record_ids = (
            select(TagBinding.target_id)
            .join(Tag, Tag.id == TagBinding.tag_id)
            .where(Tag.type == "category", Tag.name == category)
        )
        query = query.where(CollectedRecord.id.in_(category_record_ids))

    if since is not None:
        query = query.where(CollectedRecord.created_at >= since)

    if until is not None:
        query = query.where(CollectedRecord.created_at < until)

    if q:
        term = q.strip().lower()
        if term:
            query = query.where(
                func.lower(func.cast(CollectedRecord.normalized_data, String)).contains(term)
            )

    query = query.order_by(CollectedRecord.created_at.desc()).limit(_normalize_take(take))

    result = await session.execute(query)
    return list(result.scalars().all())
