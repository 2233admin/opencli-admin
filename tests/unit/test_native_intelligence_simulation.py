import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from backend.workflow.intelligence.simulation import (
    MAX_SIMULATION_ACTIONS,
    MAX_SIMULATION_AGENTS,
    MAX_SIMULATION_ROUNDS,
    advance_simulation,
    build_simulation_artifact,
    prepare_simulation,
)
from backend.workflow.native_intelligence_contracts import (
    ArtifactProvenance,
    PersonaArtifact,
    canonical_hash,
)


def _personas(count: int = 3) -> PersonaArtifact:
    return PersonaArtifact(
        artifact_id="personas-stable",
        session_id="simulation-unit",
            payload={
                "schema": "intelligence.personas.v1",
                "simulated": True,
                "graphArtifactId": "graph-stable",
            "personas": [
                {
                    "personaId": f"persona-{index:03d}",
                    "name": f"Observer {index}",
                    "role": "observer",
                    "simulated": True,
                }
                for index in range(count)
            ],
        },
        grounding_artifact_ids=["graph-stable"],
        simulated=True,
        provenance=ArtifactProvenance(source="test"),
        algorithm_version="test-personas-v1",
        seed=0,
    )


@pytest.mark.parametrize(
    ("field", "value", "error"),
    [
        ("agent_count", 0, "simulation_agent_count_out_of_bounds"),
        (
            "agent_count",
            MAX_SIMULATION_AGENTS + 1,
            "simulation_agent_count_out_of_bounds",
        ),
        ("max_rounds", 0, "simulation_round_count_out_of_bounds"),
        (
            "max_rounds",
            MAX_SIMULATION_ROUNDS + 1,
            "simulation_round_count_out_of_bounds",
        ),
        ("max_actions", 0, "simulation_action_count_out_of_bounds"),
        (
            "max_actions",
            MAX_SIMULATION_ACTIONS + 1,
            "simulation_action_count_out_of_bounds",
        ),
    ],
)
def test_simulation_rejects_zero_and_max_plus_one(field, value, error):
    kwargs = {
        "session_id": "simulation-unit",
        "personas": _personas(MAX_SIMULATION_AGENTS),
        field: value,
    }
    with pytest.raises(ValueError, match=error):
        prepare_simulation(**kwargs)


def test_simulation_accepts_maxima_and_caps_actions():
    personas = _personas(MAX_SIMULATION_AGENTS)
    manifest = prepare_simulation(
        session_id=personas.session_id,
        personas=personas,
        seed=19,
        agent_count=MAX_SIMULATION_AGENTS,
        max_rounds=MAX_SIMULATION_ROUNDS,
        max_actions=MAX_SIMULATION_ACTIONS,
    )
    for _ in range(MAX_SIMULATION_ROUNDS):
        manifest, snapshot = advance_simulation(personas, manifest)
    artifact = build_simulation_artifact(
        session_id=personas.session_id,
        personas=personas,
        manifest=manifest,
    )
    assert len(snapshot["actions"]) <= MAX_SIMULATION_ACTIONS
    assert artifact.simulated is True
    assert artifact.payload["roundsCompleted"] == MAX_SIMULATION_ROUNDS
    assert artifact.grounding_artifact_ids == [
        personas.artifact_id,
        "graph-stable",
    ]
    assert artifact.provenance.evidence_artifact_ids == [
        personas.artifact_id,
        "graph-stable",
    ]


def test_cross_process_restart_schedule_is_deterministic(tmp_path):
    personas = _personas()
    manifest = prepare_simulation(
        session_id=personas.session_id,
        personas=personas,
        seed=23,
        max_rounds=5,
    )
    manifest, _ = advance_simulation(personas, manifest)
    payload = {
        "personas": personas.model_dump(mode="json"),
        "manifest": manifest,
    }
    script = """
import json, sys
from backend.workflow.intelligence.simulation import advance_simulation, build_simulation_artifact
from backend.workflow.native_intelligence_contracts import PersonaArtifact, canonical_hash
data = json.loads(sys.stdin.read())
personas = PersonaArtifact.model_validate(data["personas"])
manifest = data["manifest"]
while manifest["currentRound"] < manifest["config"]["maxRounds"]:
    manifest, _ = advance_simulation(personas, manifest)
artifact = build_simulation_artifact(
    session_id=personas.session_id, personas=personas, manifest=manifest
)
print(canonical_hash(artifact.model_dump(mode="json")))
"""
    hashes = []
    for hash_seed in ("1", "999"):
        environment = dict(os.environ)
        environment["PYTHONHASHSEED"] = hash_seed
        completed = subprocess.run(
            [sys.executable, "-c", script],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
            cwd=Path(__file__).resolve().parents[2],
            env=environment,
        )
        hashes.append(completed.stdout.strip())

    while manifest["currentRound"] < manifest["config"]["maxRounds"]:
        manifest, _ = advance_simulation(personas, manifest)
    local = build_simulation_artifact(
        session_id=personas.session_id,
        personas=personas,
        manifest=manifest,
    )
    assert hashes == [canonical_hash(local.model_dump(mode="json"))] * 2
