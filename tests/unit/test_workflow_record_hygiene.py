"""Contract tests for the unified record-hygiene interface."""

from copy import deepcopy

import pytest

from backend.workflow.record_hygiene import (
    HygieneConfigError,
    HygieneInvariantError,
    execute_record_hygiene,
)

CONTEXT = {"runId": "run-1", "nodeId": "hygiene-1"}
RAW_ITEMS = [
    {
        "headline": "Same story",
        "link": "https://example.com/a",
        "description": "First",
        "source": "bbc",
        "published": "2026-07-22T00:00:00Z",
        "quality": 0.9,
        "sourceRefs": ["bbc:1"],
    },
    {
        "title": "Same story",
        "url": "https://example.com/b",
        "content": "Second",
        "source_id": "bbc",
        "published_at": "2026-07-22T12:00:00+00:00",
        "quality": 0.8,
    },
    {
        "title": "Same story",
        "url": "https://example.com/c",
        "content": "Later",
        "source_id": "bbc",
        "published_at": "2026-07-24T00:01:00Z",
        "quality": 0.7,
    },
]


def test_normalize_profile_reuses_pipeline_semantics_and_preserves_refs():
    result = execute_record_hygiene(
        "normalize",
        RAW_ITEMS[:1],
        {"language": "zh-CN", "preserveSourceRefs": True},
        CONTEXT,
    )

    candidate = result.records[0]
    assert candidate["normalizedData"] == {
        "title": "Same story",
        "url": "https://example.com/a",
        "content": "First",
        "author": "",
        "published_at": "2026-07-22T00:00:00Z",
        "source_id": "bbc",
        "extra_source": "bbc",
        "extra_quality": 0.9,
        "extra_sourceRefs": ["bbc:1"],
    }
    assert candidate["quality"] == 0.9
    assert candidate["sourceRefs"] == ["bbc:1"]
    assert candidate["lineage"][-1] == {
        "step": "normalize",
        "index": 0,
        "runId": "run-1",
        "nodeId": "hygiene-1",
    }
    assert result.metrics["normalizedCount"] == 1


def test_dedupe_profile_parses_compound_key_and_uses_24_hour_window():
    candidates = execute_record_hygiene("normalize", RAW_ITEMS, {}, CONTEXT).records
    result = execute_record_hygiene(
        "dedupe", candidates, {"key": "title+source+publishedAt", "windowHours": 24}, CONTEXT
    )

    assert len(result.records) == 2
    assert len(result.rejected) == 1
    duplicate = result.rejected[0]
    assert duplicate["duplicateOf"] == result.records[0]["candidateId"]
    assert duplicate["evidence"][-1]["type"] == "dedupe"
    assert duplicate["dedupe"]["fields"] == ["title", "source_id", "published_at"]
    assert duplicate["lineage"][-1]["decision"] == "duplicate"
    assert result.metrics["duplicateCount"] == 1
    assert result.metrics["dedupeCoverage"] == {"scope": "batch", "priorSeenCount": 0}


def test_studio_window_string_overrides_numeric_window_and_changes_decision():
    items = deepcopy(RAW_ITEMS[:2])
    items[1]["published_at"] = "2026-07-22T13:00:00Z"
    candidates = execute_record_hygiene("normalize", items, {}, CONTEXT).records

    default_result = execute_record_hygiene("dedupe", candidates, {}, CONTEXT)
    studio_result = execute_record_hygiene(
        "dedupe",
        candidates,
        {"window": "12h", "windowHours": 24},
        CONTEXT,
    )

    assert default_result.metrics["window"] == "24h"
    assert default_result.metrics["duplicateCount"] == 1
    assert studio_result.metrics["window"] == "12h"
    assert studio_result.metrics["windowHours"] == 12
    assert studio_result.metrics["duplicateCount"] == 0
    assert len(studio_result.records) == 2


def test_accept_profile_enforces_dedupe_lineage_quality_and_record_schema():
    base = execute_record_hygiene("normalize", RAW_ITEMS[:1], {}, CONTEXT).records[0]
    unique = execute_record_hygiene("dedupe", [base], {}, CONTEXT).records[0]
    missing_dedupe = deepcopy(base)
    missing_lineage = deepcopy(unique)
    missing_lineage["lineage"] = []
    low_quality = deepcopy(unique)
    low_quality["quality"] = 0.2
    invalid_schema = deepcopy(unique)
    invalid_schema["normalizedData"].pop("title")

    result = execute_record_hygiene(
        "accept",
        [unique, missing_dedupe, missing_lineage, low_quality, invalid_schema],
        {"dedupe": "required", "lineageRequired": True, "minQuality": 0.5, "schema": "record.v1"},
        CONTEXT,
    )

    assert len(result.records) == 1
    assert result.records[0]["schema"] == "record.v1"
    reasons = [item["rejection"]["reasons"] for item in result.rejected]
    assert ["dedupe_required"] in reasons
    assert ["lineage_required"] in reasons
    assert ["quality_below_minimum"] in reasons
    assert ["schema_invalid"] in reasons
    assert result.metrics["rejectionReasons"] == {
        "dedupe_required": 1,
        "lineage_required": 1,
        "quality_below_minimum": 1,
        "schema_invalid": 1,
    }
    assert result.metrics["mode"] == "automatic_with_review"
    assert result.metrics["reviewCount"] == 4
    assert result.metrics["rejectCount"] == 0
    assert {item["disposition"] for item in result.rejected} == {"review"}


