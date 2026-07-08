"""Tests for the OpenTabs runtime adapter.

The adapter targets OpenTabs' REST surface, not the browser extension protocol:
``GET /tools`` and ``POST /tools/{name}/call``.
"""

from __future__ import annotations

import httpx

from backend.agent_runtimes.base import AgentTask
from backend.agent_runtimes.opentabs_adapter import OpenTabsRuntimeAdapter
from backend.agent_runtimes.registry import get_runtime, list_runtime_types


def _transport(handler):
    return httpx.MockTransport(handler)


def _json_response(status_code: int, payload) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


async def test_opentabs_runtime_registered_by_default():
    assert "opentabs" in list_runtime_types()
    assert get_runtime("opentabs").runtime_type == "opentabs"


def test_validate_config_rejects_bad_values():
    adapter = OpenTabsRuntimeAdapter()

    errors = adapter.validate_config({"base_url": "", "secret": "", "timeout_seconds": 0})

    assert "'base_url' must be a non-empty string when provided" in errors
    assert "'secret' must be a non-empty string when provided" in errors
    assert "'timeout_seconds' must be a positive number when provided" in errors


async def test_list_tools_calls_opentabs_tools_endpoint():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.url.path == "/tools"
        assert request.url.params.get("plugin") == "slack"
        assert request.headers["authorization"] == "Bearer secret-1"
        return _json_response(
            200,
            [
                {
                    "name": "slack__send_message",
                    "description": "Send a message",
                    "plugin": "slack",
                    "inputSchema": {"type": "object"},
                }
            ],
        )

    adapter = OpenTabsRuntimeAdapter()
    task = AgentTask(
        task_id="t-list",
        workflow="tool.list",
        input={"plugin": "slack"},
        config={
            "base_url": "http://opentabs.local",
            "secret": "secret-1",
            "_transport": _transport(handler),
        },
    )

    events = [event async for event in adapter.invoke(task)]

    assert [event["type"] for event in events] == ["started", "tool_call", "tool_result", "done"]
    assert seen[0].method == "GET"
    assert events[1]["name"] == "opentabs_list_tools"
    assert events[-1]["result"]["tools"][0]["name"] == "slack__send_message"


async def test_call_tool_posts_open_tabs_arguments():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.method == "POST"
        assert request.url.path == "/tools/slack__send_message/call"
        assert request.read() == b'{"arguments":{"channel":"C1","text":"hello"}}'
        return _json_response(
            200,
            {
                "content": [{"type": "text", "text": '{"ok":true,"ts":"1.2"}'}],
            },
        )

    adapter = OpenTabsRuntimeAdapter()
    task = AgentTask(
        task_id="t-call",
        workflow="tool.call",
        input={"tool": "slack__send_message", "arguments": {"channel": "C1", "text": "hello"}},
        config={"base_url": "http://opentabs.local", "_transport": _transport(handler)},
    )

    events = [event async for event in adapter.invoke(task)]

    assert [event["type"] for event in events] == ["started", "tool_call", "tool_result", "done"]
    assert events[1]["name"] == "slack__send_message"
    assert events[2]["result"]["content"][0]["text"] == '{"ok":true,"ts":"1.2"}'
    assert events[-1]["result"]["tool"] == "slack__send_message"


async def test_workflow_can_be_tool_name_for_direct_calls():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/tools/browser_list_tabs/call"
        assert request.read() == b'{"arguments":{"windowId":7}}'
        return _json_response(200, {"content": [{"type": "text", "text": "[]"}]})

    adapter = OpenTabsRuntimeAdapter()
    task = AgentTask(
        task_id="t-direct",
        workflow="browser_list_tabs",
        input={"windowId": 7},
        config={"base_url": "http://opentabs.local", "_transport": _transport(handler)},
    )

    events = [event async for event in adapter.invoke(task)]

    assert events[-1]["type"] == "done"
    assert events[-1]["result"]["tool"] == "browser_list_tabs"


async def test_tool_is_error_becomes_terminal_runtime_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response(
            422,
            {
                "content": [{"type": "text", "text": "Tool disabled"}],
                "isError": True,
            },
        )

    adapter = OpenTabsRuntimeAdapter()
    task = AgentTask(
        task_id="t-error",
        workflow="tool.call",
        input={"tool": "slack__send_message", "arguments": {}},
        config={"base_url": "http://opentabs.local", "_transport": _transport(handler)},
    )

    events = [event async for event in adapter.invoke(task)]

    assert [event["type"] for event in events] == ["started", "tool_call", "tool_result", "error"]
    assert events[2]["is_error"] is True
    assert events[-1]["message"] == "Tool disabled"
    assert events[-1]["error_type"] == "OpenTabsToolError"


async def test_health_uses_open_tabs_health_endpoint(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        return _json_response(200, {"status": "ok", "extensionConnected": True})

    adapter = OpenTabsRuntimeAdapter()
    monkeypatch.setattr(
        adapter,
        "_client",
        lambda config: httpx.AsyncClient(
            base_url="http://opentabs.local",
            transport=_transport(handler),
        ),
    )

    assert await adapter.health() is True
