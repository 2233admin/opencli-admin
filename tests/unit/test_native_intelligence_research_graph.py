import json
import os
import subprocess
import sys
from itertools import permutations

import pytest

from backend.workflow.intelligence.graph import build_graph_artifact
from backend.workflow.intelligence.ontology import build_ontology_artifact
from backend.workflow.intelligence.personas import (
    MAX_PERSONAS,
    build_persona_artifact,
)
from backend.workflow.intelligence.research import build_research_artifact
from backend.workflow.native_intelligence_contracts import canonical_json

FIXTURE = [
    {
        "title": "AI agents accelerate #agents",
        "url": "https://example.test/a?utm_source=test",
        "source_id": "twitter",
        "published_at": "2026-07-20T12:00:00Z",
        "likes": 12,
    },
    {
        "title": "duplicate",
        "url": "https://example.test/a",
        "source_id": "twitter",
        "published_at": "2026-07-20T12:00:00Z",
        "likes": 1,
    },
    {
        "title": "malformed timestamp",
        "url": "https://example.test/b",
        "source_id": "bilibili",
        "published_at": "not-a-date",
    },
    {
        "title": "future",
        "url": "https://example.test/future",
        "source_id": "bilibili",
        "published_at": "2026-08-20T12:00:00Z",
    },
]
PARAMS = {
    "now": "2026-07-21T00:00:00Z",
    "query": "agents",
    "includeUnknownDates": True,
    "topK": 50,
}


def _pipeline(session_id="session-fixed"):
    research = build_research_artifact(
        session_id=session_id, input_items=FIXTURE, params=PARAMS, seed=42
    )
    ontology = build_ontology_artifact(
        session_id=session_id, research=research, seed=42
    )
    graph = build_graph_artifact(
        session_id=session_id, research=research, ontology=ontology, seed=42
    )
    personas = build_persona_artifact(
        session_id=session_id,
        research=research,
        ontology=ontology,
        graph=graph,
        count=2,
        seed=42,
    )
    return research, ontology, graph, personas


def test_research_ontology_graph_personas_are_canonical_and_grounded():
    first = _pipeline()
    second = _pipeline()
    assert [item.artifact_id for item in first] == [
        item.artifact_id for item in second
    ]

    research, ontology, graph, personas = first
    assert research.payload["report"]["counts"]["duplicatesRemoved"] == 1
    assert research.payload["report"]["counts"]["future"] == 1
    assert {item["timestampConfidence"] for item in research.payload["evidence"]} == {
        "exact",
        "unknown",
    }
    evidence_ids = {
        item["evidenceId"] for item in research.payload["evidence"]
    }
    assert all(
        set(relation["groundingEvidenceIds"]) <= evidence_ids
        for relation in ontology.payload["relations"]
    )
    assert all(
        edge["artifactReferences"] == [research.artifact_id, ontology.artifact_id]
        for edge in graph.payload["edges"]
    )
    assert graph.payload["memoryUpdates"] == []
    assert personas.simulated is True
    assert all(
        persona["groundingArtifactIds"]
        == [research.artifact_id, ontology.artifact_id, graph.artifact_id]
        for persona in personas.payload["personas"]
    )


def test_empty_evidence_is_valid_and_limits_are_enforced():
    research = build_research_artifact(
        session_id="empty", input_items=[], params={}, seed=1
    )
    ontology = build_ontology_artifact(
        session_id="empty", research=research, seed=1
    )
    graph = build_graph_artifact(
        session_id="empty", research=research, ontology=ontology, seed=1
    )
    personas = build_persona_artifact(
        session_id="empty",
        research=research,
        ontology=ontology,
        graph=graph,
        count=1,
        seed=1,
    )
    assert research.payload["report"]["generatedAt"] == "1970-01-01T00:00:00+00:00"
    assert ontology.payload["relations"] == []
    assert graph.payload["nodes"] == []
    assert personas.payload["personas"] == []
    with pytest.raises(ValueError, match="persona_count_out_of_bounds"):
        build_persona_artifact(
            session_id="empty",
            research=research,
            ontology=ontology,
            graph=graph,
            count=MAX_PERSONAS + 1,
            seed=1,
        )


