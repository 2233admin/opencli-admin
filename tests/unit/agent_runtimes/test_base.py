"""Contract tests for backend/agent_runtimes/base.py and registry.py."""

from collections.abc import AsyncIterator
from typing import Any

import pytest

from backend.agent_runtimes.base import (
    EVENT_TYPES,
    AgentTask,
    RuntimeAdapter,
    RuntimeCapabilities,
    RuntimeInvocationError,
    event_done,
    event_error,
    event_started,
    event_state,
    event_text,
    event_tool_call,
    event_tool_result,
)
from backend.agent_runtimes.registry import (
    _REGISTRY,
    available_runtimes,
    get_runtime,
    list_runtime_types,
    register_runtime,
)

# ── event constructors ───────────────────────────────────────────────────────


def test_event_started_shape():
    ev = event_started("t1")
    assert ev == {"type": "started", "task_id": "t1"}
    assert ev["type"] in EVENT_TYPES


def test_event_text_shape():
    ev = event_text("t1", "hello")
    assert ev == {"type": "text", "task_id": "t1", "text": "hello"}


def test_event_tool_call_shape_defaults():
    ev = event_tool_call("t1", "search")
    assert ev == {
        "type": "tool_call",
        "task_id": "t1",
        "name": "search",
        "args": {},
        "call_id": None,
    }


def test_event_tool_call_shape_explicit():
    ev = event_tool_call("t1", "search", args={"q": "x"}, call_id="c1")
    assert ev["args"] == {"q": "x"}
    assert ev["call_id"] == "c1"


def test_event_tool_result_shape():
    ev = event_tool_result("t1", "search", result={"n": 1}, call_id="c1", is_error=True)
    assert ev == {
        "type": "tool_result",
        "task_id": "t1",
        "name": "search",
        "result": {"n": 1},
        "call_id": "c1",
        "is_error": True,
    }


def test_event_state_shape():
    ev = event_state("t1", {"foo": "bar"})
    assert ev == {"type": "state", "task_id": "t1", "state": {"foo": "bar"}}


def test_event_done_shape_default():
    ev = event_done("t1")
    assert ev == {"type": "done", "task_id": "t1", "result": {}}


def test_event_done_shape_with_result():
    ev = event_done("t1", result={"ok": True})
    assert ev["result"] == {"ok": True}


def test_event_error_shape():
    ev = event_error("t1", "boom", error_type="TimeoutError")
    assert ev == {
        "type": "error",
        "task_id": "t1",
        "message": "boom",
        "error_type": "TimeoutError",
    }


def test_event_error_default_error_type_none():
    ev = event_error("t1", "boom")
    assert ev["error_type"] is None


@pytest.mark.parametrize(
    "builder,args",
    [
        (event_started, ("t1",)),
        (event_text, ("t1", "x")),
        (event_tool_call, ("t1", "n")),
        (event_tool_result, ("t1", "n")),
        (event_state, ("t1", {})),
        (event_done, ("t1",)),
        (event_error, ("t1", "m")),
    ],
)
def test_every_event_constructor_type_is_in_closed_set(builder, args):
    ev = builder(*args)
    assert ev["type"] in EVENT_TYPES
    assert ev["task_id"] == "t1"


def test_event_types_is_exactly_the_documented_set():
    assert EVENT_TYPES == {
        "started",
        "text",
        "tool_call",
        "tool_result",
        "state",
        "done",
        "error",
    }


# ── AgentTask / RuntimeCapabilities shape ────────────────────────────────────


def test_agent_task_defaults():
    task = AgentTask(task_id="t1", workflow="wf")
    assert task.input == {}
    assert task.config == {}
    assert task.session_id is None


def test_runtime_capabilities_defaults():
    caps = RuntimeCapabilities(transport="stdio")
    assert caps.streaming is True
    assert caps.resume_by_id is False
    assert caps.checkpoint == "none"
    assert caps.concurrent_sessions is True


def test_runtime_capabilities_is_frozen():
    caps = RuntimeCapabilities(transport="stdio")
    with pytest.raises(Exception):
        caps.transport = "http"  # type: ignore[misc]


# ── RuntimeInvocationError ───────────────────────────────────────────────────


def test_runtime_invocation_error_carries_error_type():
    exc = RuntimeInvocationError("boom", error_type="TimeoutError")
    assert str(exc) == "boom"
    assert exc.error_type == "TimeoutError"


