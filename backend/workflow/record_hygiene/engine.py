"""In-process record hygiene profiles.

All identifiers, decisions, evidence, and metrics are derived from the input.
There is no clock, database, network, or process-global state in this module.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from backend.pipeline.normalizer import normalize_item


class RecordHygieneError(ValueError):
    """Base error for the public record-hygiene interface."""


class HygieneConfigError(RecordHygieneError):
    """The selected profile or its configuration is invalid."""


class HygieneInvariantError(RecordHygieneError):
    """Input violates an invariant required for deterministic processing."""


@dataclass(frozen=True, slots=True)
class HygieneResult:
    """Uniform result returned by every hygiene profile."""

    records: list[dict[str, Any]]
    rejected: list[dict[str, Any]]
    metrics: dict[str, Any]


_PROFILES = frozenset({"normalize", "dedupe", "accept", "standard.v1"})
_FIELD_ALIASES = {
    "title": "title",
    "source": "source_id",
    "sourceid": "source_id",
    "source_id": "source_id",
    "publishedat": "published_at",
    "published_at": "published_at",
    "published": "published_at",
    "url": "url",
    "content": "content",
    "author": "author",
}
_TIME_FIELDS = frozenset({"published_at"})
_RECORD_V1_FIELDS = frozenset({"title", "url", "content", "author", "published_at", "source_id"})
_ACCEPT_MODES = frozenset({"automatic_with_review", "manual_review", "automatic_strict"})


def execute_record_hygiene(
    profile: str,
    items: Sequence[Mapping[str, Any]],
    config: Mapping[str, Any] | None,
    context: Mapping[str, Any] | None,
) -> HygieneResult:
    """Execute one deterministic record-hygiene profile.

    ``standard.v1`` is exactly ``normalize -> dedupe -> accept`` with the same
    configuration and context passed to each stage.
    """

    if profile not in _PROFILES:
        raise HygieneConfigError(
            f"unsupported profile {profile!r}; expected one of {sorted(_PROFILES)}"
        )
    cfg = _mapping(config, "config", config_error=True)
    ctx = _mapping(context, "context", config_error=True)
    batch = _items(items)

    if profile == "normalize":
        return _normalize(batch, cfg, ctx)
    if profile == "dedupe":
        return _dedupe(batch, cfg, ctx)
    if profile == "accept":
        return _accept(batch, cfg, ctx)

    normalized = _normalize(batch, cfg, ctx)
    deduped = _dedupe(normalized.records, cfg, ctx)
    accepted = _accept(deduped.records, cfg, ctx)
    rejected = [*normalized.rejected, *deduped.rejected, *accepted.rejected]
    return HygieneResult(
        records=accepted.records,
        rejected=rejected,
        metrics={
            "profile": "standard.v1",
            "inputCount": len(batch),
            "recordCount": len(accepted.records),
            "rejectedCount": len(rejected),
            "stages": {
                "normalize": normalized.metrics,
                "dedupe": deduped.metrics,
                "accept": accepted.metrics,
            },
        },
    )


def _normalize(
    items: list[dict[str, Any]], config: dict[str, Any], context: dict[str, Any]
) -> HygieneResult:
    source_override = _optional_string(config.get("sourceId"), "sourceId")
    preserve_source_refs = _boolean(config.get("preserveSourceRefs", True), "preserveSourceRefs")
    language = _optional_string(config.get("language"), "language")
    records: list[dict[str, Any]] = []

    for index, item in enumerate(items):
        raw_value = item.get("raw", item)
        raw = _mapping(raw_value, f"items[{index}].raw")
        source_id = source_override or _source_id(item, raw)
        normalized, content_hash = normalize_item(raw, source_id)
        lineage = _lineage(item, index)
        lineage.append(_lineage_entry("normalize", index, context))
        candidate_id = _stable_id("candidate", content_hash, str(index))
        candidate: dict[str, Any] = {
            "schema": "recordCandidate.v1",
            "candidateId": candidate_id,
            "raw": deepcopy(raw),
            "normalizedData": normalized,
            "contentHash": content_hash,
            "quality": _quality(item, normalized),
            "lineage": lineage,
        }
        if language:
            candidate["normalization"] = {"language": language}
        if preserve_source_refs:
            source_refs = _source_refs(item, raw)
            if source_refs:
                candidate["sourceRefs"] = source_refs
        records.append(candidate)

    return HygieneResult(
        records=records,
        rejected=[],
        metrics={
            "profile": "normalize",
            "inputCount": len(items),
            "recordCount": len(records),
            "rejectedCount": 0,
            "normalizedCount": len(records),
        },
    )


def _dedupe(
    items: list[dict[str, Any]], config: dict[str, Any], context: dict[str, Any]
) -> HygieneResult:
    key_text = config.get("key", "title+source+publishedAt")
    if not isinstance(key_text, str) or not key_text.strip():
        raise HygieneConfigError("key must be a non-empty '+' separated string")
    fields = _dedupe_fields(key_text)
    window_hours, window_label = _dedupe_window(config)
    records: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    canonical: list[tuple[dict[str, Any], tuple[Any, ...], datetime | None, Any]] = []

    for index, item in enumerate(items):
        identity = tuple(_field_value(item, field) for field in fields if field not in _TIME_FIELDS)
        published_raw = _field_value(item, "published_at") if "published_at" in fields else None
        published_at = _parse_datetime(published_raw)
        winner = _find_duplicate(canonical, identity, published_at, published_raw, window_hours)
        evidence = {
            "type": "dedupe",
            "key": key_text,
            "fields": list(fields),
            "values": {field: _field_value(item, field) for field in fields},
            "window": window_label,
            "windowHours": window_hours,
        }
        updated = deepcopy(item)
        updated["lineage"] = [
            *_lineage(item, index),
            _lineage_entry("dedupe", index, context, decision="duplicate" if winner else "unique"),
        ]
        updated["evidence"] = [*_evidence(item, index), evidence]

        if winner is not None:
            duplicate_of = _record_identity(winner)
            updated["duplicateOf"] = duplicate_of
            updated["dedupe"] = {**evidence, "status": "duplicate", "duplicateOf": duplicate_of}
            updated["rejection"] = {"code": "duplicate", "duplicateOf": duplicate_of}
            rejected.append(updated)
            continue

        updated["dedupe"] = {**evidence, "status": "unique"}
        records.append(updated)
        canonical.append((updated, identity, published_at, published_raw))

    return HygieneResult(
        records=records,
        rejected=rejected,
        metrics={
            "profile": "dedupe",
            "inputCount": len(items),
            "recordCount": len(records),
            "rejectedCount": len(rejected),
            "uniqueCount": len(records),
            "duplicateCount": len(rejected),
            "key": key_text,
            "window": window_label,
            "windowHours": window_hours,
            "dedupeCoverage": {"scope": "batch", "priorSeenCount": 0},
        },
    )


def _accept(
    items: list[dict[str, Any]], config: dict[str, Any], context: dict[str, Any]
) -> HygieneResult:
    mode = _accept_mode(config.get("mode", "automatic_with_review"))
    schema = config.get("schema", "record.v1")
    if schema != "record.v1":
        raise HygieneConfigError("schema must be 'record.v1'")
    dedupe_required = _dedupe_required(config.get("dedupe", "required"))
    lineage_required = _boolean(config.get("lineageRequired", True), "lineageRequired")
    min_quality = _bounded_quality(config.get("minQuality", 0))
    records: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    reason_counts: dict[str, int] = {}
    review_count = 0
    reject_count = 0

    for index, item in enumerate(items):
        reasons: list[str] = []
        normalized = item.get("normalizedData")
        if not isinstance(normalized, Mapping) or not _RECORD_V1_FIELDS.issubset(normalized):
            reasons.append("schema_invalid")
        if dedupe_required and not _has_unique_dedupe_evidence(item):
            reasons.append("dedupe_required")
        if lineage_required and not _lineage(item, index):
            reasons.append("lineage_required")
        quality = _quality(item, normalized if isinstance(normalized, Mapping) else {})
        if quality < min_quality:
            reasons.append("quality_below_minimum")

        updated = deepcopy(item)
        if mode == "manual_review":
            reasons.append("manual_review_required")
            disposition = "review"
        elif reasons:
            disposition = "reject" if mode == "automatic_strict" else "review"
        else:
            disposition = "accept"
        decision = "accepted" if disposition == "accept" else disposition
        updated["lineage"] = [
            *_lineage(item, index),
            _lineage_entry("accept", index, context, decision=decision),
        ]
        if disposition != "accept":
            updated["disposition"] = disposition
            updated["rejection"] = {
                "code": (
                    "manual_review_required" if mode == "manual_review" else "acceptance_failed"
                ),
                "reasons": reasons,
                "disposition": disposition,
            }
            rejected.append(updated)
            if disposition == "review":
                review_count += 1
            else:
                reject_count += 1
            for reason in reasons:
                reason_counts[reason] = reason_counts.get(reason, 0) + 1
            continue

        content_hash = str(item.get("contentHash") or _stable_json_hash(normalized))
        updated.update(
            {
                "schema": "record.v1",
                "recordId": str(item.get("recordId") or _stable_id("record", content_hash)),
                "quality": quality,
                "status": "accepted",
            }
        )
        records.append(updated)

    return HygieneResult(
        records=records,
        rejected=rejected,
        metrics={
            "profile": "accept",
            "inputCount": len(items),
            "recordCount": len(records),
            "rejectedCount": len(rejected),
            "acceptedCount": len(records),
            "reviewCount": review_count,
            "rejectCount": reject_count,
            "rejectionReasons": reason_counts,
            "mode": mode,
            "schema": schema,
            "dedupeRequired": dedupe_required,
            "lineageRequired": lineage_required,
            "minQuality": min_quality,
        },
    )


def _items(items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    if isinstance(items, str | bytes) or not isinstance(items, Sequence):
        raise HygieneInvariantError("items must be a sequence of mappings")
    result: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise HygieneInvariantError(f"items[{index}] must be a mapping")
        result.append(deepcopy(dict(item)))
    return result


def _mapping(value: Any, name: str, *, config_error: bool = False) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        error = HygieneConfigError if config_error else HygieneInvariantError
        raise error(f"{name} must be a mapping")
    return dict(value)


def _dedupe_fields(key: str) -> tuple[str, ...]:
    fields: list[str] = []
    for token in key.split("+"):
        normalized = token.strip().replace("-", "_").lower()
        field = _FIELD_ALIASES.get(normalized)
        if field is None:
            raise HygieneConfigError(f"unsupported dedupe key field {token.strip()!r}")
        if field not in fields:
            fields.append(field)
    if not fields or all(field in _TIME_FIELDS for field in fields):
        raise HygieneConfigError("dedupe key must contain at least one identity field")
    return tuple(fields)


def _dedupe_window(config: Mapping[str, Any]) -> tuple[float, str]:
    """Resolve a window, with Studio's duration string taking precedence.

    ``window`` accepts a positive number followed by ``h`` (hours), ``d``
    (days), or ``m`` (minutes).  ``windowHours`` remains the numeric API for
    existing callers.  When both are present, ``window`` wins.
    """

    if "window" not in config:
        hours = _positive_number(config.get("windowHours", 24), "windowHours")
        return hours, f"{_compact_number(hours)}h"

    value = config["window"]
    if not isinstance(value, str):
        raise HygieneConfigError("window must be a duration string such as '24h'")
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([hHdDmM])\s*", value)
    if match is None:
        raise HygieneConfigError("window must use a positive Nh, Nd, or Nm duration")
    amount = float(match.group(1))
    if amount <= 0:
        raise HygieneConfigError("window must use a positive Nh, Nd, or Nm duration")
    unit = match.group(2).lower()
    multiplier = {"h": 1.0, "d": 24.0, "m": 1 / 60}[unit]
    hours = amount * multiplier
    return hours, f"{_compact_number(amount)}{unit}"


def _field_value(item: Mapping[str, Any], field: str) -> Any:
    normalized = item.get("normalizedData")
    if isinstance(normalized, Mapping) and field in normalized:
        return normalized[field]
    if field in item:
        return item[field]
    aliases = {
        "source_id": ("source", "sourceId"),
        "published_at": ("publishedAt", "published", "date", "timestamp"),
    }
    for alias in aliases.get(field, ()):
        if alias in item:
            return item[alias]
    raw = item.get("raw")
    if isinstance(raw, Mapping):
        if field in raw:
            return raw[field]
        for alias in aliases.get(field, ()):
            if alias in raw:
                return raw[alias]
    return None


def _find_duplicate(
    canonical: list[tuple[dict[str, Any], tuple[Any, ...], datetime | None, Any]],
    identity: tuple[Any, ...],
    published_at: datetime | None,
    published_raw: Any,
    window_hours: float,
) -> dict[str, Any] | None:
    max_seconds = window_hours * 3600
    for record, prior_identity, prior_time, prior_raw in canonical:
        if identity != prior_identity:
            continue
        if published_at is not None and prior_time is not None:
            if abs((published_at - prior_time).total_seconds()) <= max_seconds:
                return record
        elif published_raw == prior_raw:
            return record
    return None


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _lineage(item: Mapping[str, Any], index: int) -> list[dict[str, Any]]:
    value = item.get("lineage", [])
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(entry, Mapping) for entry in value):
        raise HygieneInvariantError(f"items[{index}].lineage must be a list of mappings")
    return [deepcopy(dict(entry)) for entry in value]


def _evidence(item: Mapping[str, Any], index: int) -> list[dict[str, Any]]:
    value = item.get("evidence", [])
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(entry, Mapping) for entry in value):
        raise HygieneInvariantError(f"items[{index}].evidence must be a list of mappings")
    return [deepcopy(dict(entry)) for entry in value]


def _lineage_entry(
    step: str, index: int, context: Mapping[str, Any], *, decision: str | None = None
) -> dict[str, Any]:
    entry: dict[str, Any] = {"step": step, "index": index}
    for source, target in (("runId", "runId"), ("nodeId", "nodeId")):
        value = context.get(source)
        if value is not None:
            entry[target] = str(value)
    if decision:
        entry["decision"] = decision
    return entry


def _source_id(item: Mapping[str, Any], raw: Mapping[str, Any]) -> str:
    for container in (item, raw):
        for key in ("source_id", "sourceId", "source"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _source_refs(item: Mapping[str, Any], raw: Mapping[str, Any]) -> list[Any]:
    for container in (item, raw):
        for key in ("sourceRefs", "source_refs", "_sourceRefs"):
            value = container.get(key)
            if isinstance(value, list):
                return deepcopy(value)
    return []


def _quality(item: Mapping[str, Any], normalized: Mapping[str, Any]) -> float:
    value = item.get("quality", normalized.get("quality", normalized.get("extra_quality", 0)))
    if isinstance(value, bool) or not isinstance(value, int | float):
        return 0.0
    return float(value)


def _has_unique_dedupe_evidence(item: Mapping[str, Any]) -> bool:
    dedupe = item.get("dedupe")
    return isinstance(dedupe, Mapping) and dedupe.get("status") == "unique"


def _record_identity(item: Mapping[str, Any]) -> str:
    for key in ("recordId", "candidateId", "contentHash"):
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return _stable_id("record", _stable_json_hash(item))


def _dedupe_required(value: Any) -> bool:
    if value in ("required", True):
        return True
    if value in ("advisory", "off", "optional", "disabled", False, None):
        return False
    raise HygieneConfigError(
        "dedupe must be required, advisory, off, optional, disabled, true, or false"
    )


def _accept_mode(value: Any) -> str:
    if not isinstance(value, str) or value not in _ACCEPT_MODES:
        raise HygieneConfigError(f"mode must be one of {sorted(_ACCEPT_MODES)}")
    return value


def _boolean(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise HygieneConfigError(f"{name} must be a boolean")
    return value


def _optional_string(value: Any, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise HygieneConfigError(f"{name} must be a string")
    return value.strip() or None


def _positive_number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        raise HygieneConfigError(f"{name} must be a positive number")
    return float(value)


def _compact_number(value: float) -> str:
    return str(int(value)) if value.is_integer() else format(value, "g")


def _bounded_quality(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise HygieneConfigError("minQuality must be a number between 0 and 1")
    result = float(value)
    if not 0 <= result <= 1:
        raise HygieneConfigError("minQuality must be a number between 0 and 1")
    return result


def _stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()[:24]
    return f"{prefix}-{digest}"


def _stable_json_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()
