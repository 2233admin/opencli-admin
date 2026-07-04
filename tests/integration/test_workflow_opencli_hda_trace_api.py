"""HTTP-seam tests for Multi Source OpenCLI HDA tracing."""

import pytest


def _multi_source_opencli_hda_project() -> dict:
    return {
        "id": "wf-opencli-hda",
        "name": "Multi source OpenCLI HDA",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "multi-source-opencli",
                "kind": "agent",
                "capability": "normalize",
                "topicCollapse": {
                    "groupId": "opencli-package",
                    "nodeCount": 3,
                    "mode": "draft",
                    "packageInternal": True,
                },
                "internals": {
                    "nodes": [
                        {
                            "id": "source-bilibili",
                            "kind": "source",
                            "capability": "fetch",
                            "adapter": "opencli-bilibili",
                            "params": {
                                "site": "bilibili",
                                "command": "search",
                                "args": {"keyword": "ai"},
                                "sourceGroup": "video",
                            },
                        },
                        {
                            "id": "source-xiaohongshu",
                            "kind": "source",
                            "capability": "fetch",
                            "adapter": "opencli-xiaohongshu",
                            "params": {
                                "site": "xiaohongshu",
                                "command": "search",
                                "args": {"keyword": "ai"},
                                "sourceGroup": "social",
                            },
                        },
                        {
                            "id": "internal-normalize",
                            "kind": "agent",
                            "capability": "normalize",
                            "params": {"language": "zh-CN"},
                        },
                    ],
                    "edges": [
                        {
                            "id": "bilibili-normalize",
                            "source": "source-bilibili",
                            "target": "internal-normalize",
                        },
                        {
                            "id": "xiaohongshu-normalize",
                            "source": "source-xiaohongshu",
                            "target": "internal-normalize",
                        },
                    ],
                },
            }
        ],
        "edges": [],
        "adapters": [
            {
                "id": "opencli-bilibili",
                "type": "source",
                "provider": "opencli",
                "mode": "live",
                "config": {"channel": "opencli"},
            },
            {
                "id": "opencli-xiaohongshu",
                "type": "source",
                "provider": "opencli",
                "mode": "live",
                "config": {"channel": "opencli"},
            },
        ],
        "agentPermissions": {
            "canFetchNetwork": True,
            "canSendNotifications": False,
            "canWriteInbox": True,
            "allowedDomains": ["bilibili.com", "xiaohongshu.com"],
        },
    }


