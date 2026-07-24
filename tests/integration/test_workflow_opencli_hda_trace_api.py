"""HTTP-seam tests for Multi Source OpenCLI HDA tracing."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from backend import browser_pool
from backend.channels.base import ChannelResult
from backend.models.browser import BrowserBinding, BrowserInstance
from backend.models.edge_node import EdgeNode
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.task import CollectionTask
from backend.models.workflow_run import WorkflowRun, WorkflowRunEvent
from backend.workflow.opencli_hda_tracer import _RUNS
from tests.fixtures.workflow_conformance import workflow_conformance_project
from tests.integration.test_workflow_compile_api import (
    _nested_operator_project,
    _two_operator_pipeline_project,
)


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
                    "nodeCount": 5,
                    "mode": "draft",
                    "packageInternal": True,
                },
                "internals": {
                    "nodes": [
                        {
                            "id": "source-pool",
                            "kind": "agent",
                            "capability": "normalize",
                            "params": {
                                "sourceCount": 2,
                                "sourceGroups": ["video", "social"],
                                "fanout": "parallel",
                            },
                            "ui": {"catalogId": "intelligence.source.pool"},
                        },
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
                        {
                            "id": "collection-output",
                            "kind": "inbox",
                            "capability": "store",
                            "params": {
                                "queue": "opencli-hda-output",
                                "archive": False,
                            },
                            "ui": {"catalogId": "intelligence.output.collection-result"},
                        },
                    ],
                    "edges": [
                        {
                            "id": "pool-bilibili",
                            "source": "source-pool",
                            "target": "source-bilibili",
                            "sourcePort": "out",
                            "targetPort": "in",
                        },
                        {
                            "id": "pool-xiaohongshu",
                            "source": "source-pool",
                            "target": "source-xiaohongshu",
                            "sourcePort": "out",
                            "targetPort": "in",
                        },
                        {
                            "id": "bilibili-normalize",
                            "source": "source-bilibili",
                            "target": "internal-normalize",
                            "sourcePort": "out",
                            "targetPort": "in",
                        },
                        {
                            "id": "xiaohongshu-normalize",
                            "source": "source-xiaohongshu",
                            "target": "internal-normalize",
                            "sourcePort": "out",
                            "targetPort": "in",
                        },
                        {
                            "id": "normalize-output",
                            "source": "internal-normalize",
                            "target": "collection-output",
                            "sourcePort": "out",
                            "targetPort": "in",
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


def _native_first_loop_project() -> dict:
    return {
        "id": "wf-native-first-loop",
        "name": "Native first loop",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "source-bilibili",
                "kind": "source",
                "capability": "fetch",
                "adapter": "opencli-bilibili",
                "params": {
                    "site": "bilibili",
                    "command": "search",
                    "fixtureItems": [
                        {
                            "title": "Bilibili AI video",
                            "url": "https://www.bilibili.com/video/ai",
                            "content": "AI video update",
                        }
                    ],
                },
                "ui": {"catalogId": "intelligence.source.opencli-slot"},
            },
            {
                "id": "source-xhs",
                "kind": "source",
                "capability": "fetch",
                "adapter": "opencli-xhs",
                "params": {
                    "site": "xiaohongshu",
                    "command": "search",
                    "fixtureItems": [
                        {
                            "title": "XHS AI note",
                            "url": "https://www.xiaohongshu.com/explore/ai",
                            "content": "AI note update",
                        }
                    ],
                },
                "ui": {"catalogId": "intelligence.source.opencli-slot"},
            },
            {
                "id": "normalize-bilibili",
                "kind": "agent",
                "capability": "normalize",
                "params": {"language": "zh-CN", "preserveSourceRefs": True},
                "ui": {"catalogId": "intelligence.processing.normalize"},
            },
            {
                "id": "normalize-xhs",
                "kind": "agent",
                "capability": "normalize",
                "params": {"language": "zh-CN", "preserveSourceRefs": True},
                "ui": {"catalogId": "intelligence.processing.normalize"},
            },
            {
                "id": "merge-candidates",
                "kind": "flow",
                "capability": "merge",
                "params": {
                    "strategy": "concat",
                    "preserveLineage": True,
                    "inputType": "recordCandidate[]",
                    "outputType": "recordCandidate[]",
                },
                "ui": {"catalogId": "intelligence.flow.merge"},
            },
            {
                "id": "accept-records",
                "kind": "control",
                "capability": "accept",
                "params": {
                    "mode": "automatic_with_review",
                    "schema": "record.v1",
                    "dedupe": "required",
                    "lineageRequired": True,
                    "minQuality": 0,
                },
                "ui": {"catalogId": "intelligence.control.record-acceptance"},
            },
            {
                "id": "dedupe-candidates",
                "kind": "agent",
                "capability": "dedupe",
                "params": {
                    "key": "title+source+publishedAt",
                    "window": "24h",
                },
                "ui": {"catalogId": "intelligence.processing.dedupe"},
            },
            {
                "id": "record-sink",
                "kind": "sink",
                "capability": "store",
                "params": {
                    "target": "records",
                    "writeMode": "append",
                    "preserveLineage": True,
                },
                "ui": {"catalogId": "intelligence.sink.records"},
            },
        ],
        "edges": [
            {
                "id": "e-source1-normalize",
                "source": "source-bilibili",
                "target": "normalize-bilibili",
            },
            {
                "id": "e-source2-normalize",
                "source": "source-xhs",
                "target": "normalize-xhs",
            },
            {
                "id": "e-normalize1-merge",
                "source": "normalize-bilibili",
                "target": "merge-candidates",
                "sourcePort": "out",
                "targetPort": "in1",
            },
            {
                "id": "e-normalize2-merge",
                "source": "normalize-xhs",
                "target": "merge-candidates",
                "sourcePort": "out",
                "targetPort": "in2",
            },
            {
                "id": "e-merge-dedupe",
                "source": "merge-candidates",
                "target": "dedupe-candidates",
                "sourcePort": "out",
                "targetPort": "in",
            },
            {
                "id": "e-dedupe-accept",
                "source": "dedupe-candidates",
                "target": "accept-records",
                "sourcePort": "out",
                "targetPort": "candidates",
            },
            {
                "id": "e-accept-sink",
                "source": "accept-records",
                "target": "record-sink",
                "sourcePort": "records",
                "targetPort": "records",
            },
        ],
        "adapters": [
            {
                "id": "opencli-bilibili",
                "type": "source",
                "provider": "opencli",
                "mode": "live",
                "config": {"channel": "opencli"},
            },
            {
                "id": "opencli-xhs",
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


def _legacy_canvas_intelligence_project() -> dict:
    return workflow_conformance_project(
        can_fetch_network=False,
        can_send_notifications=False,
        delivery_configured=False,
    )


async def _seed_collected_record(
    db_session,
    *,
    source_name: str,
    site: str,
    title: str,
    url: str,
    content: str,
    content_hash: str,
) -> tuple[DataSource, CollectionTask, CollectedRecord]:
    source = DataSource(
        name=source_name,
        channel_type="opencli",
        channel_config={"site": site, "command": "search"},
        enabled=True,
        tags=["workflow-test"],
    )
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(
        source_id=source.id,
        trigger_type="manual",
        parameters={"site": site, "command": "search"},
        status="completed",
    )
    db_session.add(task)
    await db_session.flush()
    record = CollectedRecord(
        task_id=task.id,
        source_id=source.id,
        raw_data={"title": title, "url": url, "content": content},
        normalized_data={
            "title": title,
            "url": url,
            "content": content,
            "source_id": source.id,
        },
        content_hash=content_hash,
        status="normalized",
    )
    db_session.add(record)
    await db_session.flush()
    return source, task, record


def _fleet_trace_opencli_catalog() -> tuple[dict, ...]:
    return (
        {
            "site": "twitter",
            "name": "search",
            "description": "X search",
            "access": "read",
            "browser": True,
            "strategy": "cookie",
            "args": [
                {
                    "name": "query",
                    "type": "str",
                    "required": True,
                    "positional": True,
                }
            ],
            "columns": ["id", "text"],
        },
    )


def _local_opencli_catalog() -> tuple[dict, ...]:
    return (
        {
            "site": "hn-live-case",
            "name": "top",
            "description": "Live Hacker News top stories",
            "access": "read",
            "browser": False,
            "strategy": "public",
            "args": [
                {
                    "name": "limit",
                    "type": "int",
                    "required": False,
                    "default": 3,
                }
            ],
            "columns": ["rank", "id", "title", "score", "author", "comments", "url"],
        },
    )


def _install_fleet_trace_pool(monkeypatch) -> None:
    pool = browser_pool.LocalBrowserPool(["http://agent-x:19823"])
    pool.set_mode("http://agent-x:19823", "bridge")
    pool.set_agent_url("http://agent-x:19823", "http://agent-x:19823")
    pool.set_agent_protocol("http://agent-x:19823", "ws")
    pool.set_node_type("http://agent-x:19823", "shell")
    monkeypatch.setattr(browser_pool, "_pool", pool)


async def _seed_fleet_trace_agent(db_session) -> None:
    db_session.add_all(
        [
            BrowserInstance(
                endpoint="http://agent-x:19823",
                mode="bridge",
                label="X desk",
                agent_url="http://agent-x:19823",
                agent_protocol="ws",
            ),
            EdgeNode(
                url="http://agent-x:19823",
                label="X desk",
                protocol="ws",
                mode="bridge",
                node_type="shell",
                status="online",
                last_seen_at=datetime.now(UTC),
                runtimes=["opencli"],
            ),
            BrowserBinding(
                site="twitter",
                browser_endpoint="http://agent-x:19823",
                notes="Logged into X",
            ),
        ]
    )
    await db_session.commit()


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
    assert first["nodePath"] == ["multi-source-opencli", "source-bilibili"]
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
            "node_path": ["multi-source-opencli", "source-bilibili"],
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
    assert data["status"] == "completed"
    states = {state["nodeId"]: state for state in data["nodeStates"]}
    assert states["multi-source-opencli"]["status"] == "completed"
    assert states["multi-source-opencli::source-bilibili"]["status"] == "completed"
    assert states["multi-source-opencli::internal-normalize"]["status"] == "completed"

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

    normalize_partial = next(
        event
        for event in events
        if event["nodeId"] == "multi-source-opencli::internal-normalize"
        and event["eventType"] == "partial"
    )
    assert normalize_partial["details"]["bindingId"] == "workflow.transform.normalize"
    assert normalize_partial["details"]["outputPort"] == "recordCandidate[]"

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
async def test_workflow_run_trace_records_fleet_match_for_opencli_source(
    client,
    db_session,
    monkeypatch,
):
    _install_fleet_trace_pool(monkeypatch)
    await _seed_fleet_trace_agent(db_session)
    monkeypatch.setattr(
        "backend.workflow.fleet_inventory.ws_agent_manager.list_connected",
        lambda: ["http://agent-x:19823"],
    )
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _fleet_trace_opencli_catalog,
    )
    dispatched = []

    async def fake_dispatch(dispatch, fleet_match):
        dispatched.append((dispatch, fleet_match))
        if dispatch.site != "twitter":
            return [], None
        return [
            {
                "id": "tweet-1",
                "text": "Agent-collected X post",
                "url": "https://x.com/example/status/1",
            }
        ], {
            "attempted": True,
            "success": True,
            "protocol": "ws",
            "agentUrl": "http://agent-x:19823",
            "endpoint": "http://agent-x:19823",
            "mode": "bridge",
            "site": "twitter",
            "command": "search",
            "format": "json",
            "itemCount": 1,
        }

    monkeypatch.setattr(
        "backend.workflow.opencli_hda_tracer._dispatch_opencli_source_to_fleet",
        fake_dispatch,
    )
    project = _multi_source_opencli_hda_project()
    twitter_source = project["nodes"][0]["internals"]["nodes"][1]
    twitter_source["params"].update(
        {
            "site": "twitter",
            "command": "search",
            "args": {"query": "ai"},
            "opencliAdapterNodeId": "opencli.adapter.twitter.search",
        }
    )

    start = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "packageNodeId": "multi-source-opencli",
            "runId": "run-events-fleet-match",
            "traceId": "trace-events-fleet-match",
        },
    )

    assert start.status_code == 202
    assert start.json()["data"]["status"] == "completed"
    events = (await client.get("/api/v1/workflows/runs/run-events-fleet-match/events")).json()[
        "data"
    ]
    source_events = [
        event for event in events if event["nodeId"] == "multi-source-opencli::source-bilibili"
    ]
    batch_ready = next(event for event in source_events if event["eventType"] == "batch_ready")
    partial = next(event for event in source_events if event["eventType"] == "partial")

    fleet_match = batch_ready["details"]["fleetMatch"]
    assert fleet_match["matched"] is True
    assert fleet_match["adapterNodeId"] == "opencli.adapter.twitter.search"
    assert fleet_match["requiresBrowser"] is True
    assert fleet_match["requiresSiteBinding"] is True
    assert fleet_match["selected"]["endpoint"] == "http://agent-x:19823"
    assert fleet_match["selected"]["agentProtocol"] == "ws"
    assert fleet_match["selected"]["missing"] == []
    assert "site_binding" in fleet_match["selected"]["reasons"]
    assert partial["details"]["fleetMatch"]["selected"] == fleet_match["selected"]
    assert batch_ready["batch"]["itemCount"] == 1
    assert batch_ready["details"]["agentDispatch"]["success"] is True
    assert batch_ready["details"]["agentDispatch"]["itemCount"] == 1
    assert batch_ready["details"]["resourceRequirement"] == {
        "nodeId": "multi-source-opencli::source-bilibili",
        "sourceGroup": "video",
        "site": "twitter",
        "mutationMode": "read",
        "requestedCapability": "opencli.twitter.search",
        "adapterNodeId": "opencli.adapter.twitter.search",
    }
    resource_resolution = batch_ready["details"]["resourceResolution"]
    assert resource_resolution["status"] == "resolved"
    assert resource_resolution["workerSlotId"] == "http://agent-x:19823"
    assert resource_resolution["profileBindingId"]
    assert resource_resolution["sessionSnapshotId"]
    assert "lockId" not in resource_resolution
    assert "cookie" not in str(resource_resolution).lower()
    assert partial["details"]["itemCount"] == 1
    assert partial["details"]["agentDispatch"]["agentUrl"] == "http://agent-x:19823"
    assert "iii" not in batch_ready["details"]
    normalize_partial = next(
        event
        for event in events
        if event["nodeId"] == "multi-source-opencli::internal-normalize"
        and event["eventType"] == "partial"
    )
    assert normalize_partial["details"]["inputItemCount"] == 1
    assert dispatched[0][0].site == "twitter"


@pytest.mark.asyncio
async def test_workflow_run_executes_non_browser_opencli_adapter_locally(
    client,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _local_opencli_catalog,
    )
    collected: list[tuple[dict, dict]] = []

    async def fake_collect(self, config, parameters):
        collected.append((config, parameters))
        return ChannelResult.ok(
            [
                {
                    "rank": 1,
                    "id": 123,
                    "title": "Live adapter result",
                    "score": 42,
                    "author": "opencli",
                    "comments": 7,
                    "url": "https://news.ycombinator.com/item?id=123",
                }
            ],
            site=config["site"],
            command=config["command"],
        )

    monkeypatch.setattr(
        "backend.channels.opencli_channel.OpenCLIChannel.collect",
        fake_collect,
    )
    project = _multi_source_opencli_hda_project()
    package = project["nodes"][0]
    package["topicCollapse"]["nodeCount"] = 6
    internals = package["internals"]
    for source in internals["nodes"][1:3]:
        source["params"].update(
            {
                "site": "hn-live-case",
                "command": "top",
                "args": {"limit": 1},
                "opencliAdapterNodeId": "opencli.adapter.hn-live-case.top",
            }
        )
    internals["nodes"][-1] = {
        "id": "accept-records",
        "kind": "control",
        "capability": "accept",
        "params": {
            "mode": "automatic_with_review",
            "schema": "record.v1",
            "dedupe": "required",
            "lineageRequired": True,
            "minQuality": 0,
        },
        "ui": {"catalogId": "intelligence.control.record-acceptance"},
    }
    internals["nodes"].append(
        {
            "id": "record-sink",
            "kind": "sink",
            "capability": "store",
            "params": {
                "target": "records",
                "writeMode": "append",
                "preserveLineage": True,
            },
            "ui": {"catalogId": "intelligence.sink.records"},
        }
    )
    internals["edges"][-1].update(
        {
            "id": "normalize-accept",
            "target": "accept-records",
            "sourcePort": "out",
            "targetPort": "candidates",
        }
    )
    internals["edges"].append(
        {
            "id": "accept-sink",
            "source": "accept-records",
            "target": "record-sink",
            "sourcePort": "records",
            "targetPort": "records",
        }
    )

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "packageNodeId": "multi-source-opencli",
            "runId": "run-local-opencli-adapter",
            "traceId": "trace-local-opencli-adapter",
        },
    )

    assert response.status_code == 202
    assert response.json()["data"]["status"] == "completed"
    events = (await client.get("/api/v1/workflows/runs/run-local-opencli-adapter/events")).json()[
        "data"
    ]
    source_partial = next(
        event
        for event in events
        if event["nodeId"] == "multi-source-opencli::source-bilibili"
        and event["eventType"] == "partial"
    )
    assert source_partial["message"] == ("OpenCLI source items collected through local OpenCLI")
    assert source_partial["details"]["itemCount"] == 1
    assert source_partial["details"]["agentDispatch"] == {
        "attempted": True,
        "success": True,
        "protocol": "local",
        "endpoint": "local-opencli",
        "mode": "direct",
        "site": "hn-live-case",
        "command": "top",
        "format": "json",
        "itemCount": 1,
        "metadata": {"site": "hn-live-case", "command": "top"},
    }
    normalize_partial = next(
        event
        for event in events
        if event["nodeId"] == "multi-source-opencli::internal-normalize"
        and event["eventType"] == "partial"
    )
    assert normalize_partial["details"]["inputItemCount"] == 2
    sink_partial = next(
        event
        for event in events
        if event["nodeId"] == "multi-source-opencli::record-sink"
        and event["eventType"] == "partial"
    )
    assert sink_partial["details"]["inputRecordCount"] == 2
    assert sink_partial["details"]["storedRecordCount"] == 2
    assert {ref["lineage"][0]["artifact"] for ref in sink_partial["details"]["storedRefs"]} == {
        "opencliDispatch"
    }
    records = (
        (await db_session.execute(select(CollectedRecord).order_by(CollectedRecord.created_at)))
        .scalars()
        .all()
    )
    assert len(records) == 2
    assert {record.normalized_data["title"] for record in records} == {"Live adapter result"}
    assert {record.raw_data["_workflowLineage"][0]["nodeId"] for record in records} == {
        "multi-source-opencli::source-bilibili",
        "multi-source-opencli::source-xiaohongshu",
    }
    assert collected == [
        (
            {
                "site": "hn-live-case",
                "command": "top",
                "args": {"limit": 1},
                "positional_args": [],
                "format": "json",
            },
            {},
        ),
        (
            {
                "site": "hn-live-case",
                "command": "top",
                "args": {"limit": 1},
                "positional_args": [],
                "format": "json",
            },
            {},
        ),
    ]


@pytest.mark.asyncio
async def test_workflow_run_blocks_missing_opencli_profile_resource(
    client,
    monkeypatch,
):
    _install_fleet_trace_pool(monkeypatch)
    monkeypatch.setattr(
        "backend.workflow.fleet_inventory.ws_agent_manager.list_connected",
        lambda: ["http://agent-x:19823"],
    )
    monkeypatch.setattr(
        "backend.workflow.opencli_adapter_nodes._load_opencli_catalog",
        _fleet_trace_opencli_catalog,
    )
    dispatched = []

    async def fake_dispatch(dispatch, fleet_match):
        dispatched.append(dispatch.nodeId)
        return [], None

    monkeypatch.setattr(
        "backend.workflow.opencli_hda_tracer._dispatch_opencli_source_to_fleet",
        fake_dispatch,
    )
    project = _multi_source_opencli_hda_project()
    source = project["nodes"][0]["internals"]["nodes"][1]
    source["params"].update(
        {
            "site": "twitter",
            "command": "search",
            "opencliAdapterNodeId": "opencli.adapter.twitter.search",
        }
    )

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "packageNodeId": "multi-source-opencli",
            "runId": "run-missing-profile-resource",
            "traceId": "trace-missing-profile-resource",
        },
    )

    assert response.status_code == 202
    events = (
        await client.get(
            "/api/v1/workflows/runs/run-missing-profile-resource/events"
        )
    ).json()["data"]
    blocked = next(
        event
        for event in events
        if event["nodeId"] == "multi-source-opencli::source-bilibili"
        and event["eventType"] == "blocked"
    )
    assert blocked["blockReason"]["code"] == "missing_profile_binding"
    assert blocked["blockReason"]["source"] == "workflow_runtime_resources"
    assert blocked["details"]["resourceResolution"]["status"] == "blocked"
    assert blocked["details"]["resourceRequirement"]["site"] == "twitter"
    assert "multi-source-opencli::source-bilibili" not in dispatched


@pytest.mark.asyncio
async def test_workflow_run_emits_native_first_loop_trace_events(client, db_session):
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _native_first_loop_project(),
            "runId": "run-native-first-loop",
            "traceId": "trace-native-first-loop",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["status"] == "completed"
    states = {state["nodeId"]: state for state in data["nodeStates"]}
    assert states["normalize-bilibili"]["status"] == "completed"
    assert states["merge-candidates"]["status"] == "completed"
    assert states["dedupe-candidates"]["status"] == "completed"
    assert states["accept-records"]["status"] == "completed"
    assert states["record-sink"]["status"] == "completed"

    events = (await client.get("/api/v1/workflows/runs/run-native-first-loop/events")).json()[
        "data"
    ]
    by_node = {}
    for event in events:
        by_node.setdefault(event["nodeId"], []).append(event)

    assert [event["eventType"] for event in by_node["merge-candidates"]] == [
        "queued",
        "started",
        "partial",
        "completed",
    ]
    merge_partial = by_node["merge-candidates"][2]
    assert merge_partial["details"]["bindingId"] == "workflow.flow.merge"
    assert merge_partial["details"]["strategy"] == "concat"
    assert merge_partial["details"]["preserveLineage"] is True
    assert merge_partial["details"]["inputCandidateCount"] == 2
    assert merge_partial["details"]["mergedCandidateCount"] == 2
    assert merge_partial["details"]["lineage"]["dependsOn"] == [
        "normalize-bilibili",
        "normalize-xhs",
    ]

    dedupe_partial = by_node["dedupe-candidates"][2]
    assert dedupe_partial["details"]["bindingId"] == "workflow.transform.dedupe"
    assert dedupe_partial["details"]["key"] == "title+source+publishedAt"
    assert dedupe_partial["details"]["window"] == "24h"
    assert dedupe_partial["details"]["inputCandidateCount"] == 2
    assert dedupe_partial["details"]["deduplicatedCandidateCount"] == 2
    assert dedupe_partial["details"]["rejectedCount"] == 0

    gate_partial = by_node["accept-records"][2]
    assert gate_partial["details"]["bindingId"] == "workflow.gate.record-acceptance"
    assert gate_partial["details"]["schema"] == "record.v1"
    assert gate_partial["details"]["lineageRequired"] is True
    assert gate_partial["details"]["inputCandidateCount"] == 2
    assert gate_partial["details"]["acceptedRecordCount"] == 2
    assert gate_partial["details"]["reviewRequiredCount"] == 0

    sink_partial = by_node["record-sink"][2]
    assert sink_partial["details"]["bindingId"] == "workflow.record-sink.records"
    assert sink_partial["details"]["target"] == "records"
    assert sink_partial["details"]["inputRecordCount"] == 2
    assert sink_partial["details"]["storedRecordCount"] == 2
    assert len(sink_partial["details"]["storedRefs"]) == 2
    assert sink_partial["details"]["storedRefs"][0]["target"] == "records"
    assert sink_partial["details"]["storedRefs"][0]["lineage"][0]["nodeId"] == ("source-bilibili")

    records = (
        (await db_session.execute(select(CollectedRecord).order_by(CollectedRecord.created_at)))
        .scalars()
        .all()
    )
    assert len(records) == 2
    assert {record.normalized_data["title"] for record in records} == {
        "Bilibili AI video",
        "XHS AI note",
    }
    assert {record.status for record in records} == {"normalized"}
    assert {record.raw_data["_workflowLineage"][0]["nodeId"] for record in records} == {
        "source-bilibili",
        "source-xhs",
    }

    tasks = (
        (await db_session.execute(select(CollectionTask).order_by(CollectionTask.created_at)))
        .scalars()
        .all()
    )
    assert len(tasks) == 2
    assert {task.trigger_type for task in tasks} == {"workflow"}
    assert {task.status for task in tasks} == {"completed"}
    assert {task.parameters["workflowRunId"] for task in tasks} == {"run-native-first-loop"}


@pytest.mark.asyncio
async def test_workflow_run_moves_data_between_operator_implementation_boundaries(client):
    project = _two_operator_pipeline_project()
    project["nodes"].reverse()
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-operator-boundaries",
            "traceId": "trace-operator-boundaries",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["status"] == "completed"
    states = {state["nodeId"]: state for state in data["nodeStates"]}
    clean_node_id = "clean-operator::clean-implementation"
    assert states[clean_node_id]["status"] == "completed"
    assert states[clean_node_id]["nodePath"] == [
        "clean-operator",
        "clean-implementation",
    ]
    assert states[clean_node_id]["packageNodeId"] == "clean-operator"
    assert states[clean_node_id]["internalNodeId"] == "clean-implementation"

    events = (
        await client.get("/api/v1/workflows/runs/run-operator-boundaries/events")
    ).json()["data"]
    by_node: dict[str, list[dict]] = {}
    for event in events:
        by_node.setdefault(event["nodeId"], []).append(event)

    assert [event["eventType"] for event in by_node["collect-operator"]] == [
        "queued",
        "started",
        "completed",
    ]
    assert [event["eventType"] for event in by_node["clean-operator"]] == [
        "queued",
        "started",
        "completed",
    ]
    clean_partial = by_node[clean_node_id][2]
    assert clean_partial["eventType"] == "partial"
    assert clean_partial["details"]["inputItemCount"] == 1
    assert clean_partial["details"]["lineage"]["dependsOn"] == [
        "collect-operator::collect-implementation"
    ]


@pytest.mark.asyncio
async def test_workflow_run_locates_four_level_implementation_events(client):
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _nested_operator_project(depth=4),
            "runId": "run-four-level-path",
            "traceId": "trace-four-level-path",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["status"] == "completed"
    leaf_id = (
        "level-1-operator::level-2-package::level-3-package::level-4-implementation"
    )
    leaf_state = next(state for state in data["nodeStates"] if state["nodeId"] == leaf_id)
    assert leaf_state["nodePath"] == [
        "level-1-operator",
        "level-2-package",
        "level-3-package",
        "level-4-implementation",
    ]
    assert leaf_state["packageNodeId"] == (
        "level-1-operator::level-2-package::level-3-package"
    )
    assert leaf_state["internalNodeId"] == "level-4-implementation"

    events = (
        await client.get("/api/v1/workflows/runs/run-four-level-path/events")
    ).json()["data"]
    leaf_events = [event for event in events if event["nodeId"] == leaf_id]
    assert [event["eventType"] for event in leaf_events] == [
        "queued",
        "started",
        "partial",
        "completed",
    ]
    assert all(event["nodePath"] == leaf_state["nodePath"] for event in leaf_events)


@pytest.mark.asyncio
async def test_workflow_run_resolves_legacy_canvas_runtime_bindings(client, db_session):
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _legacy_canvas_intelligence_project(),
            "runId": "run-legacy-canvas-bindings",
            "traceId": "trace-legacy-canvas-bindings",
            "sourceOutputs": {
                "source-jin10": [
                    {
                        "title": "Important macro flash",
                        "url": "https://www.jin10.com/flash/important",
                        "important": True,
                        "score": 0.91,
                    },
                    {
                        "title": "Low priority flash",
                        "url": "https://www.jin10.com/flash/low",
                        "important": False,
                        "score": 0.2,
                    },
                ],
            },
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["status"] == "blocked"
    states = {state["nodeId"]: state for state in data["nodeStates"]}
    assert states["source-jin10"]["status"] == "completed"
    assert states["agent-normalize"]["status"] == "completed"
    assert states["router-importance"]["status"] == "completed"
    assert states["inbox-review"]["status"] == "completed"
    assert states["notify-preview"]["status"] == "blocked"
    assert states["notify-preview"]["blockReasons"][0]["code"] == "send_permission_required"
    assert all(
        reason["code"] != "missing_runtime_binding"
        for state in data["nodeStates"]
        for reason in state["blockReasons"]
    )

    events = (
        await client.get("/api/v1/workflows/runs/run-legacy-canvas-bindings/events")
    ).json()["data"]
    by_node = {}
    for event in events:
        by_node.setdefault(event["nodeId"], []).append(event)

    source_partial = by_node["source-jin10"][2]
    assert source_partial["details"]["itemCount"] == 2
    assert source_partial["details"]["outputPort"] == "items[]"

    router_partial = by_node["router-importance"][2]
    assert router_partial["details"]["bindingId"] == "workflow.router.route"
    assert router_partial["details"]["inputCandidateCount"] == 2
    assert router_partial["details"]["routedCandidateCount"] == 1

    inbox_partial = by_node["inbox-review"][2]
    assert inbox_partial["details"]["bindingId"] == "workflow.inbox.store"
    assert inbox_partial["details"]["target"] == "macro-watch"
    assert inbox_partial["details"]["inputRecordCount"] == 1
    assert inbox_partial["details"]["storedRecordCount"] == 1

    notify_events = by_node["notify-preview"]
    assert [event["eventType"] for event in notify_events] == [
        "queued",
        "started",
        "blocked",
    ]
    assert notify_events[-1]["blockReason"]["details"]["bindingId"] == (
        "workflow.notify.send"
    )

    records = (
        (await db_session.execute(select(CollectedRecord).order_by(CollectedRecord.created_at)))
        .scalars()
        .all()
    )
    assert len(records) == 1
    assert records[0].normalized_data["title"] == "Important macro flash"
    assert records[0].raw_data["_workflowRunId"] == "run-legacy-canvas-bindings"
    assert records[0].raw_data["_workflowSinkNodeId"] == "inbox-review"


@pytest.mark.asyncio
async def test_workflow_run_loads_bound_source_task_records_as_items(client, db_session):
    _bili_source, bili_task, _bili_record = await _seed_collected_record(
        db_session,
        source_name="Bilibili bound source",
        site="bilibili",
        title="Bound Bilibili AI video",
        url="https://www.bilibili.com/video/bound-ai",
        content="Bound AI video update",
        content_hash="seed-bilibili-bound",
    )
    _xhs_source, xhs_task, _xhs_record = await _seed_collected_record(
        db_session,
        source_name="XHS bound source",
        site="xiaohongshu",
        title="Bound XHS AI note",
        url="https://www.xiaohongshu.com/explore/bound-ai",
        content="Bound AI note update",
        content_hash="seed-xhs-bound",
    )
    project = _native_first_loop_project()
    source_bilibili = next(node for node in project["nodes"] if node["id"] == "source-bilibili")
    source_xhs = next(node for node in project["nodes"] if node["id"] == "source-xhs")
    source_bilibili["params"].pop("fixtureItems")
    source_xhs["params"].pop("fixtureItems")
    source_bilibili["params"]["taskId"] = bili_task.id
    source_xhs["params"]["taskId"] = xhs_task.id

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-bound-source-records",
            "traceId": "trace-bound-source-records",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["status"] == "completed"

    events = (await client.get("/api/v1/workflows/runs/run-bound-source-records/events")).json()[
        "data"
    ]
    by_node = {}
    for event in events:
        by_node.setdefault(event["nodeId"], []).append(event)

    source_partial = by_node["source-bilibili"][2]
    assert source_partial["message"] == "Bound source records loaded as workflow items"
    assert source_partial["details"]["taskId"] == bili_task.id
    assert source_partial["details"]["itemCount"] == 1
    assert by_node["normalize-bilibili"][2]["details"]["inputItemCount"] == 1
    assert by_node["merge-candidates"][2]["details"]["mergedCandidateCount"] == 2
    assert by_node["record-sink"][2]["details"]["storedRecordCount"] == 2
    assert (
        by_node["record-sink"][2]["details"]["storedRefs"][0]["lineage"][0]["artifact"]
        == "collected_records"
    )

    records = (
        (
            await db_session.execute(
                select(CollectedRecord).order_by(CollectedRecord.created_at, CollectedRecord.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(records) == 4
    workflow_record_run_ids = {
        record.raw_data.get("_workflowRunId")
        for record in records
        if "_workflowRunId" in record.raw_data
    }
    assert workflow_record_run_ids == {"run-bound-source-records"}


@pytest.mark.asyncio
async def test_workflow_run_uses_runtime_source_outputs_as_items(client, db_session):
    project = _native_first_loop_project()
    for node in project["nodes"]:
        if node["id"] in {"source-bilibili", "source-xhs"}:
            node["params"].pop("fixtureItems")

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-runtime-source-outputs",
            "traceId": "trace-runtime-source-outputs",
            "sourceOutputs": {
                "source-bilibili": [
                    {
                        "title": "Runtime Bilibili AI video",
                        "url": "https://www.bilibili.com/video/runtime-ai",
                        "content": "Runtime AI video update",
                    }
                ],
                "source-xhs": [
                    {
                        "title": "Runtime XHS AI note",
                        "url": "https://www.xiaohongshu.com/explore/runtime-ai",
                        "content": "Runtime AI note update",
                    }
                ],
            },
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["status"] == "completed"
    events = (await client.get("/api/v1/workflows/runs/run-runtime-source-outputs/events")).json()[
        "data"
    ]
    by_node = {}
    for event in events:
        by_node.setdefault(event["nodeId"], []).append(event)

    source_partial = by_node["source-bilibili"][2]
    assert source_partial["message"] == "Runtime source output loaded as workflow items"
    assert source_partial["details"]["itemCount"] == 1
    assert by_node["merge-candidates"][2]["details"]["mergedCandidateCount"] == 2
    sink_partial = by_node["record-sink"][2]
    assert sink_partial["details"]["storedRecordCount"] == 2
    assert sink_partial["details"]["storedRefs"][0]["lineage"][0]["artifact"] == ("sourceOutputs")

    records = (
        (
            await db_session.execute(
                select(CollectedRecord).order_by(CollectedRecord.created_at, CollectedRecord.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(records) == 2
    assert {record.normalized_data["title"] for record in records} == {
        "Runtime Bilibili AI video",
        "Runtime XHS AI note",
    }


@pytest.mark.asyncio
async def test_workflow_run_continues_with_late_source_outputs(client, db_session):
    project = _native_first_loop_project()
    for node in project["nodes"]:
        if node["id"] in {"source-bilibili", "source-xhs"}:
            node["params"].pop("fixtureItems")

    initial = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-late-source-outputs",
            "traceId": "trace-late-source-outputs",
        },
    )

    assert initial.status_code == 202
    initial_data = initial.json()["data"]
    assert initial_data["status"] == "completed"
    initial_event_count = initial_data["eventCount"]
    initial_records = (await db_session.execute(select(CollectedRecord))).scalars().all()
    assert initial_records == []

    continued = await client.post(
        "/api/v1/workflows/runs/run-late-source-outputs/source-outputs",
        json={
            "sourceOutputs": {
                "source-bilibili": [
                    {
                        "title": "Late Bilibili AI video",
                        "url": "https://www.bilibili.com/video/late-ai",
                        "content": "Late AI video update",
                    }
                ],
                "source-xhs": [
                    {
                        "title": "Late XHS AI note",
                        "url": "https://www.xiaohongshu.com/explore/late-ai",
                        "content": "Late AI note update",
                    }
                ],
            }
        },
    )

    assert continued.status_code == 202
    continued_data = continued.json()["data"]
    assert continued_data["status"] == "completed"
    assert continued_data["eventCount"] > initial_event_count

    events = (await client.get("/api/v1/workflows/runs/run-late-source-outputs/events")).json()[
        "data"
    ]
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    late_source_events = [
        event
        for event in events
        if event["nodeId"] == "source-bilibili"
        and event["message"] == "Runtime source output loaded as workflow items"
    ]
    assert len(late_source_events) == 1
    assert late_source_events[0]["sequence"] > initial_event_count

    records = (
        (
            await db_session.execute(
                select(CollectedRecord).order_by(CollectedRecord.created_at, CollectedRecord.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(records) == 2
    assert {record.normalized_data["title"] for record in records} == {
        "Late Bilibili AI video",
        "Late XHS AI note",
    }


@pytest.mark.asyncio
async def test_workflow_run_trace_persists_and_recovers_without_memory_cache(client, db_session):
    project = _native_first_loop_project()
    for node in project["nodes"]:
        if node["id"] in {"source-bilibili", "source-xhs"}:
            node["params"].pop("fixtureItems")

    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-persisted-trace",
            "traceId": "trace-persisted-trace",
            "sourceOutputs": {
                "source-bilibili": [
                    {
                        "title": "Persisted Bilibili AI video",
                        "url": "https://www.bilibili.com/video/persisted-ai",
                        "content": "Persisted AI video update",
                    }
                ],
                "source-xhs": [
                    {
                        "title": "Persisted XHS AI note",
                        "url": "https://www.xiaohongshu.com/explore/persisted-ai",
                        "content": "Persisted AI note update",
                    }
                ],
            },
        },
    )
    assert started.status_code == 202
    started_projection = started.json()["data"]

    persisted_run = await db_session.get(WorkflowRun, "run-persisted-trace")
    assert persisted_run is not None
    assert persisted_run.request["traceId"] == "trace-persisted-trace"
    assert persisted_run.projection["eventCount"] == started_projection["eventCount"]
    persisted_events = (
        (
            await db_session.execute(
                select(WorkflowRunEvent)
                .where(WorkflowRunEvent.run_id == "run-persisted-trace")
                .order_by(WorkflowRunEvent.sequence)
            )
        )
        .scalars()
        .all()
    )
    assert len(persisted_events) == started_projection["eventCount"]
    assert persisted_events[0].event_id == "run-persisted-trace:0001:queued:source-bilibili"

    _RUNS.pop("run-persisted-trace", None)

    recovered = await client.get("/api/v1/workflows/runs/run-persisted-trace")
    assert recovered.status_code == 200
    assert recovered.json()["data"] == started_projection

    recovered_events = await client.get("/api/v1/workflows/runs/run-persisted-trace/events")
    assert recovered_events.status_code == 200
    assert len(recovered_events.json()["data"]) == started_projection["eventCount"]

    _RUNS.pop("run-persisted-trace", None)
    continued = await client.post(
        "/api/v1/workflows/runs/run-persisted-trace/source-outputs",
        json={
            "sourceOutputs": {
                "source-bilibili": [
                    {
                        "title": "Persisted continuation",
                        "url": "https://www.bilibili.com/video/persisted-continuation",
                        "content": "Continuation update",
                    }
                ]
            }
        },
    )
    assert continued.status_code == 202
    continued_projection = continued.json()["data"]
    assert continued_projection["traceId"] == "trace-persisted-trace"
    assert continued_projection["eventCount"] > started_projection["eventCount"]

    continued_events = (
        (
            await db_session.execute(
                select(WorkflowRunEvent)
                .where(WorkflowRunEvent.run_id == "run-persisted-trace")
                .order_by(WorkflowRunEvent.sequence)
            )
        )
        .scalars()
        .all()
    )
    assert [event.sequence for event in continued_events] == list(
        range(1, continued_projection["eventCount"] + 1)
    )
    assert any(
        event.payload["message"] == "Runtime source output loaded as workflow items"
        and event.sequence > started_projection["eventCount"]
        for event in continued_events
    )


@pytest.mark.asyncio
async def test_workflow_run_checkpoint_and_trace_query_resume_cursor(client):
    project = _native_first_loop_project()
    for node in project["nodes"]:
        if node["id"] in {"source-bilibili", "source-xhs"}:
            node["params"].pop("fixtureItems")

    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "runId": "run-checkpoint-query",
            "traceId": "trace-checkpoint-query",
            "sourceOutputs": {
                "source-bilibili": [
                    {
                        "title": "Checkpoint Bilibili AI video",
                        "url": "https://www.bilibili.com/video/checkpoint-ai",
                        "content": "Checkpoint AI video update",
                    }
                ],
                "source-xhs": [
                    {
                        "title": "Checkpoint XHS AI note",
                        "url": "https://www.xiaohongshu.com/explore/checkpoint-ai",
                        "content": "Checkpoint AI note update",
                    }
                ],
            },
        },
    )
    assert started.status_code == 202
    started_projection = started.json()["data"]
    _RUNS.pop("run-checkpoint-query", None)

    checkpoint_response = await client.get("/api/v1/workflows/runs/run-checkpoint-query/checkpoint")
    assert checkpoint_response.status_code == 200
    checkpoint = checkpoint_response.json()["data"]
    assert checkpoint["checkpointId"] == (
        f"run-checkpoint-query:{started_projection['eventCount']:04d}"
    )
    assert checkpoint["lastSequence"] == started_projection["eventCount"]
    assert checkpoint["sourceOutputNodeIds"] == ["source-bilibili", "source-xhs"]
    assert checkpoint["sourceOutputItemCount"] == 2
    assert checkpoint["canContinueWithSourceOutputs"] is True
    assert checkpoint["continuationPath"] == (
        "/api/v1/workflows/runs/run-checkpoint-query/source-outputs"
    )

    trace_response = await client.get(
        "/api/v1/workflows/runs/run-checkpoint-query/trace",
        params={"afterSequence": 4, "nodeId": "source-xhs", "limit": 2},
    )
    assert trace_response.status_code == 200
    trace = trace_response.json()["data"]
    assert trace["projection"] == started_projection
    assert trace["checkpoint"] == checkpoint
    assert trace["filters"] == {
        "afterSequence": 4,
        "nodeId": "source-xhs",
        "eventType": None,
        "limit": 2,
    }
    assert [event["nodeId"] for event in trace["events"]] == ["source-xhs", "source-xhs"]
    trace_sequences = [event["sequence"] for event in trace["events"]]
    assert trace_sequences == sorted(trace_sequences)
    assert all(sequence > 4 for sequence in trace_sequences)
    assert trace["nextAfterSequence"] == trace_sequences[-1]

    partial_events = await client.get(
        "/api/v1/workflows/runs/run-checkpoint-query/events",
        params={"eventType": "partial", "limit": 3},
    )
    assert partial_events.status_code == 200
    partial_data = partial_events.json()["data"]
    assert len(partial_data) == 3
    assert {event["eventType"] for event in partial_data} == {"partial"}


@pytest.mark.asyncio
async def test_workflow_run_blocks_webhook_notify_until_projection_delivery(client):
    project = _multi_source_opencli_hda_project()
    project["adapters"].append(
        {
            "id": "webhook-notifier",
            "type": "notification",
            "provider": "webhook",
            "mode": "webhook",
            "config": {"notifierType": "webhook", "target": "webhook"},
        }
    )
    project["nodes"].append(
        {
            "id": "notify-webhook",
            "kind": "notify",
            "capability": "send",
            "adapter": "webhook-notifier",
            "params": {"template": "brief", "target": "webhook"},
            "ui": {"catalogId": "intelligence.output.webhook"},
        }
    )
    project["edges"].append(
        {
            "id": "e-hda-notify",
            "source": "multi-source-opencli",
            "target": "notify-webhook",
        }
    )

    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": project,
            "packageNodeId": "multi-source-opencli",
            "runId": "run-events-webhook",
            "traceId": "trace-events-webhook",
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    states = {state["nodeId"]: state for state in data["nodeStates"]}
    assert states["notify-webhook"]["status"] == "blocked"
    assert states["notify-webhook"]["blockReasons"][0]["code"] == ("missing_delivery_projection")

    events = (await client.get("/api/v1/workflows/runs/run-events-webhook/events")).json()["data"]
    notify_events = [event for event in events if event["nodeId"] == "notify-webhook"]
    assert [event["eventType"] for event in notify_events] == [
        "queued",
        "blocked",
    ]
    assert notify_events[-1]["blockReason"]["details"]["required_params"] == [
        "evidencebatch_projection_api",
        "delivery_projection",
        "webhook_url",
    ]


@pytest.mark.asyncio
async def test_workflow_run_emits_node_failed_events_for_compile_errors(client):
    project = _multi_source_opencli_hda_project()
    source_bilibili = next(
        node
        for node in project["nodes"][0]["internals"]["nodes"]
        if node["id"] == "source-bilibili"
    )
    del source_bilibili["adapter"]

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
    assert failed_state["nodeId"] == "multi-source-opencli::source-bilibili"
    assert failed_state["nodePath"] == ["multi-source-opencli", "source-bilibili"]
    assert failed_state["packageNodeId"] == "multi-source-opencli"
    assert failed_state["internalNodeId"] == "source-bilibili"
    assert failed_state["status"] == "failed"
    assert failed_state["latestEventId"] == (
        "run-events-004:0001:failed:multi-source-opencli::source-bilibili"
    )
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
    assert events[0]["nodeId"] == "multi-source-opencli::source-bilibili"
    assert events[0]["nodePath"] == ["multi-source-opencli", "source-bilibili"]
