"""Pipeline step 4b: category/subtag classification.

Runs once per pipeline execution, immediately after the AI enrichment step
(step 4), regardless of whether that step succeeded, failed, was skipped, or
was disabled entirely. This is a best-effort side effect of the enrichment
stage — it must never raise, never flip a record's ``status``, and never
block the rest of the pipeline (see GOAL-5.md 架构决策 #5 / 状态机 PR-C).

Classification source of truth, in priority order:
1. An opportunistic ``category``/``subtags`` suggestion already present in
   the record's ``ai_enrichment`` JSON blob (i.e. whatever the configured
   enrichment prompt happened to produce — no new LLM call is made here).
2. ``DataSource.default_category`` as a source-level fallback when (1) is
   absent, invalid, or enrichment didn't run/failed.
3. If neither is available, the record is left uncategorized (a warning is
   logged, nothing crashes). Subtags, if any were found in (1), are still
   applied even when no category could be resolved.
"""

import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.services import tag_service
from backend.taxonomy import is_valid_category

if TYPE_CHECKING:
    from backend.models.record import CollectedRecord
    from backend.models.source import DataSource

logger = logging.getLogger(__name__)


def _extract_llm_suggestion(ai_enrichment: Any) -> tuple[str | None, list[str]]:
    """Pull an opportunistic ``category``/``subtags`` suggestion out of an
    already-computed ``ai_enrichment`` JSON blob, if present and well-formed.

    Returns ``(category_or_None, subtags_list)``. Never raises: malformed or
    missing data simply yields ``(None, [])`` so the caller falls back.
    """
    if not isinstance(ai_enrichment, dict):
        return None, []
    # Per-record processor errors (e.g. {"error": "..."} from claude/openai
    # processors) are not a usable classification signal.
    if ai_enrichment.get("error"):
        return None, []

    category = ai_enrichment.get("category")
    if not (isinstance(category, str) and is_valid_category(category)):
        category = None

    raw_subtags = ai_enrichment.get("subtags")
    subtags: list[str] = []
    if isinstance(raw_subtags, list):
        subtags = [s.strip() for s in raw_subtags if isinstance(s, str) and s.strip()]

    return category, subtags


def _resolve_category(
    llm_category: str | None,
    record_id: str,
    source: "DataSource",
) -> str | None:
    """Resolve the final category for a record: LLM suggestion wins, else
    fall back to ``source.default_category``. Logs a warning (never raises)
    when neither is usable, leaving the record uncategorized."""
    if llm_category is not None:
        return llm_category

    default_category = getattr(source, "default_category", None)
    if default_category:
        if is_valid_category(default_category):
            return default_category
        logger.warning(
            "classification: record=%s source=%s has invalid default_category=%r, "
            "skipping category binding",
            record_id, getattr(source, "id", "?"), default_category,
        )
        return None

    logger.warning(
        "classification: record=%s source=%s has no usable category (no LLM "
        "suggestion, no default_category); leaving record uncategorized",
        record_id, getattr(source, "id", "?"),
    )
    return None


async def classify_record(
    session: AsyncSession,
    record: "CollectedRecord",
    source: "DataSource",
) -> None:
    """Bind a category (and any subtags) for a single record.

    Best-effort: catches and logs any exception rather than propagating it,
    so a classification failure can never fail the pipeline or affect
    ``CollectedRecord.status``.
    """
    try:
        llm_category, subtags = _extract_llm_suggestion(getattr(record, "ai_enrichment", None))
        category = _resolve_category(llm_category, record.id, source)

        if category is not None:
            await tag_service.bind_category(session, record.id, category)

        if subtags:
            await tag_service.add_subtags(session, record.id, subtags)
    except Exception as exc:
        logger.warning(
            "classification: record=%s failed, skipping | %s",
            getattr(record, "id", "?"), exc,
        )


async def classify_records(
    session: AsyncSession,
    records: list["CollectedRecord"],
    source: "DataSource",
) -> None:
    """Classify a batch of records (see ``classify_record``)."""
    for record in records:
        await classify_record(session, record, source)
