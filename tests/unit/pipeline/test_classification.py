"""Tests for backend.pipeline.classification (PR-C).

Covers the locked behavior from GOAL-5.md 架构决策 #5 / 状态机 PR-C:
  - an LLM-driven category/subtag suggestion already present in
    ``ai_enrichment`` wins and overrides
  - enrichment disabled/didn't run/failed -> falls back to
    ``DataSource.default_category``
  - ``default_category`` also empty/invalid -> warning logged, no crash, no
    category binding, but subtags (if any) still get applied
  - classification never raises, even if the underlying TagService call
    blows up
"""

import logging
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.pipeline import classification
from backend.services import tag_service


def _record(record_id: str | None = None, ai_enrichment=None):
    return SimpleNamespace(id=record_id or str(uuid.uuid4()), ai_enrichment=ai_enrichment)


def _source(source_id: str | None = None, default_category: str | None = None):
    return SimpleNamespace(id=source_id or str(uuid.uuid4()), default_category=default_category)


# ── LLM-driven success path (overriding) ────────────────────────────────────


@pytest.mark.asyncio
async def test_llm_category_and_subtags_bound_end_to_end(db_session):
    record = _record(ai_enrichment={"category": "模型能力", "subtags": ["LLM", "RAG"]})
    source = _source(default_category=None)

    await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    types_names = {(t.type, t.name) for t in tags}
    assert ("category", "模型能力") in types_names
    assert ("subtag", "LLM") in types_names
    assert ("subtag", "RAG") in types_names


@pytest.mark.asyncio
async def test_llm_category_overrides_default_category(db_session):
    record = _record(ai_enrichment={"category": "研究论文"})
    source = _source(default_category="其它")

    await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    category_tags = [t for t in tags if t.type == "category"]
    assert len(category_tags) == 1
    assert category_tags[0].name == "研究论文"


@pytest.mark.asyncio
async def test_llm_invalid_category_falls_back_to_default(db_session):
    """An LLM suggestion outside the closed taxonomy set is not trusted —
    falls back to source.default_category same as if no suggestion existed."""
    record = _record(ai_enrichment={"category": "不存在的分类"})
    source = _source(default_category="其它")

    await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    category_tags = [t for t in tags if t.type == "category"]
    assert len(category_tags) == 1
    assert category_tags[0].name == "其它"


# ── Fallback path: enrichment disabled / didn't run / failed ───────────────


@pytest.mark.asyncio
async def test_no_enrichment_falls_back_to_default_category(db_session):
    """ai_enrichment is None (AI disabled, or enrichment step never ran)."""
    record = _record(ai_enrichment=None)
    source = _source(default_category="工程实践")

    await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    category_tags = [t for t in tags if t.type == "category"]
    assert len(category_tags) == 1
    assert category_tags[0].name == "工程实践"


@pytest.mark.asyncio
async def test_enrichment_error_falls_back_to_default_category(db_session):
    """Processor-level failure surfaces as {"error": ...} in ai_enrichment
    (see claude_processor/openai_processor) — must not be read as a category."""
    record = _record(ai_enrichment={"error": "LLM request timed out"})
    source = _source(default_category="行业资讯")

    await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    category_tags = [t for t in tags if t.type == "category"]
    assert len(category_tags) == 1
    assert category_tags[0].name == "行业资讯"


# ── default_category empty/invalid: no crash, no binding, warning logged ──


@pytest.mark.asyncio
async def test_no_suggestion_and_no_default_category_logs_warning_and_skips(db_session, caplog):
    record = _record(ai_enrichment=None)
    source = _source(default_category=None)

    with caplog.at_level(logging.WARNING, logger="backend.pipeline.classification"):
        await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    assert tags == []
    assert any("uncategorized" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_invalid_default_category_logs_warning_and_skips(db_session, caplog):
    """source.default_category itself is outside the closed taxonomy set —
    must not crash, must not bind an invalid category."""
    record = _record(ai_enrichment=None)
    source = _source(default_category="not-a-real-category")

    with caplog.at_level(logging.WARNING, logger="backend.pipeline.classification"):
        await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    assert tags == []
    assert any("invalid default_category" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_subtags_still_applied_when_no_category_resolved(db_session):
    """Locked behavior: even when category ends up unresolved (no LLM
    suggestion, no default_category), subtags found in ai_enrichment must
    still be bound — classification of subtags is independent of category
    resolution."""
    record = _record(ai_enrichment={"subtags": ["LLM"]})
    source = _source(default_category=None)

    await classification.classify_record(db_session, record, source)

    tags = await tag_service.get_tags(db_session, record.id)
    types_names = {(t.type, t.name) for t in tags}
    assert ("subtag", "LLM") in types_names
    assert not any(t.type == "category" for t in tags)


# ── Never raises ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_classify_record_never_raises_when_tag_service_blows_up(db_session, caplog):
    record = _record(ai_enrichment={"category": "模型能力"})
    source = _source(default_category=None)

    with patch.object(tag_service, "bind_category", new=AsyncMock(side_effect=RuntimeError("db down"))):
        with caplog.at_level(logging.WARNING, logger="backend.pipeline.classification"):
            # Must not raise.
            await classification.classify_record(db_session, record, source)

    assert any("failed, skipping" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_classify_records_processes_full_batch(db_session):
    records = [
        _record(ai_enrichment={"category": "模型能力"}),
        _record(ai_enrichment=None),
        _record(ai_enrichment={"category": "不存在", "subtags": ["Agents"]}),
    ]
    source = _source(default_category="其它")

    await classification.classify_records(db_session, records, source)

    for rec in records[:2]:
        tags = await tag_service.get_tags(db_session, rec.id)
        assert any(t.type == "category" for t in tags)

    tags_2 = await tag_service.get_tags(db_session, records[2].id)
    types_names = {(t.type, t.name) for t in tags_2}
    assert ("category", "其它") in types_names  # invalid LLM category -> fallback
    assert ("subtag", "Agents") in types_names