def test_runtime_invocation_error_default_error_type_none():
    exc = RuntimeInvocationError("boom")
    assert exc.error_type is None


# ── RuntimeAdapter contract shape via a minimal concrete adapter ────────────


class _FakeAdapter(RuntimeAdapter):
    runtime_type = "fake"
    capabilities = RuntimeCapabilities(transport="stdio")

    def __init__(self, *, healthy: bool = True, available: bool = True) -> None:
        self._healthy = healthy
        self._available = available

    async def invoke(self, task: AgentTask) -> AsyncIterator[dict[str, Any]]:
        yield event_started(task.task_id)
        yield event_done(task.task_id, result={"ok": True})

    async def health(self) -> bool:
        return self._healthy

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        return [] if config.get("valid", True) else ["bad config"]

    @classmethod
    def is_available(cls) -> bool:
        return True


async def test_concrete_adapter_invoke_yields_events_ending_in_done():
    adapter = _FakeAdapter()
    task = AgentTask(task_id="t1", workflow="wf")
    events = [ev async for ev in adapter.invoke(task)]
    assert events[0]["type"] == "started"
    assert events[-1]["type"] == "done"
    assert sum(1 for e in events if e["type"] in ("done", "error")) == 1


async def test_concrete_adapter_health():
    adapter = _FakeAdapter(healthy=False)
    assert await adapter.health() is False


def test_concrete_adapter_validate_config():
    adapter = _FakeAdapter()
    assert adapter.validate_config({}) == []
    assert adapter.validate_config({"valid": False}) == ["bad config"]


async def test_bootstrap_default_is_noop():
    adapter = _FakeAdapter()
    assert await adapter.bootstrap() is None


def test_runtime_adapter_is_abstract():
    with pytest.raises(TypeError):
        RuntimeAdapter()  # type: ignore[abstract]


# ── registry ──────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clean_registry():
    """Registry is a module-level dict populated by real adapters on import
    (pi_adapter, via _load_all_runtimes). Snapshot/restore around each test
    so registration tests don't leak into each other or into other test
    modules that assume 'pi' is registered."""
    snapshot = dict(_REGISTRY)
    yield
    _REGISTRY.clear()
    _REGISTRY.update(snapshot)


def test_register_runtime_decorator_adds_instance_to_registry():
    @register_runtime
    class _Sample(_FakeAdapter):
        runtime_type = "sample_runtime"

    assert get_runtime("sample_runtime").runtime_type == "sample_runtime"
    assert "sample_runtime" in list_runtime_types()


def test_get_runtime_unknown_raises_value_error():
    with pytest.raises(ValueError, match="Unknown runtime type"):
        get_runtime("does-not-exist")


def test_pi_adapter_registered_by_default_discovery():
    """_load_all_runtimes() at import time registers the pi adapter."""
    assert "pi" in list_runtime_types()
    assert get_runtime("pi").runtime_type == "pi"
    assert "miniflow" in list_runtime_types()
    assert get_runtime("miniflow").runtime_type == "miniflow"


def test_available_runtimes_filters_by_is_available(monkeypatch):
    @register_runtime
    class _AvailableRuntime(_FakeAdapter):
        runtime_type = "available_runtime"

        @classmethod
        def is_available(cls) -> bool:
            return True

    @register_runtime
    class _UnavailableRuntime(_FakeAdapter):
        runtime_type = "unavailable_runtime"

        @classmethod
        def is_available(cls) -> bool:
            return False

    available = available_runtimes()
    assert "available_runtime" in available
    assert "unavailable_runtime" not in available


def test_available_runtimes_excludes_adapters_without_is_available():
    class _BareAdapter(RuntimeAdapter):
        """Adapter that forgot to define is_available() — simulates a
        third-party adapter missing the classmethod entirely."""

        runtime_type = "no_check_runtime"
        capabilities = RuntimeCapabilities(transport="stdio")

        async def invoke(self, task: AgentTask) -> AsyncIterator[dict[str, Any]]:
            yield event_done(task.task_id)

        async def health(self) -> bool:
            return True

        def validate_config(self, config: dict[str, Any]) -> list[str]:
            return []

    register_runtime(_BareAdapter)

    assert "no_check_runtime" not in available_runtimes()
