from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from backend.workflow.native_intelligence_contracts import (
    ARTIFACT_CONTRACTS,
    ARTIFACT_SIMULATION_EXPECTATIONS,
    ArtifactKind,
    ArtifactProvenance,
    IntelligenceCommand,
    IntelligenceCommandName,
    OperationLease,
    ResearchArtifact,
    canonical_hash,
    deterministic_id,
    deterministic_seed,
)
from backend.workflow.native_intelligence_state import (
    IntelligenceState,
    IntelligenceTransitionError,
    checkpoint_resume_target,
    decide_transition,
    workflow_projection,
)


def _artifact(kind: ArtifactKind):
    simulated = ARTIFACT_SIMULATION_EXPECTATIONS[kind]
    return ARTIFACT_CONTRACTS[kind](
        artifact_id=f"{kind.value}-1",
        session_id="session-1",
        payload={"kind": kind.value, "simulated": simulated},
        simulated=simulated,
        provenance=ArtifactProvenance(source="fixture"),
        algorithm_version="test-v1",
        seed=1,
    )


def test_every_artifact_contract_round_trips_and_rejects_wrong_version():
    for kind in ArtifactKind:
        artifact = _artifact(kind)
        assert ARTIFACT_CONTRACTS[kind].model_validate_json(
            artifact.model_dump_json()
        ) == artifact
        payload = artifact.model_dump(mode="json")
        payload["schema_version"] = "intelligence.artifact.v2"
        with pytest.raises(ValidationError):
            ARTIFACT_CONTRACTS[kind].model_validate(payload)


def test_command_contract_is_versioned_bounded_and_hashes_canonical_payload():
    first = IntelligenceCommand(
        command=IntelligenceCommandName.RESEARCH,
        session_id="session-1",
        expected_version=0,
        idempotency_key="research-1",
        request={"b": 2, "a": 1},
    )
    second = first.model_copy(update={"request": {"a": 1, "b": 2}})
    assert first.request_hash == second.request_hash
    with pytest.raises(ValidationError):
        IntelligenceCommand.model_validate(
            {**first.model_dump(), "schema_version": "intelligence.command.v2"}
        )


def test_deterministic_primitives_are_order_independent_and_sqlite_safe():
    assert canonical_hash({"b": 2, "a": 1}) == canonical_hash({"a": 1, "b": 2})
    assert deterministic_id("artifact", {"a": 1}) == deterministic_id(
        "artifact", {"a": 1}
    )
    assert 0 <= deterministic_seed({"a": 1}) <= 2**63 - 1


def test_state_machine_covers_retry_projection_and_terminal_idempotency():
    decision = decide_transition(
        IntelligenceState.CREATED, IntelligenceCommandName.RESEARCH
    )
    assert decision.next_state == IntelligenceState.RESEARCHING
    assert workflow_projection(IntelligenceState.CANCELLED) == {
        "status": "blocked",
        "domain_state": "cancelled",
        "block_reason": "intelligence_cancelled",
    }
    assert workflow_projection(IntelligenceState.PREPARED) == {
        "status": "running",
        "domain_state": "prepared",
    }
    assert decide_transition(
        IntelligenceState.CLOSED, IntelligenceCommandName.CLOSE
    ).no_op
    resumed = decide_transition(
        IntelligenceState.FAILED,
        IntelligenceCommandName.RESUME,
        retry_metadata={
            "failed_from_state": "reporting",
            "failed_command": "report",
            "retryable": True,
            "idempotency_key": "report-1",
            "request_hash": "a" * 64,
        },
    )
    assert resumed.next_state == IntelligenceState.REPORTING
    with pytest.raises(IntelligenceTransitionError):
        decide_transition(
            IntelligenceState.FAILED,
            IntelligenceCommandName.RESUME,
            retry_metadata={"failed_from_state": "created", "retryable": True},
        )


def test_in_flight_operation_lease_requires_timezone():
    with pytest.raises(ValidationError):
        OperationLease(
            operation_id="op-1",
            owner="worker",
            expires_at=datetime.now() + timedelta(minutes=1),
        )
    assert OperationLease(
        operation_id="op-1",
        owner="worker",
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
    ).attempt == 1


def test_checkpoint_resume_targets_are_deterministic():
    manifest = {"planned": ["section-1", "section-2"], "completed": ["section-1"]}
    assert (
        checkpoint_resume_target(IntelligenceState.REPORTING, manifest) == "section-2"
    )
    assert (
        checkpoint_resume_target(IntelligenceState.INTERVIEWING, manifest)
        == "section-2"
    )
    assert checkpoint_resume_target(IntelligenceState.RESEARCHING, manifest) == "recompute"


def test_typed_artifact_rejects_wrong_kind():
    with pytest.raises(ValidationError):
        ResearchArtifact(
            artifact_id="artifact-1",
            session_id="session-1",
            kind="report",
            payload={"simulated": False},
            simulated=False,
            provenance=ArtifactProvenance(source="fixture"),
            algorithm_version="v1",
            seed=1,
        )


def test_artifact_contracts_reject_inverted_simulation_provenance():
    for kind, contract in ARTIFACT_CONTRACTS.items():
        expected = ARTIFACT_SIMULATION_EXPECTATIONS[kind]
        with pytest.raises(ValidationError, match="artifact_simulation_flag_invalid"):
            contract(
                artifact_id=f"{kind.value}-invalid",
                session_id="session-1",
                payload={"simulated": not expected},
                simulated=not expected,
                provenance=ArtifactProvenance(source="fixture"),
                algorithm_version="v1",
                seed=1,
            )


def test_artifact_contracts_reject_envelope_payload_simulation_mismatch():
    for kind, contract in ARTIFACT_CONTRACTS.items():
        expected = ARTIFACT_SIMULATION_EXPECTATIONS[kind]
        with pytest.raises(
            ValidationError,
            match="artifact_simulation_payload_mismatch",
        ):
            contract(
                artifact_id=f"{kind.value}-payload-invalid",
                session_id="session-1",
                payload={"simulated": not expected},
                simulated=expected,
                provenance=ArtifactProvenance(source="fixture"),
                algorithm_version="v1",
                seed=1,
            )
