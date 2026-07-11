"""Fail-closed authorization for Operations Agent automatic action requests.

This module never executes an action. A successful decision still requires the
caller to pass the request through the system Gate and the sole Actuator.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from backend.models.operations_agent import AgentProfileMode


@dataclass(frozen=True)
class AutomaticActionDecision:
    allowed: bool
    blocked_by: str | None
    requires_actuator: bool = True

    @classmethod
    def allow(cls) -> "AutomaticActionDecision":
        return cls(allowed=True, blocked_by=None)

    @classmethod
    def block(cls, reason: str) -> "AutomaticActionDecision":
        return cls(allowed=False, blocked_by=reason)


def _exactly_scoped(value: str, scope: Sequence[str]) -> bool:
    return "*" not in scope and value in scope


def evaluate_automatic_action(
    *,
    agent_disabled: bool,
    profile_mode: AgentProfileMode | str,
    tool_scope: Sequence[str],
    resource_scope: Sequence[str],
    action_scope: Sequence[str],
    tool_name: str,
    resource_ref: str,
    action_type: str,
    risk_level: str,
    automatic_eligible: bool,
    enrollment_active: bool,
    gate_allowed: bool,
) -> AutomaticActionDecision:
    """Evaluate automatic authorization without mutating any resource."""

    if agent_disabled:
        return AutomaticActionDecision.block("agent_disabled")
    if profile_mode != AgentProfileMode.LOW_RISK_AUTOMATIC:
        return AutomaticActionDecision.block("profile_not_automatic")
    if not _exactly_scoped(tool_name, tool_scope):
        return AutomaticActionDecision.block("tool_out_of_scope")
    if not _exactly_scoped(resource_ref, resource_scope):
        return AutomaticActionDecision.block("resource_out_of_scope")
    if not _exactly_scoped(action_type, action_scope):
        return AutomaticActionDecision.block("action_out_of_scope")
    if risk_level in {"high", "critical"}:
        return AutomaticActionDecision.block("risk_requires_human_approval")
    if risk_level not in {"low", "medium"}:
        return AutomaticActionDecision.block("risk_unrecognized")
    if not automatic_eligible:
        return AutomaticActionDecision.block("action_not_eligible")
    if not enrollment_active:
        return AutomaticActionDecision.block("automatic_enrollment_inactive")
    if not gate_allowed:
        return AutomaticActionDecision.block("gate_blocked")
    return AutomaticActionDecision.allow()
