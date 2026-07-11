import pytest

from backend.control.operations_agent_policy import evaluate_automatic_action
from backend.models.operations_agent import AgentProfileMode


def _decision(**overrides):
    values = {
        "agent_disabled": False,
        "profile_mode": AgentProfileMode.LOW_RISK_AUTOMATIC,
        "tool_scope": ["plans.update_schedule"],
        "resource_scope": ["plan:daily-news"],
        "action_scope": ["schedule.adjust"],
        "tool_name": "plans.update_schedule",
        "resource_ref": "plan:daily-news",
        "action_type": "schedule.adjust",
        "risk_level": "low",
        "automatic_eligible": True,
        "enrollment_active": True,
        "gate_allowed": True,
    }
    values.update(overrides)
    return evaluate_automatic_action(**values)


def test_qualified_scoped_action_still_requires_actuator():
    decision = _decision()

    assert decision.allowed is True
    assert decision.requires_actuator is True
    assert decision.blocked_by is None


@pytest.mark.parametrize("risk_level", ["high", "critical"])
def test_high_and_critical_actions_are_never_automatic(risk_level):
    decision = _decision(risk_level=risk_level)

    assert decision.allowed is False
    assert decision.blocked_by == "risk_requires_human_approval"
    assert decision.requires_actuator is True


@pytest.mark.parametrize(
    ("override", "blocked_by"),
    [
        ({"agent_disabled": True}, "agent_disabled"),
        ({"profile_mode": AgentProfileMode.SUGGEST_CHANGES}, "profile_not_automatic"),
        ({"tool_name": "sources.delete"}, "tool_out_of_scope"),
        ({"resource_ref": "plan:other"}, "resource_out_of_scope"),
        ({"action_type": "plan.delete"}, "action_out_of_scope"),
        ({"automatic_eligible": False}, "action_not_eligible"),
        ({"enrollment_active": False}, "automatic_enrollment_inactive"),
        ({"gate_allowed": False}, "gate_blocked"),
    ],
)
def test_automatic_action_fails_closed_at_each_boundary(override, blocked_by):
    decision = _decision(**override)

    assert decision.allowed is False
    assert decision.blocked_by == blocked_by
    assert decision.requires_actuator is True


@pytest.mark.parametrize("scope_name", ["tool_scope", "resource_scope", "action_scope"])
def test_wildcard_scope_never_authorizes_automatic_action(scope_name):
    decision = _decision(**{scope_name: ["*"]})

    assert decision.allowed is False
    assert decision.blocked_by.endswith("_out_of_scope")
