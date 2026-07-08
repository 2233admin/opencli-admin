"""Integration (HTTP-seam) tests for POST /api/v1/plans/{plan_id}/run
(issue 03 — manual whole-plan run endpoint).

Mirrors the existing tests/integration/test_tasks_api.py convention:
run_collection_pipeline is patched at the module boundary
(backend.pipeline.runner.run_collection_pipeline) rather than mocking
anything inside backend.plan_ir.executor — proving the HTTP endpoint really
walks router -> plan_service -> run_plan_once -> task_service.create_task
-> run_collection_pipeline, the same dispatch chain
backend.api.v1.tasks.trigger_task already exercises for a direct trigger.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.schemas.plan_ir import PLAN_IR_VERSION


def _source_node(node_id="n1", source_id="src-1"):
    return {
        "id": node_id,
        "kind": "source",
        "type": "rss_source",
        "label": "Source",
        "params": {},
        "source_id": source_id,
        "outputs": [{"name": "records", "type": "records"}],
    }


def _draft_source_node(node_id="n1"):
    return {
        "id": node_id,
        "kind": "source",
        "type": "rss_source",
        "label": "Draft source",
        "params": {},
        "draft": True,
        "outputs": [{"name": "records", "type": "records"}],
    }


def _sink_node(node_id="n2"):
    return {
        "id": node_id,
        "kind": "sink",
        "type": "collection_store",
        "label": "Sink",
        "params": {},
        "inputs": [{"name": "records", "type": "records"}],
    }


def _edge(edge_id, src, tgt):
    return {
        "id": edge_id,
        "source_node": src,
        "source_port": "records",
        "target_node": tgt,
        "target_port": "records",
    }


def _degenerate_graph(source_id):
    return {
        "ir_version": PLAN_IR_VERSION,
        "name": "Degenerate plan",
        "nodes": [_source_node(source_id=source_id), _sink_node()],
        "edges": [_edge("e1", "n1", "n2")],
    }


def _draft_graph():
    return {
        "ir_version": PLAN_IR_VERSION,
        "name": "Draft plan",
        "nodes": [_draft_source_node(), _sink_node()],
        "edges": [_edge("e1", "n1", "n2")],
    }


def _no_source_graph():
    return {
        "ir_version": PLAN_IR_VERSION,
        "name": "No sources",
        "nodes": [_sink_node("n1")],
        "edges": [],
    }


async def _create_source(client, **overrides) -> str:
    data = {
        "name": "Test RSS Source",
        "channel_type": "rss",
        "channel_config": {"feed_url": "https://example.com/feed.xml"},
        "enabled": True,
        **overrides,
    }
    resp = await client.post("/api/v1/sources", json=data)
    assert resp.status_code == 201
    return resp.json()["data"]["id"]


async def _create_plan(client, graph: dict, name="P1") -> str:
    resp = await client.post("/api/v1/plans", json={"name": name, "graph": graph})
    assert resp.status_code == 201
    return resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_run_plan_not_found(client):
    response = await client.post("/api/v1/plans/nonexistent/run", json={})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_run_draft_plan_refused(client):
    plan_id = await _create_plan(client, _draft_graph())

    response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})
    assert response.status_code == 400
    assert "draft" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_run_non_runnable_plan_refused(client):
    plan_id = await _create_plan(client, _no_source_graph())

    response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})
    assert response.status_code == 400
    assert "not runnable" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_run_multi_source_plan_refused(client):
    source_id_1 = await _create_source(client, name="S1")
    source_id_2 = await _create_source(client, name="S2")
    graph = {
        "ir_version": PLAN_IR_VERSION,
        "name": "Multi-source",
        "nodes": [
            _source_node("n1", source_id=source_id_1),
            _source_node("n2", source_id=source_id_2),
            _sink_node("n3"),
        ],
        "edges": [_edge("e1", "n1", "n3"), _edge("e2", "n2", "n3")],
    }
    plan_id = await _create_plan(client, graph)

    response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})
    assert response.status_code == 400
    assert "source node" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_run_degenerate_plan_success(client):
    source_id = await _create_source(client)
    plan_id = await _create_plan(client, _degenerate_graph(source_id))

    fake_result = {
        "task_id": "ignored",
        "run_id": "run-xyz",
        "success": True,
        "collected": 4,
        "stored": 4,
        "skipped": 0,
        "error": None,
    }

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(return_value=fake_result),
    ):
        response = await client.post(
            f"/api/v1/plans/{plan_id}/run", json={"limit": 5}
        )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["plan_id"] == plan_id
    assert data["source_id"] == source_id
    assert "task_id" in data
    assert data["run_id"] == "run-xyz"
    assert data["success"] is True
    assert data["stored"] == 4


@pytest.mark.asyncio
async def test_run_degenerate_plan_disabled_source_refused(client):
    source_id = await _create_source(client, enabled=False)
    plan_id = await _create_plan(client, _degenerate_graph(source_id))

    response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})
    assert response.status_code == 400
    assert "disabled" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_run_degenerate_plan_error_propagates_as_400(client):
    """A hard failure surfaced by run_collection_pipeline (e.g. its own task
    bookkeeping failed) is not swallowed into a fake 202 success."""
    source_id = await _create_source(client)
    plan_id = await _create_plan(client, _degenerate_graph(source_id))

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(return_value={"error": "boom"}),
    ):
        response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})

    assert response.status_code == 400
    assert "boom" in response.json()["detail"]


@pytest.mark.asyncio
async def test_run_plan_creates_real_task_run_via_existing_task_endpoints(client):
    """After a successful plan run, GET /tasks/{task_id}/runs shows a real
    CollectionTask/TaskRun the same way a direct /tasks/trigger would —
    the plan-run endpoint didn't fabricate a response, it created rows
    through the existing task/runner machinery."""
    source_id = await _create_source(client)
    plan_id = await _create_plan(client, _degenerate_graph(source_id))

    fake_result = {
        "task_id": "ignored",
        "run_id": "run-1",
        "success": True,
        "collected": 1,
        "stored": 1,
        "skipped": 0,
        "error": None,
    }

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(return_value=fake_result),
    ):
        run_resp = await client.post(f"/api/v1/plans/{plan_id}/run", json={})

    assert run_resp.status_code == 202
    task_id = run_resp.json()["data"]["task_id"]

    task_resp = await client.get(f"/api/v1/tasks/{task_id}")
    assert task_resp.status_code == 200
    assert task_resp.json()["data"]["source_id"] == source_id
    assert task_resp.json()["data"]["trigger_type"] == "plan"

    tasks_list_resp = await client.get(f"/api/v1/tasks?source_id={source_id}")
    assert tasks_list_resp.json()["meta"]["total"] == 1
