"""Tests for the built-in MiniFlow runtime adapter."""

from __future__ import annotations

import itertools
import json

from backend.agent_runtimes.base import AgentTask
from backend.agent_runtimes.miniflow_adapter import MiniFlowRuntimeAdapter
from backend.agent_runtimes.registry import available_runtimes, get_runtime, list_runtime_types


def _clock():
    counter = itertools.count()
    return lambda: float(next(counter))


def _no_sleep(_seconds: float) -> None:
    return None


def _write_workflow(tmp_path, source: str, name: str = "workflow.py") -> str:
    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    return str(path)


ALL_SUCCESS = """
from miniflow.model import Step, Workflow

workflow = Workflow(
    name="all_ok",
    steps=[
        Step(name="setup", run=lambda: "ok"),
        Step(name="fetch", run=lambda: "ok", depends_on=["setup"]),
    ],
)
"""


BREAKER_TRIP = """
from miniflow.model import Step, TransientError, Workflow

def always_transient():
    raise TransientError("never settles")

workflow = Workflow(
    name="trips_breaker",
    steps=[
        Step(name="setup", run=lambda: "ok"),
        Step(name="unstable", run=always_transient, depends_on=["setup"]),
        Step(name="dependent", run=lambda: "skip", depends_on=["unstable"]),
        Step(name="cleanup", run=lambda: "ok", depends_on=["setup"]),
    ],
)
"""


def test_miniflow_runtime_registered_and_available_by_default():
    assert "miniflow" in list_runtime_types()
    assert get_runtime("miniflow").runtime_type == "miniflow"
    assert "miniflow" in available_runtimes()


def test_validate_config_rejects_bad_values():
    adapter = MiniFlowRuntimeAdapter()

    errors = adapter.validate_config(
        {
            "workflow_path": 1,
            "audit_log": 2,
            "cwd": 3,
            "max_attempts": 0,
            "breaker_threshold": False,
            "base_delay": -1,
        }
    )

    assert "'workflow_path' must be a string when provided" in errors
    assert "'audit_log' must be a string when provided" in errors
    assert "'cwd' must be a string when provided" in errors
    assert "'max_attempts' must be a positive integer when provided" in errors
    assert "'breaker_threshold' must be a positive integer when provided" in errors
    assert "'base_delay' must be a non-negative number when provided" in errors


async def test_successful_workflow_file_emits_done_and_audit_events(tmp_path):
    workflow_path = _write_workflow(tmp_path, ALL_SUCCESS)
    audit_path = tmp_path / "audit.jsonl"
    adapter = MiniFlowRuntimeAdapter()
    task = AgentTask(
        task_id="t-ok",
        workflow="miniflow.run",
        input={"workflow_path": workflow_path, "audit_log": str(audit_path)},
        config={"_clock": _clock(), "_sleep": _no_sleep},
    )

    events = [event async for event in adapter.invoke(task)]

    assert events[0]["type"] == "started"
    assert events[-1]["type"] == "done"
    assert events[-1]["result"]["success"] is True
    assert [step["name"] for step in events[-1]["result"]["steps"]] == ["setup", "fetch"]
    assert [event["type"] for event in events].count("tool_result") == 2
    assert audit_path.exists()
    audit_entries = [json.loads(line) for line in audit_path.read_text().splitlines()]
    assert [entry["outcome"] for entry in audit_entries] == ["success", "success"]


async def test_workflow_can_be_passed_as_runtime_workflow_path(tmp_path):
    workflow_path = _write_workflow(tmp_path, ALL_SUCCESS)
    adapter = MiniFlowRuntimeAdapter()
    task = AgentTask(
        task_id="t-direct",
        workflow=workflow_path,
        config={"_clock": _clock(), "_sleep": _no_sleep},
    )

    events = [event async for event in adapter.invoke(task)]

    assert events[-1]["type"] == "done"
    assert events[-1]["result"]["workflow"] == "all_ok"


async def test_breaker_trip_emits_state_then_terminal_error(tmp_path):
    workflow_path = _write_workflow(tmp_path, BREAKER_TRIP)
    adapter = MiniFlowRuntimeAdapter()
    task = AgentTask(
        task_id="t-trip",
        workflow="run",
        input={"workflow_path": workflow_path},
        config={"_clock": _clock(), "_sleep": _no_sleep},
    )

    events = [event async for event in adapter.invoke(task)]

    assert events[-2]["type"] == "state"
    assert events[-2]["state"]["miniflow"]["success"] is False
    assert events[-2]["state"]["miniflow"]["skipped"] == ["dependent"]
    assert events[-1]["type"] == "error"
    assert events[-1]["error_type"] == "MiniFlowRunFailed"
    assert "unstable:circuit_open" in events[-1]["message"]
    tool_results = [event for event in events if event["type"] == "tool_result"]
    assert [event["result"]["outcome"] for event in tool_results] == [
        "success",
        "transient_failure",
        "transient_failure",
        "circuit_open",
        "success",
    ]
    assert tool_results[-2]["is_error"] is True


async def test_missing_workflow_file_is_runtime_error(tmp_path):
    adapter = MiniFlowRuntimeAdapter()
    task = AgentTask(
        task_id="t-missing",
        workflow="run",
        input={"workflow_path": str(tmp_path / "missing.py")},
        config={"_clock": _clock(), "_sleep": _no_sleep},
    )

    events = [event async for event in adapter.invoke(task)]

    assert events[0]["type"] == "started"
    assert events[-1]["type"] == "error"
    assert events[-1]["error_type"] == "FileNotFoundError"


async def test_health_is_available_without_external_package():
    adapter = MiniFlowRuntimeAdapter()

    assert await adapter.health() is True
