"""Deterministic personas grounded in native research, ontology, and graph."""

from __future__ import annotations

from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    GraphArtifact,
    OntologyArtifact,
    PersonaArtifact,
    ResearchArtifact,
    deterministic_id,
)

ALGORITHM_VERSION = "native-personas-v1"
MAX_PERSONAS = 50


def build_persona_artifact(
    *,
    session_id: str,
    research: ResearchArtifact,
    ontology: OntologyArtifact,
    graph: GraphArtifact,
    count: int = 5,
    seed: int = 0,
) -> PersonaArtifact:
    if any(
        artifact.session_id != session_id for artifact in (research, ontology, graph)
    ):
        raise ValueError("cross_session_artifact_reference")
    if graph.payload.get("researchArtifactId") != research.artifact_id:
        raise ValueError("ungrounded_graph_research_reference")
    if graph.payload.get("ontologyArtifactId") != ontology.artifact_id:
        raise ValueError("ungrounded_graph_ontology_reference")
    if isinstance(count, bool) or not 1 <= count <= MAX_PERSONAS:
        raise ValueError("persona_count_out_of_bounds")

    candidates = [
        node for node in graph.payload.get("nodes", []) if node.get("type") == "topic"
    ] or list(graph.payload.get("nodes", []))
    personas = []
    for index, node in enumerate(candidates[:count]):
        value = {
            "index": index,
            "nodeId": node["nodeId"],
            "seed": seed,
            "researchArtifactId": research.artifact_id,
            "ontologyArtifactId": ontology.artifact_id,
            "graphArtifactId": graph.artifact_id,
        }
        personas.append(
            {
                "personaId": deterministic_id("persona", value),
                "name": f"{node['label']} observer",
                "role": f"{node['type']}_analyst",
                "stance": "evidence-seeking",
                "groundingNodeIds": [node["nodeId"]],
                "groundingArtifactIds": [
                    research.artifact_id,
                    ontology.artifact_id,
                    graph.artifact_id,
                ],
                "simulated": True,
            }
        )
    personas.sort(key=lambda item: item["personaId"])
    payload = {
        "schema": "intelligence.personas.v1",
        "simulated": True,
        "researchArtifactId": research.artifact_id,
        "ontologyArtifactId": ontology.artifact_id,
        "graphArtifactId": graph.artifact_id,
        "personas": personas,
        "requestedCount": count,
        "limits": {"maxPersonas": MAX_PERSONAS},
    }
    return PersonaArtifact(
        artifact_id=deterministic_id(
            "personas", {"algorithm": ALGORITHM_VERSION, "seed": seed, "payload": payload}
        ),
        session_id=session_id,
        payload=payload,
        grounding_artifact_ids=[
            research.artifact_id,
            ontology.artifact_id,
            graph.artifact_id,
        ],
        simulated=True,
        provenance=ArtifactProvenance(
            source="opencli-native-deterministic",
            evidence_artifact_ids=[
                research.artifact_id,
                ontology.artifact_id,
                graph.artifact_id,
            ],
        ),
        algorithm_version=ALGORITHM_VERSION,
        seed=seed,
    )


__all__ = ["ALGORITHM_VERSION", "MAX_PERSONAS", "build_persona_artifact"]
