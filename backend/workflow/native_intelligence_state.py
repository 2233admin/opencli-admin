"""Central legal state machine for the IntelligenceSession aggregate."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from backend.workflow.native_intelligence_contracts import IntelligenceCommandName


class IntelligenceState(StrEnum):
    CREATED = "created"
    RESEARCHING = "researching"
    RESEARCH_READY = "research_ready"
    ONTOLOGY_READY = "ontology_ready"
    GRAPH_READY = "graph_ready"
    PREPARED = "prepared"
    RUNNING = "running"
    STOPPED = "stopped"
    SIMULATED = "simulated"
    INTERVIEWING = "interviewing"
    REPORTING = "reporting"
    REPORTED = "reported"
    FAILED = "failed"
    CANCELLED = "cancelled"
    CLOSED = "closed"


IN_FLIGHT_STATES = frozenset(
    {
        IntelligenceState.RESEARCHING,
        IntelligenceState.INTERVIEWING,
        IntelligenceState.REPORTING,
    }
)
RETRYABLE_FAILURE_STATES = frozenset(
    {
        IntelligenceState.RESEARCHING,
        IntelligenceState.RUNNING,
        IntelligenceState.INTERVIEWING,
        IntelligenceState.REPORTING,
    }
)

LEGAL_TRANSITIONS: dict[
    tuple[IntelligenceState, IntelligenceCommandName], IntelligenceState
] = {
    (IntelligenceState.CREATED, IntelligenceCommandName.RESEARCH): IntelligenceState.RESEARCHING,
    (
        IntelligenceState.RESEARCHING,
        IntelligenceCommandName.RESEARCH_COMPLETE,
    ): IntelligenceState.RESEARCH_READY,
    (
        IntelligenceState.RESEARCH_READY,
        IntelligenceCommandName.BUILD_ONTOLOGY,
    ): IntelligenceState.ONTOLOGY_READY,
    (
        IntelligenceState.ONTOLOGY_READY,
        IntelligenceCommandName.BUILD_GRAPH,
    ): IntelligenceState.GRAPH_READY,
    (IntelligenceState.GRAPH_READY, IntelligenceCommandName.PREPARE): IntelligenceState.PREPARED,
    (IntelligenceState.PREPARED, IntelligenceCommandName.START): IntelligenceState.RUNNING,
    (IntelligenceState.RUNNING, IntelligenceCommandName.STEP): IntelligenceState.RUNNING,
    (IntelligenceState.RUNNING, IntelligenceCommandName.STOP): IntelligenceState.STOPPED,
    (
        IntelligenceState.RUNNING,
        IntelligenceCommandName.SIMULATION_COMPLETE,
    ): IntelligenceState.SIMULATED,
    (IntelligenceState.STOPPED, IntelligenceCommandName.RESUME): IntelligenceState.RUNNING,
    (
        IntelligenceState.SIMULATED,
        IntelligenceCommandName.INTERVIEW,
    ): IntelligenceState.INTERVIEWING,
    (
        IntelligenceState.INTERVIEWING,
        IntelligenceCommandName.INTERVIEW_COMPLETE,
    ): IntelligenceState.SIMULATED,
    (IntelligenceState.SIMULATED, IntelligenceCommandName.REPORT): IntelligenceState.REPORTING,
    (
        IntelligenceState.REPORTING,
        IntelligenceCommandName.REPORT_PROGRESS,
    ): IntelligenceState.REPORTING,
    (
        IntelligenceState.REPORTING,
        IntelligenceCommandName.REPORT_COMPLETE,
    ): IntelligenceState.REPORTED,
    (
        IntelligenceState.REPORTED,
        IntelligenceCommandName.ASK_REPORT,
    ): IntelligenceState.REPORTED,
    (IntelligenceState.STOPPED, IntelligenceCommandName.CLOSE): IntelligenceState.CLOSED,
    (IntelligenceState.SIMULATED, IntelligenceCommandName.CLOSE): IntelligenceState.CLOSED,
    (IntelligenceState.REPORTED, IntelligenceCommandName.CLOSE): IntelligenceState.CLOSED,
    (IntelligenceState.FAILED, IntelligenceCommandName.CLOSE): IntelligenceState.CLOSED,
    (IntelligenceState.CANCELLED, IntelligenceCommandName.CLOSE): IntelligenceState.CLOSED,
}

_IDEMPOTENT_COMMANDS = {
    (IntelligenceState.RUNNING, IntelligenceCommandName.START),
    (IntelligenceState.STOPPED, IntelligenceCommandName.STOP),
    (IntelligenceState.CANCELLED, IntelligenceCommandName.CANCEL),
    (IntelligenceState.CLOSED, IntelligenceCommandName.CLOSE),
}


class IntelligenceTransitionError(RuntimeError):
    code = "invalid_intelligence_transition"


@dataclass(frozen=True)
class TransitionDecision:
    previous_state: IntelligenceState
    next_state: IntelligenceState
    command: IntelligenceCommandName
    no_op: bool = False


def decide_transition(
    state: IntelligenceState,
    command: IntelligenceCommandName,
    *,
    retry_metadata: dict[str, Any] | None = None,
) -> TransitionDecision:
    if (state, command) in _IDEMPOTENT_COMMANDS:
        return TransitionDecision(state, state, command, no_op=True)

    if command == IntelligenceCommandName.CANCEL and state != IntelligenceState.CLOSED:
        return TransitionDecision(state, IntelligenceState.CANCELLED, command)

    if command == IntelligenceCommandName.FAIL and state in RETRYABLE_FAILURE_STATES:
        return TransitionDecision(state, IntelligenceState.FAILED, command)

    if state in IN_FLIGHT_STATES and command in {
        IntelligenceCommandName.RENEW,
        IntelligenceCommandName.RECOVER,
    }:
        return TransitionDecision(state, state, command)

    if state == IntelligenceState.FAILED and command == IntelligenceCommandName.RESUME:
        target = _retry_target(retry_metadata)
        return TransitionDecision(state, target, command)

    next_state = LEGAL_TRANSITIONS.get((state, command))
    if next_state is None:
        if state == IntelligenceState.INTERVIEWING and command == IntelligenceCommandName.REPORT:
            raise IntelligenceTransitionError("interview_in_progress")
        raise IntelligenceTransitionError(
            f"command {command.value!r} is illegal from state {state.value!r}"
        )
    return TransitionDecision(state, next_state, command)


def _retry_target(metadata: dict[str, Any] | None) -> IntelligenceState:
    if not metadata or metadata.get("retryable") is not True:
        raise IntelligenceTransitionError("failure is not retryable")
    try:
        target = IntelligenceState(metadata["failed_from_state"])
    except (KeyError, ValueError) as exc:
        raise IntelligenceTransitionError("invalid failed_from_state") from exc
    if target not in RETRYABLE_FAILURE_STATES:
        raise IntelligenceTransitionError("invalid failed_from_state")
    if not metadata.get("failed_command"):
        raise IntelligenceTransitionError("missing failed_command")
    if not metadata.get("idempotency_key") or not metadata.get("request_hash"):
        raise IntelligenceTransitionError("missing original command identity")
    return target


def workflow_projection(state: IntelligenceState) -> dict[str, Any]:
    if state == IntelligenceState.CREATED:
        return {"status": "queued", "domain_state": state.value}
    if state in {
        IntelligenceState.RESEARCHING,
        IntelligenceState.PREPARED,
        IntelligenceState.RUNNING,
        IntelligenceState.INTERVIEWING,
        IntelligenceState.REPORTING,
    }:
        return {"status": "running", "domain_state": state.value}
    if state in {
        IntelligenceState.RESEARCH_READY,
        IntelligenceState.ONTOLOGY_READY,
        IntelligenceState.GRAPH_READY,
        IntelligenceState.STOPPED,
        IntelligenceState.SIMULATED,
    }:
        return {"status": "partial", "domain_state": state.value}
    if state == IntelligenceState.FAILED:
        return {"status": "failed", "domain_state": state.value}
    if state == IntelligenceState.CANCELLED:
        return {
            "status": "blocked",
            "domain_state": state.value,
            "block_reason": "intelligence_cancelled",
        }
    return {
        "status": "completed",
        "domain_state": state.value,
        "terminal": state == IntelligenceState.CLOSED,
    }


def checkpoint_resume_target(
    state: IntelligenceState, manifest: dict[str, Any]
) -> str | None:
    """Return the deterministic next unit for a recovered in-flight operation."""

    if state == IntelligenceState.RESEARCHING:
        return "recompute"
    planned = manifest.get("planned", [])
    completed = set(manifest.get("completed", []))
    for item in planned:
        if item not in completed:
            return str(item)
    return None


__all__ = [
    "IN_FLIGHT_STATES",
    "LEGAL_TRANSITIONS",
    "RETRYABLE_FAILURE_STATES",
    "IntelligenceState",
    "IntelligenceTransitionError",
    "TransitionDecision",
    "checkpoint_resume_target",
    "decide_transition",
    "workflow_projection",
]
