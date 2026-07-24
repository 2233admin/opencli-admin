"""Evidence-grounded deterministic graph construction."""

from __future__ import annotations

from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    GraphArtifact,
    OntologyArtifact,
    ResearchArtifact,
    deterministic_id,
)

ALGORITHM_VERSION = "native-graph-v1"
MAX_NODES = 200
MAX_EDGES = 1_000


def build_graph_artifact(
    *,
    session_id: str,
    research: ResearchArtifact,
    ontology: OntologyArtifact,
    seed: int = 0,
) -> GraphArtifact:
    if research.session_id != session_id or ontology.session_id != session_id:
        raise ValueError("cross_session_artifact_reference")
    if ontology.payload.get("researchArtifactId") != research.artifact_id:
        raise ValueError("ungrounded_ontology_reference")
    evidence_ids = {
        item.get("evidenceId")
        for item in research.payload.get("evidence", [])
        if isinstance(item, dict)
    }
    nodes = [
        {
            "nodeId": deterministic_id("node", entity["entityId"]),
            "entityId": entity["entityId"],
            "type": entity["type"],
            "label": entity["label"],
            "attributes": entity.get("attributes", {}),
            "artifactReferences": [ontology.artifact_id],
            "simulated": False,
        }
        for entity in ontology.payload.get("entities", [])
    ][:MAX_NODES]
    node_by_entity = {node["entityId"]: node["nodeId"] for node in nodes}
    edges = []
    for relation in ontology.payload.get("relations", []):
        grounding = relation.get("groundingEvidenceIds")
        if (
            not isinstance(grounding, list)
            or not grounding
            or any(item not in evidence_ids for item in grounding)
        ):
            raise ValueError("ungrounded_relation_reference")
        source = node_by_entity.get(relation.get("sourceEntityId"))
        target = node_by_entity.get(relation.get("targetEntityId"))
        if source is None or target is None:
            raise ValueError("relation_entity_not_found")
        value = {
            "type": relation["type"],
            "sourceNodeId": source,
            "targetNodeId": target,
            "groundingEvidenceIds": sorted(grounding),
            "artifactReferences": [research.artifact_id, ontology.artifact_id],
            "simulated": False,
        }
        edges.append({"edgeId": deterministic_id("edge", value), **value})
        if len(edges) >= MAX_EDGES:
            break
    nodes.sort(key=lambda item: item["nodeId"])
    edges.sort(key=lambda item: item["edgeId"])
    payload = {
        "schema": "intelligence.graph.v1",
        "simulated": False,
        "researchArtifactId": research.artifact_id,
        "ontologyArtifactId": ontology.artifact_id,
        "nodes": nodes,
        "edges": edges,
        "memoryUpdates": [],
        "limits": {"maxNodes": MAX_NODES, "maxEdges": MAX_EDGES},
    }
    return GraphArtifact(
        artifact_id=deterministic_id(
            "graph", {"algorithm": ALGORITHM_VERSION, "seed": seed, "payload": payload}
        ),
        session_id=session_id,
        payload=payload,
        grounding_artifact_ids=[research.artifact_id, ontology.artifact_id],
        simulated=False,
        provenance=ArtifactProvenance(
            source="opencli-native",
            evidence_artifact_ids=[research.artifact_id, ontology.artifact_id],
        ),
        algorithm_version=ALGORITHM_VERSION,
        seed=seed,
    )


__all__ = ["ALGORITHM_VERSION", "MAX_EDGES", "MAX_NODES", "build_graph_artifact"]
