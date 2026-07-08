"""Contract tests for the built-in MiniFlow-compatible core."""

from __future__ import annotations

import graphlib
import itertools
import json

import pytest

from backend.miniflow.audit import AuditLog
from backend.miniflow.loader import load_workflow_file
from backend.miniflow.model import Outcome, Step, TransientError, Workflow
from backend.miniflow.runner import CircuitBreaker, execute_step, run_workflow


def _clock():
    counter = itertools.count()
    return lambda: float(next(counter))


def _no_sleep(_seconds: float) -> None:
    return None


def test_workflow_order_is_dependency_safe_and_declaration_stable():
    workflow = Workflow(
        name="deps",
        steps=[
            Step(name="b", run=lambda: None, depends_on=["a"]),
            Step(name="a", run=lambda: None),
            Step(name="c", run=lambda: None, depends_on=["a"]),
        ],
    )

    assert [step.name for step in workflow.ordered()] == ["a", "b", "c"]


def test_workflow_rejects_unknown_duplicate_and_cycle():
    with pytest.raises(ValueError, match="Duplicate"):
        Workflow(
            name="dupes",
            steps=[Step(name="a", run=lambda: None), Step(name="a", run=lambda: None)],
        ).ordered()

    with pytest.raises(ValueError, match="Unknown dependency"):
        Workflow(
            name="unknown",
            steps=[Step(name="a", run=lambda: None, depends_on=["missing"])],
        ).ordered()

    with pytest.raises(graphlib.CycleError):
        Workflow(
            name="cycle",
            steps=[
                Step(name="a", run=lambda: None, depends_on=["b"]),
                Step(name="b", run=lambda: None, depends_on=["a"]),
            ],
        ).ordered()


def test_retry_and_breaker_semantics_match_miniflow_contract():
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise TransientError(f"try {calls['n']}")

    outcome, attempts = execute_step(
        Step(name="fetch", run=flaky),
        CircuitBreaker(threshold=5),
        clock=_clock(),
        sleep=_no_sleep,
        max_attempts=3,
        base_delay=0.1,
    )

    assert outcome is Outcome.RETRIED
    assert attempts == 3

    def always_transient():
        raise TransientError("still bad")

    outcome, attempts = execute_step(
        Step(name="unstable", run=always_transient),
        CircuitBreaker(threshold=3),
        clock=_clock(),
        sleep=_no_sleep,
        max_attempts=3,
        base_delay=0.1,
    )

    assert outcome is Outcome.CIRCUIT_OPEN
    assert attempts == 3


def test_run_workflow_skips_poisoned_dependents_but_keeps_independent_branch():
    ran: list[str] = []

    def record(name: str):
        def inner():
            ran.append(name)

        return inner

    def always_transient():
        ran.append("unstable")
        raise TransientError("still bad")

    workflow = Workflow(
        name="branches",
        steps=[
            Step(name="setup", run=record("setup")),
            Step(name="unstable", run=always_transient, depends_on=["setup"]),
            Step(name="dependent", run=record("dependent"), depends_on=["unstable"]),
            Step(name="cleanup", run=record("cleanup"), depends_on=["setup"]),
        ],
    )

    result = run_workflow(
        workflow,
        clock=_clock(),
        sleep=_no_sleep,
        max_attempts=3,
        breaker_threshold=3,
    )

    assert result.success is False
    assert result.skipped == ["dependent"]
    assert "cleanup" in ran
    assert "dependent" not in ran


def test_audit_log_is_append_only(tmp_path):
    audit_path = tmp_path / "audit.jsonl"
    audit_path.write_text('{"preexisting": true}\n', encoding="utf-8")

    audit = AuditLog(audit_path, _clock())
    audit.record("step", 1, "success")

    lines = audit_path.read_text(encoding="utf-8").splitlines()
    assert lines[0] == '{"preexisting": true}'
    assert json.loads(lines[1])["step"] == "step"


def test_loader_accepts_upstream_miniflow_import_convention(tmp_path):
    path = tmp_path / "wf.py"
    path.write_text(
        """
from miniflow.model import Step, Workflow

workflow = Workflow(name="loaded", steps=[Step(name="a", run=lambda: "ok")])
""",
        encoding="utf-8",
    )

    workflow = load_workflow_file(path)

    assert workflow.name == "loaded"
    assert [step.name for step in workflow.ordered()] == ["a"]
