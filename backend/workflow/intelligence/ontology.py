"""Grounded deterministic ontology extraction."""

from __future__ import annotations

from typing import Any

from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    OntologyArtifact,
    ResearchArtifact,
    deterministic_id,
)

ALGORITHM_VERSION = "native-ontology-v1"
MAX_ENTITIES = 200
MAX_RELATIONS = 1_000


def build_ontology_artifact(
    *, session_id: str, research: ResearchArtifact, seed: int = 0
) -> OntologyArtifact:
    if research.session_id != session_id:
        raise ValueError("cross_session_research_reference")
    evidence = research.payload.get("evidence")
    report = research.payload.get("report")
    if not isinstance(evidence, list) or not isinstance(report, dict):
        raise ValueError("malformed_research_artifact")
    evidence_ids = sorted(
        item["evidenceId"]
        for item in evidence
        if isinstance(item, dict) and isinstance(item.get("evidenceId"), str)
    )
    if len(evidence_ids) != len(evidence):
        raise ValueError("malformed_evidence_reference")

    entities = _entities(report)[:MAX_ENTITIES]
    relations: list[dict[str, Any]] = []
    topic_ids = [entity["entityId"] for entity in entities if entity["type"] == "topic"]
    platform_ids = [
        entity["entityId"] for entity in entities if entity["type"] == "platform"
    ]
    if evidence_ids:
        for topic_id in topic_ids:
            for platform_id in platform_ids:
                grounding = evidence_ids
                relation = {
                    "type": "observed_on",
                    "sourceEntityId": topic_id,
                    "targetEntityId": platform_id,
                    "groundingEvidenceIds": grounding,
                }
                relations.append(
                    {
                        "relationId": deterministic_id("relation", relation),
                        **relation,
                    }
                )
                if len(relations) >= MAX_RELATIONS:
                    break
            if len(relations) >= MAX_RELATIONS:
                break
    relations.sort(key=lambda item: item["relationId"])
    payload = {
        "schema": "intelligence.ontology.v1",
        "simulated": False,
        "researchArtifactId": research.artifact_id,
        "entities": entities,
        "relations": relations,
        "limits": {"maxEntities": MAX_ENTITIES, "maxRelations": MAX_RELATIONS},
    }
    return OntologyArtifact(
        artifact_id=deterministic_id(
            "ontology", {"algorithm": ALGORITHM_VERSION, "seed": seed, "payload": payload}
        ),
        session_id=session_id,
        payload=payload,
        grounding_artifact_ids=[research.artifact_id],
        simulated=False,
        provenance=ArtifactProvenance(
            source="opencli-native",
            evidence_artifact_ids=[research.artifact_id],
        ),
        algorithm_version=ALGORITHM_VERSION,
        seed=seed,
    )


def _entities(report: dict[str, Any]) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    for topic in report.get("topics", []):
        label = str(topic.get("label", "")).strip()
        if label:
            value = {"type": "topic", "label": label}
            entities.append(
                {
                    "entityId": deterministic_id("entity", value),
                    **value,
                    "attributes": {
                        "mentionCount": int(topic.get("mentionCount", 0)),
                        "platformCount": int(topic.get("platformCount", 0)),
                    },
                }
            )
    for platform in report.get("platforms", []):
        label = str(platform.get("platform", "")).strip()
        if label:
            value = {"type": "platform", "label": label}
            entities.append(
                {
                    "entityId": deterministic_id("entity", value),
                    **value,
                    "attributes": {
                        "itemCount": int(platform.get("itemCount", 0)),
                        "engagementScore": float(platform.get("engagementScore", 0)),
                    },
                }
            )
    entities.sort(key=lambda item: item["entityId"])
    return entities


__all__ = ["ALGORITHM_VERSION", "MAX_ENTITIES", "MAX_RELATIONS", "build_ontology_artifact"]
