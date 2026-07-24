import pytest

from backend.workflow.intelligence.interviews import (
    MAX_INTERVIEW_BATCH,
    _build_interview,
    _planned_personas,
)
from backend.workflow.intelligence.reports import (
    MAX_REPORT_SECTIONS,
    _answer,
    _build_report,
    _build_section,
    _section_plan,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    GraphArtifact,
    PersonaArtifact,
    SimulationArtifact,
    canonical_hash,
)


def _artifacts(persona_count: int = 2):
    graph = GraphArtifact(
        artifact_id="graph-fixture",
        session_id="reports-unit",
        payload={
            "schema": "intelligence.graph.v1",
            "simulated": False,
            "nodes": [
                {"nodeId": "b", "label": "Beta"},
                {"nodeId": "a", "label": "Alpha"},
            ],
        },
        simulated=False,
        provenance=ArtifactProvenance(source="test"),
        algorithm_version="test",
        seed=0,
    )
    personas = PersonaArtifact(
        artifact_id="personas-fixture",
        session_id="reports-unit",
        payload={
            "schema": "intelligence.personas.v1",
            "simulated": True,
            "graphArtifactId": graph.artifact_id,
            "personas": [
                {
                    "personaId": f"persona-{index:03d}",
                    "name": f"Persona {index}",
                    "role": "observer",
                    "simulated": True,
                }
                for index in range(persona_count)
            ],
        },
        grounding_artifact_ids=[graph.artifact_id],
        simulated=True,
        provenance=ArtifactProvenance(
            source="test", evidence_artifact_ids=[graph.artifact_id]
        ),
        algorithm_version="test",
        seed=0,
    )
    simulation = SimulationArtifact(
        artifact_id="simulation-fixture",
        session_id="reports-unit",
        payload={
            "schema": "intelligence.simulation.v1",
            "simulated": True,
            "personaArtifactId": personas.artifact_id,
            "actions": [
                {
                    "round": 1,
                    "personaId": "persona-000",
                    "action": "observe",
                    "stance": 0.1,
                }
            ],
            "stats": {
                "actionCount": 1,
                "agentCount": persona_count,
                "supportRatio": 0.0,
                "opposeRatio": 0.0,
                "neutralRatio": 1.0,
                "polarization": 0.1,
                "dominantAction": "observe",
            },
            "roundsCompleted": 1,
        },
        grounding_artifact_ids=[personas.artifact_id, graph.artifact_id],
        simulated=True,
        provenance=ArtifactProvenance(
            source="test",
            evidence_artifact_ids=[personas.artifact_id, graph.artifact_id],
        ),
        algorithm_version="test",
        seed=0,
    )
    return personas, graph, simulation


def test_interview_batch_bounds_and_canonical_persona_order():
    personas, _, _ = _artifacts(MAX_INTERVIEW_BATCH)
    reversed_ids = [
        item["personaId"] for item in reversed(personas.payload["personas"])
    ]
    assert _planned_personas(personas, reversed_ids) == sorted(reversed_ids)
    with pytest.raises(ValueError, match="interview_batch_size_out_of_bounds"):
        _planned_personas(personas, [])
    oversized, _, _ = _artifacts(MAX_INTERVIEW_BATCH + 1)
    with pytest.raises(ValueError, match="interview_batch_size_out_of_bounds"):
        _planned_personas(oversized, None)


def test_report_section_bounds_zero_max_and_max_plus_one():
    assert len(_section_plan([f"section-{index}" for index in range(MAX_REPORT_SECTIONS)])) == (
        MAX_REPORT_SECTIONS
    )
    with pytest.raises(ValueError, match="report_section_count_out_of_bounds"):
        _section_plan([])
    with pytest.raises(ValueError, match="report_section_count_out_of_bounds"):
        _section_plan(
            [f"section-{index}" for index in range(MAX_REPORT_SECTIONS + 1)]
        )


def test_interview_report_and_answer_hashes_are_stable():
    personas, graph, simulation = _artifacts()
    interview = _build_interview(
        session_id=personas.session_id,
        personas=personas,
        graph=graph,
        simulation=simulation,
        persona_id="persona-000",
        question="What changed?",
        history=[],
        seed=7,
        sequence=1,
        operation_id="interview-operation",
        batch_size=1,
    )
    planned = ["executive_summary", "interviews", "conclusions"]
    sections = [
        _build_section(
            name=name,
            personas=personas,
            graph=graph,
            simulation=simulation,
            interviews=[interview],
        )
        for name in planned
    ]
    report = _build_report(
        session_id=personas.session_id,
        personas=personas,
        graph=graph,
        simulation=simulation,
        interviews=[interview],
        manifest={
            "planned": planned,
            "completed": planned,
            "sections": sections,
            "seed": 11,
        },
        operation_id="report-operation",
    )
    answer = _answer(
        session_id=personas.session_id,
        report=report,
        question="What is the conclusion?",
        seed=13,
    )
    repeated = _answer(
        session_id=personas.session_id,
        report=report,
        question="What is the conclusion?",
        seed=13,
    )
    assert canonical_hash(answer.model_dump(mode="json")) == canonical_hash(
        repeated.model_dump(mode="json")
    )
    assert report.artifact_id in answer.grounding_artifact_ids
    assert graph.artifact_id in report.grounding_artifact_ids