def test_missing_cross_session_and_ungrounded_references_are_rejected():
    research, ontology, graph, _ = _pipeline()
    with pytest.raises(ValueError, match="cross_session"):
        build_ontology_artifact(
            session_id="another-session", research=research, seed=42
        )

    malformed = ontology.model_copy(deep=True)
    malformed.payload["relations"][0]["groundingEvidenceIds"] = ["missing-evidence"]
    with pytest.raises(ValueError, match="ungrounded_relation_reference"):
        build_graph_artifact(
            session_id=research.session_id,
            research=research,
            ontology=malformed,
            seed=42,
        )

    wrong_graph = graph.model_copy(deep=True)
    wrong_graph.payload["ontologyArtifactId"] = "missing-artifact"
    with pytest.raises(ValueError, match="ungrounded_graph_ontology_reference"):
        build_persona_artifact(
            session_id=research.session_id,
            research=research,
            ontology=ontology,
            graph=wrong_graph,
            count=1,
            seed=42,
        )


def test_artifact_ids_are_stable_across_process_hash_seed_and_timezone():
    script = f"""
import json
from backend.workflow.intelligence.research import build_research_artifact
fixture = json.loads({json.dumps(FIXTURE)!r})
params = json.loads({json.dumps(PARAMS)!r})
artifact = build_research_artifact(
    session_id="session-fixed", input_items=fixture, params=params, seed=42
)
print(artifact.artifact_id)
"""
    values = []
    for hash_seed, timezone in (("1", "UTC"), ("987", "Asia/Shanghai")):
        env = dict(os.environ, PYTHONHASHSEED=hash_seed, TZ=timezone)
        values.append(
            subprocess.check_output(
                [sys.executable, "-c", script],
                cwd=os.getcwd(),
                env=env,
                text=True,
            ).strip()
        )
    assert values[0] == values[1]


def test_evidence_multiset_permutations_produce_identical_pipeline():
    equal_rank_fixture = [
        {
            "title": "Priority #priority",
            "url": "https://example.test/priority",
            "source_id": "twitter",
            "published_at": "2026-07-20T12:00:00Z",
            "likes": 10,
        },
        {
            "title": "Alpha #alpha",
            "url": "https://example.test/a?utm_source=one",
            "source_id": "twitter",
            "published_at": "2026-07-20T10:00:00Z",
            "likes": 1,
        },
        {
            "title": "Beta #beta",
            "url": "https://example.test/b",
            "source_id": "bilibili",
            "published_at": "2026-07-20T10:00:00Z",
            "likes": 1,
        },
        {
            "title": "Duplicate loses stable tie #duplicate",
            "url": "https://example.test/a?utm_source=two",
            "source_id": "twitter",
            "published_at": "2026-07-20T10:00:00Z",
            "likes": 1,
        },
    ]
    payloads: set[str] = set()
    pipeline_ids: set[tuple[str, ...]] = set()
    for permutation in permutations(equal_rank_fixture):
        research = build_research_artifact(
            session_id="permutations",
            input_items=list(permutation),
            params=PARAMS,
            seed=99,
        )
        ontology = build_ontology_artifact(
            session_id="permutations", research=research, seed=99
        )
        graph = build_graph_artifact(
            session_id="permutations",
            research=research,
            ontology=ontology,
            seed=99,
        )
        personas = build_persona_artifact(
            session_id="permutations",
            research=research,
            ontology=ontology,
            graph=graph,
            count=3,
            seed=99,
        )
        payloads.add(canonical_json(research.payload))
        pipeline_ids.add(
            (
                research.artifact_id,
                ontology.artifact_id,
                graph.artifact_id,
                personas.artifact_id,
            )
        )
        assert research.payload["report"]["topItems"][0]["title"] == "Priority #priority"

    assert len(payloads) == 1
    assert len(pipeline_ids) == 1