@pytest.mark.asyncio
async def test_opencli_hda_trace_builds_iii_fanout_payloads(client):
    response = await client.post(
        "/api/v1/workflows/opencli-hda/trace",
        json={
            "project": _multi_source_opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-001",
            "traceId": "trace-001",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["valid"] is True
    assert data["errors"] == []
    assert data["workflowId"] == "wf-opencli-hda"
    assert data["runId"] == "run-001"
    assert data["traceId"] == "trace-001"
    assert data["packageNodeId"] == "multi-source-opencli"
    assert data["dispatch"] == {
        "runtime": "iii",
        "worker": "collector-opencli",
        "functionId": "odp.collect::opencli_snapshot",
        "mode": "trigger_envelope",
    }

    dispatches = data["dispatches"]
    assert [dispatch["nodeId"] for dispatch in dispatches] == [
        "multi-source-opencli::source-bilibili",
        "multi-source-opencli::source-xiaohongshu",
    ]
    first = dispatches[0]
    assert first["packageNodeId"] == "multi-source-opencli"
    assert first["internalNodeId"] == "source-bilibili"
    assert first["sourceGroup"] == "video"
    assert first["site"] == "bilibili"
    assert first["command"] == "search"
    assert first["args"] == {"keyword": "ai"}
    assert first["iii"] == {
        "function_id": "odp.collect::opencli_snapshot",
        "payload": {
            "workflow_id": "wf-opencli-hda",
            "workflow_run_id": "run-001",
            "package_node_id": "multi-source-opencli",
            "node_id": "multi-source-opencli::source-bilibili",
            "internal_node_id": "source-bilibili",
            "source_group": "video",
            "site": "bilibili",
            "command": "search",
            "args": {"keyword": "ai"},
            "format": "json",
            "task_id": first["taskId"],
            "trace_id": "trace-001",
        },
    }


@pytest.mark.asyncio
async def test_opencli_hda_trace_reuses_collector_opencli_instead_of_odp_direct(client):
    response = await client.post(
        "/api/v1/workflows/opencli-hda/trace",
        json={
            "project": _multi_source_opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-001",
            "traceId": "trace-001",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["dispatch"]["worker"] == "collector-opencli"
    assert data["dispatch"]["functionId"] == "odp.collect::opencli_snapshot"
    for dispatch in data["dispatches"]:
        assert dispatch["iii"]["function_id"] == "odp.collect::opencli_snapshot"
        assert dispatch["iii"]["function_id"] != "odp.ingest::batch"
        assert "events" not in dispatch["iii"]["payload"]
        assert "records" not in dispatch["iii"]["payload"]


@pytest.mark.asyncio
async def test_opencli_hda_trace_accepts_ai_source_slots_without_static_internals(client):
    project = _multi_source_opencli_hda_project()
    package = project["nodes"][0]
    package.pop("internals")
    package["params"] = {
        "template": "opencli-multi-source",
        "runtime": "iii",
        "lockedInternals": True,
        "execution": {
            "fanout": "parallel",
            "maxConcurrency": 8,
            "workerPool": "docker-browser-workers",
        },
        "sources": [
            {
                "id": "bili",
                "sourceGroup": "video",
                "site": "bilibili",
                "command": "search",
                "args": {"keyword": "ai"},
            },
            {
                "id": "xhs",
                "sourceGroup": "social",
                "site": "xiaohongshu",
                "command": "search",
                "args": {"keyword": "ai"},
            },
        ],
    }
    package["ui"] = {"catalogId": "package.opencli.multi-source-hda"}
    project["adapters"] = []

    response = await client.post(
        "/api/v1/workflows/opencli-hda/trace",
        json={
            "project": project,
            "packageNodeId": "multi-source-opencli",
            "runId": "run-001",
            "traceId": "trace-001",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    assert [dispatch["nodeId"] for dispatch in data["dispatches"]] == [
        "multi-source-opencli::source-bili",
        "multi-source-opencli::source-xhs",
    ]
    assert data["dispatches"][0]["iii"]["payload"]["source_group"] == "video"
    assert data["dispatches"][1]["site"] == "xiaohongshu"


@pytest.mark.asyncio
async def test_opencli_hda_trace_reports_package_without_opencli_source_bindings(client):
    project = _multi_source_opencli_hda_project()
    project["nodes"][0]["internals"]["nodes"] = [
        {
            "id": "internal-normalize",
            "kind": "agent",
            "capability": "normalize",
            "params": {"language": "zh-CN"},
        }
    ]
    project["nodes"][0]["internals"]["edges"] = []

    response = await client.post(
        "/api/v1/workflows/opencli-hda/trace",
        json={
            "project": project,
            "packageNodeId": "multi-source-opencli",
            "runId": "run-001",
            "traceId": "trace-001",
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    assert data["dispatches"] == []
    assert data["errors"][0]["code"] == "missing_opencli_hda_sources"
    assert data["errors"][0]["node_id"] == "multi-source-opencli"


@pytest.mark.asyncio
async def test_workflow_run_events_projection_and_stream(client):
    start = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _multi_source_opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-events-001",
            "traceId": "trace-events-001",
        },
    )

    data = start.json()["data"]
    assert start.status_code == 202
    assert data["status"] == "blocked"
    states = {state["nodeId"]: state for state in data["nodeStates"]}
    assert states["multi-source-opencli"]["status"] == "blocked"
    assert states["multi-source-opencli::source-bilibili"]["status"] == "completed"
    assert states["multi-source-opencli::internal-normalize"]["blockReasons"][0]["code"] == (
        "missing_runtime_binding"
    )

    events = (await client.get("/api/v1/workflows/runs/run-events-001/events")).json()["data"]
    source_events = [
        event for event in events if event["nodeId"] == "multi-source-opencli::source-bilibili"
    ]
    assert [event["eventType"] for event in source_events] == [
        "queued",
        "started",
        "batch_ready",
        "partial",
        "completed",
    ]
    assert all(event["workflowRunId"] == "run-events-001" for event in source_events)
    assert all(event["packageNodeId"] == "multi-source-opencli" for event in source_events)
    assert all(event["internalNodeId"] == "source-bilibili" for event in source_events)

    batch_event = next(event for event in source_events if event["eventType"] == "batch_ready")
    assert batch_event["batch"]["sourceGroup"] == "video"
    assert batch_event["batch"]["itemCount"] == 0
    assert batch_event["batch"]["recordCount"] == 0
    assert batch_event["batch"]["odpRef"].startswith("odp://workflow-runs/run-events-001/")
    assert "records" not in batch_event
    assert "iii" not in batch_event["details"]

    blocked = next(
        event
        for event in events
        if event["nodeId"] == "multi-source-opencli::internal-normalize"
        and event["eventType"] == "blocked"
    )
    assert blocked["blockReason"]["source"] == "runtime_registry"
    assert blocked["blockReason"]["details"]["capability"] == "normalize"

    late = await client.get("/api/v1/workflows/runs/run-events-001")
    assert late.json()["data"]["nodeStates"] == data["nodeStates"]
    async with client.stream(
        "GET",
        "/api/v1/workflows/runs/run-events-001/events/stream",
    ) as response:
        body = (await response.aread()).decode()

    assert response.status_code == 200
    assert "event: node_event" in body
    assert "event: run_state" in body
    assert '"workflowRunId":"run-events-001"' in body
    assert '"nodeId":"multi-source-opencli::source-bilibili"' in body


@pytest.mark.asyncio
async def test_workflow_run_emits_node_failed_events_for_compile_errors(client):
    project = _multi_source_opencli_hda_project()
    del project["nodes"][0]["internals"]["nodes"][0]["adapter"]

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "packageNodeId": "multi-source-opencli",
            "runId": "run-events-004",
            "traceId": "trace-events-004",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["valid"] is False
    assert data["status"] == "failed"
    assert data["eventCount"] == 1
    failed_state = data["nodeStates"][0]
    assert failed_state["nodeId"] == "multi-source-opencli"
    assert failed_state["status"] == "failed"
    assert failed_state["latestEventId"] == "run-events-004:0001:failed:multi-source-opencli"
    assert failed_state["blockReasons"][0]["code"] == "missing_adapter_binding"
    assert "source-bilibili" in failed_state["blockReasons"][0]["message"]
    assert failed_state["blockReasons"][0]["details"]["path"] == [
        "nodes",
        "multi-source-opencli",
        "internals",
        "nodes",
        "source-bilibili",
        "adapter",
    ]

    events = (await client.get("/api/v1/workflows/runs/run-events-004/events")).json()["data"]
    assert events[0]["eventType"] == "failed"
    assert events[0]["nodeId"] == "multi-source-opencli"
