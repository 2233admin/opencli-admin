"""Pure deterministic research artifact construction."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    ResearchArtifact,
    canonical_hash,
    deterministic_id,
)
from backend.workflow.situation_awareness import execute_situation_awareness

ALGORITHM_VERSION = "native-research-v1"
MAX_EVIDENCE_ITEMS = 50


def build_research_artifact(
    *,
    session_id: str,
    input_items: list[dict[str, Any]],
    params: dict[str, Any] | None = None,
    seed: int = 0,
) -> ResearchArtifact:
    config = dict(params or {})
    config["provider"] = "opencli-native"
    if "now" not in config:
        config["now"] = _deterministic_now(input_items)
    config["topK"] = min(_bounded_count(config.get("topK"), 10), MAX_EVIDENCE_ITEMS)

    report = execute_situation_awareness(input_items, config)
    lineage_by_identity = {
        _evidence_lineage_key(item): _workflow_lineage(item)
        for item in input_items
    }
    evidence = [
        _evidence_record(
            item,
            lineage_by_identity.get(_evidence_lineage_key(item), []),
        )
        for item in report["topItems"]
    ]
    evidence.sort(key=lambda item: item["evidenceId"])
    ontology_seed = {
        "topics": sorted(
            report["topics"],
            key=lambda item: (-item["mentionCount"], item["label"].casefold()),
        ),
        "platforms": sorted(
            report["platforms"],
            key=lambda item: (-item["itemCount"], item["platform"]),
        ),
        "signalTypes": sorted({signal["type"] for signal in report["signals"]}),
        "evidenceIds": [item["evidenceId"] for item in evidence],
    }
    payload = {
        "schema": "intelligence.research.v1",
        "simulated": False,
        "report": report,
        "evidence": evidence,
        "inputLineage": sorted(
            [
                {
                    "evidenceId": item["evidenceId"],
                    "workflowLineage": item["workflowLineage"],
                }
                for item in evidence
                if item["workflowLineage"]
            ],
            key=lambda item: item["evidenceId"],
        ),
        "ontologySeed": ontology_seed,
        "limits": {"maxEvidenceItems": MAX_EVIDENCE_ITEMS},
    }
    return ResearchArtifact(
        artifact_id=deterministic_id(
            "research", {"algorithm": ALGORITHM_VERSION, "seed": seed, "payload": payload}
        ),
        session_id=session_id,
        payload=payload,
        simulated=False,
        provenance=ArtifactProvenance(
            source="opencli-native",
            collected_at=datetime.fromisoformat(report["generatedAt"]),
        ),
        algorithm_version=ALGORITHM_VERSION,
        seed=seed,
    )


def _evidence_identity(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "url": item.get("url") or "",
        "title": item.get("title") or "",
        "platform": item.get("platform") or "unknown",
        "publishedAt": item.get("publishedAt") or item.get("published_at"),
    }


def _workflow_lineage(item: dict[str, Any]) -> list[dict[str, Any]]:
    value = item.get("workflowLineage")
    if not isinstance(value, list):
        return []
    return [dict(entry) for entry in value if isinstance(entry, dict)]


def _evidence_lineage_key(item: dict[str, Any]) -> str:
    return canonical_hash(
        {
            "url": item.get("url") or "",
            "title": item.get("title") or "",
        }
    )


def _evidence_record(
    item: dict[str, Any],
    workflow_lineage: list[dict[str, Any]],
) -> dict[str, Any]:
    identity = _evidence_identity(item)
    return {
        "evidenceId": deterministic_id("evidence", identity),
        **identity,
        "timestampConfidence": "exact" if item.get("publishedAt") else "unknown",
        "freshness": item.get("freshness"),
        "engagementScore": item.get("engagementScore", 0),
        "author": item.get("author") or "",
        "contentHash": canonical_hash(identity),
        "provenance": {"source": "workflow_input", "simulated": False},
        "workflowLineage": workflow_lineage,
    }


def _deterministic_now(items: list[dict[str, Any]]) -> str:
    timestamps: list[datetime] = []
    keys = (
        "published_at",
        "publishedAt",
        "create_time",
        "createTime",
        "created_at",
        "createdAt",
        "timestamp",
        "date",
        "time",
    )
    for wrapped in items:
        candidates = [wrapped]
        for container in ("normalizedData", "raw"):
            value = wrapped.get(container)
            if isinstance(value, dict):
                candidates.append(value)
        for item in candidates:
            for key in keys:
                parsed = _parse_utc(item.get(key))
                if parsed is not None:
                    timestamps.append(parsed)
    return (max(timestamps) if timestamps else datetime(1970, 1, 1, tzinfo=UTC)).isoformat()


def _parse_utc(value: object) -> datetime | None:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        if isinstance(value, int | float):
            seconds = float(value)
            if seconds > 10_000_000_000:
                seconds /= 1000
            return datetime.fromtimestamp(seconds, tz=UTC)
        if isinstance(value, str):
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
    except (OSError, OverflowError, ValueError):
        return None
    return None


def _bounded_count(value: object, default: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, MAX_EVIDENCE_ITEMS))


__all__ = ["ALGORITHM_VERSION", "MAX_EVIDENCE_ITEMS", "build_research_artifact"]
