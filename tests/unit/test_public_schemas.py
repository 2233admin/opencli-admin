"""Unit tests for backend/api/public/schemas.py's whitelist mapper (PR-E).

Exercises `to_public_record_read` directly against a minimal fake record
object (no DB needed) to pin down the field-by-field mapping and prove it
never reads raw_data/source_id/task_id.
"""

from backend.api.public.schemas import PublicRecordRead, to_public_record_read


class _FakeRecord:
    """Minimal stand-in for CollectedRecord. Carries the fields a real row
    would have (including ones that must never leak) so the assertions can
    prove the mapper genuinely ignores them, not just that they're absent
    because this fixture omitted them."""

    def __init__(self, *, id, normalized_data, ai_enrichment=None):
        self.id = id
        self.normalized_data = normalized_data
        self.ai_enrichment = ai_enrichment
        self.raw_data = {"leaked": "should never appear in PublicRecordRead"}
        self.source_id = "internal-source-id"
        self.task_id = "internal-task-id"


def test_maps_only_whitelisted_fields():
    record = _FakeRecord(
        id="rec-1",
        normalized_data={
            "title": "Hello",
            "url": "https://ex.com",
            "content": "body text",
            "published_at": "2026-01-01T00:00:00Z",
        },
    )

    result = to_public_record_read(
        record, source_name="Some Source", category="模型能力", subtags=["a", "b"]
    )

    assert isinstance(result, PublicRecordRead)
    dumped = result.model_dump()
    assert set(dumped.keys()) == {
        "id", "title", "url", "summary", "source_name", "published_at", "category", "subtags",
    }
    assert dumped["id"] == "rec-1"
    assert dumped["title"] == "Hello"
    assert dumped["url"] == "https://ex.com"
    assert dumped["summary"] == "body text"  # falls back to normalized content
    assert dumped["source_name"] == "Some Source"
    assert dumped["published_at"] == "2026-01-01T00:00:00Z"
    assert dumped["category"] == "模型能力"
    assert dumped["subtags"] == ["a", "b"]
    assert "raw_data" not in dumped
    assert "source_id" not in dumped
    assert "task_id" not in dumped


def test_prefers_llm_summary_over_normalized_content():
    record = _FakeRecord(
        id="rec-2",
        normalized_data={"title": "T", "url": "https://ex.com", "content": "long raw body"},
        ai_enrichment={"summary": "a concise LLM summary"},
    )

    result = to_public_record_read(record, source_name="S", category=None, subtags=[])

    assert result.summary == "a concise LLM summary"


def test_malformed_ai_enrichment_falls_back_without_raising():
    record = _FakeRecord(
        id="rec-3",
        normalized_data={"title": "T", "url": "https://ex.com", "content": "fallback content"},
        ai_enrichment="not-a-dict",
    )

    result = to_public_record_read(record, source_name="S", category=None, subtags=[])

    assert result.summary == "fallback content"


def test_missing_normalized_fields_default_to_empty_strings_not_errors():
    record = _FakeRecord(id="rec-4", normalized_data={})

    result = to_public_record_read(record, source_name="S", category=None, subtags=[])

    assert result.title == ""
    assert result.url == ""
    assert result.summary == ""
    assert result.published_at is None
    assert result.category is None
    assert result.subtags == []