def test_accept_modes_route_hard_failures_and_manual_review_explicitly():
    candidate = execute_record_hygiene("normalize", RAW_ITEMS[:1], {}, CONTEXT).records[0]
    unique = execute_record_hygiene("dedupe", [candidate], {}, CONTEXT).records[0]
    failing = deepcopy(unique)
    failing["lineage"] = []

    strict = execute_record_hygiene("accept", [failing], {"mode": "automatic_strict"}, CONTEXT)
    manual = execute_record_hygiene("accept", [unique], {"mode": "manual_review"}, CONTEXT)
    automatic = execute_record_hygiene(
        "accept", [unique], {"mode": "automatic_with_review"}, CONTEXT
    )

    assert strict.records == []
    assert strict.rejected[0]["disposition"] == "reject"
    assert strict.metrics["reviewCount"] == 0
    assert strict.metrics["rejectCount"] == 1
    assert manual.records == []
    assert manual.rejected[0]["disposition"] == "review"
    assert manual.rejected[0]["rejection"]["reasons"] == ["manual_review_required"]
    assert manual.metrics["reviewCount"] == 1
    assert automatic.records[0]["status"] == "accepted"
    assert automatic.metrics["reviewCount"] == 0


@pytest.mark.parametrize("dedupe_policy", ["advisory", "off", "optional", "disabled", False, None])
def test_accept_treats_supported_non_required_dedupe_policies_as_not_required(
    dedupe_policy: str | bool | None,
):
    candidate = execute_record_hygiene("normalize", RAW_ITEMS[:1], {}, CONTEXT).records[0]

    result = execute_record_hygiene(
        "accept",
        [candidate],
        {"dedupe": dedupe_policy},
        CONTEXT,
    )

    assert len(result.records) == 1
    assert result.rejected == []
    assert result.metrics["dedupeRequired"] is False


def test_standard_profile_is_explicit_normalize_dedupe_accept_composition():
    config = {
        "key": "title+source+publishedAt",
        "windowHours": 24,
        "dedupe": "required",
        "lineageRequired": True,
        "minQuality": 0.5,
    }
    standard = execute_record_hygiene("standard.v1", RAW_ITEMS, config, CONTEXT)
    normalized = execute_record_hygiene("normalize", RAW_ITEMS, config, CONTEXT)
    deduped = execute_record_hygiene("dedupe", normalized.records, config, CONTEXT)
    accepted = execute_record_hygiene("accept", deduped.records, config, CONTEXT)

    assert standard.records == accepted.records
    assert standard.rejected == [*normalized.rejected, *deduped.rejected, *accepted.rejected]
    assert standard.metrics["stages"]["dedupe"] == deduped.metrics


@pytest.mark.parametrize("profile", ["normalize", "dedupe", "accept", "standard.v1"])
def test_every_profile_has_uniform_empty_result(profile: str):
    result = execute_record_hygiene(profile, [], {}, CONTEXT)
    assert result.records == []
    assert result.rejected == []
    assert result.metrics["inputCount"] == 0
    assert result.metrics["recordCount"] == 0


def test_execution_is_deterministic_and_does_not_mutate_inputs():
    original = deepcopy(RAW_ITEMS)
    first = execute_record_hygiene("standard.v1", RAW_ITEMS, {"minQuality": 0}, CONTEXT)
    second = execute_record_hygiene("standard.v1", RAW_ITEMS, {"minQuality": 0}, CONTEXT)

    assert first == second
    assert RAW_ITEMS == original


def test_configuration_and_invariant_errors_are_explicit():
    with pytest.raises(HygieneConfigError, match="unsupported profile"):
        execute_record_hygiene("unknown", [], {}, CONTEXT)
    with pytest.raises(HygieneConfigError, match="unsupported dedupe key field"):
        execute_record_hygiene("dedupe", [], {"key": "title+arbitrary"}, CONTEXT)
    with pytest.raises(HygieneConfigError, match="schema must"):
        execute_record_hygiene("accept", [], {"schema": "record.v2"}, CONTEXT)
    with pytest.raises(HygieneConfigError, match="mode must be one of"):
        execute_record_hygiene("accept", [], {"mode": "sometimes"}, CONTEXT)
    with pytest.raises(HygieneConfigError, match="positive Nh, Nd, or Nm"):
        execute_record_hygiene("dedupe", [], {"window": "tomorrow"}, CONTEXT)
    with pytest.raises(HygieneInvariantError, match=r"items\[0\]"):
        execute_record_hygiene("normalize", ["not-a-record"], {}, CONTEXT)  # type: ignore[list-item]
