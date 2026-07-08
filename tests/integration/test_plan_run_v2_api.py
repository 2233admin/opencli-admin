"""Integration (HTTP-seam) tests for issue 04: multi-source Plan run via
POST /api/v1/plans/{plan_id}/run, and GET /api/v1/plans/{plan_id}/health
(Plan Health read endpoint).

Mirrors tests/integration/test_plan_run_api.py's convention:
run_collection_pipeline is patched at the module boundary so the HTTP
endpoint really walks router -> plan_service -> run_plan_once -> the shared
segment, not a stubbed executor.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.models.record import CollectedRecord
from backend.models.task import CollectionTask
from backend.schemas.plan_ir import PLAN_IR_VERSION


def _source_node(node_id, source_id):
    return {
        "id": node_id,
        "kind": "source",
        "type": "rss_source",
        "label": "Source",
        "params": {},
        "source_id": source_id,
        "outputs": [{"name": "records", "type": "records"}],
    }


def _merge_node(node_id="merge1"):
    return {
        "id": node_id,
        "kind": "merge",
        "type": "merge",
        "label": "Merge",
        "params": {},
        "inputs": [
            {"name": "in1", "type": "records"},
            {"name": "in2", "type": "records"},
        ],
        "outputs": [{"name": "records", "type": "records"}],
    }


def _dedupe_node(node_id="dedupe1"):
    return {
        "id": node_id,
        "kind": "transform",
        "type": "dedupe",
        "label": "Dedupe",
        "params": {},
        "inputs": [{"name": "records", "type": "records"}],
        "outputs": [{"name": "records", "type": "records"}],
    }


def _sink_node(node_id="sink1"):
    return {
        "id": node_id,
        "kind": "sink",
        "type": "collection_store",
        "label": "Sink",
        "params": {},
        "inputs": [{"name": "records", "type": "records"}],
    }


def _edge(edge_id, src, src_port, tgt, tgt_port):
    return {
        "id": edge_id,
        "source_node": src,
        "source_port": src_port,
        "target_node": tgt,
        "target_port": tgt_port,
    }


def _two_source_graph(src1, src2):
    return {
        "ir_version": PLAN_IR_VERSION,
        "name": "Two-source shared segment",
        "nodes": [
            _source_node("n1", src1),
            _source_node("n2", src2),
            _merge_node(),
            _dedupe_node(),
            _sink_node(),
        ],
        "edges": [
            _edge("e1", "n1", "records", "merge1", "in1"),
            _edge("e2", "n2", "records", "merge1", "in2"),
            _edge("e3", "merge1", "records", "dedupe1", "records"),
            _edge("e4", "dedupe1", "records", "sink1", "records"),
        ],
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


async def _stub_store_for_task(db_session, task_id: str, source_id: str, content_hash: str):
    rec = CollectedRecord(
        task_id=task_id,
        source_id=source_id,
        raw_data={"title": "x"},
        normalized_data={"title": "x", "source_id": source_id},
        content_hash=content_hash,
        status="normalized",
    )
    db_session.add(rec)
    await db_session.flush()


def _fake_pipeline_outcome(**overrides):
    base = {
        "task_id": "ignored",
        "run_id": "run-1",
        "success": True,
        "collected": 1,
        "stored": 1,
        "skipped": 0,
        "error": None,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_run_multi_source_plan_with_merge_succeeds(client, db_session):
    """A properly-wired two-source Plan (merge -> dedupe -> store) runs
    end-to-end via the manual run endpoint (issue 04 acceptance criterion)."""
    source_id_1 = await _create_source(client, name="S1")
    source_id_2 = await _create_source(client, name="S2")
    plan_id = await _create_plan(client, _two_source_graph(source_id_1, source_id_2))

    async def fake_pipeline(task_id, params):
        task = await db_session.get(CollectionTask, task_id)
        source_id = task.source_id
        await _stub_store_for_task(db_session, task_id, source_id, f"hash-{source_id}")
        return _fake_pipeline_outcome()

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(side_effect=fake_pipeline),
    ):
        response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["success"] is True
    assert len(data["source_results"]) == 2
    assert all(r["success"] for r in data["source_results"])
    assert data["shared_segment"]["success"] is True
    assert data["shared_segment"]["stored"] == 2


@pytest.mark.asyncio
async def test_run_multi_source_plan_without_merge_still_refused(client):
    """Two sources wired directly to a sink (no merge combining them) is not
    a valid shared-segment shape — still refused with 400, same contract
    issue 03 established for "not a shape this executor runs"."""
    source_id_1 = await _create_source(client, name="S1")
    source_id_2 = await _create_source(client, name="S2")
    graph = {
        "ir_version": PLAN_IR_VERSION,
        "name": "Multi-source, no merge",
        "nodes": [
            _source_node("n1", source_id_1),
            _source_node("n2", source_id_2),
            _sink_node("n3"),
        ],
        "edges": [
            _edge("e1", "n1", "records", "n3", "records"),
            _edge("e2", "n2", "records", "n3", "records"),
        ],
    }
    plan_id = await _create_plan(client, graph)

    response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})
    assert response.status_code == 400
    assert "merge" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_plan_health_read_endpoint_after_run(client, db_session):
    source_id_1 = await _create_source(client, name="S1")
    source_id_2 = await _create_source(client, name="S2")
    plan_id = await _create_plan(client, _two_source_graph(source_id_1, source_id_2))

    async def fake_pipeline(task_id, params):
        task = await db_session.get(CollectionTask, task_id)
        source_id = task.source_id
        await _stub_store_for_task(db_session, task_id, source_id, f"hash-{source_id}")
        return _fake_pipeline_outcome()

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(side_effect=fake_pipeline),
    ):
        run_resp = await client.post(f"/api/v1/plans/{plan_id}/run", json={})
    assert run_resp.status_code == 202

    health_resp = await client.get(f"/api/v1/plans/{plan_id}/health")
    assert health_resp.status_code == 200
    body = health_resp.json()
    assert body["success"] is True
    node_ids = {row["node_id"] for row in body["data"]}
    assert node_ids == {"merge1", "dedupe1", "sink1"}
    assert all(row["success"] for row in body["data"])
    assert body["meta"]["total"] == 3


@pytest.mark.asyncio
async def test_plan_health_read_endpoint_404(client):
    response = await client.get("/api/v1/plans/nonexistent/health")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_partial_failure_reflected_in_response(client, db_session):
    """One source fails, the other proceeds: the HTTP response is still 202
    (not a 400/500) with success=False and per-source detail (PRD "partial
    failure" acceptance criterion, HTTP seam)."""
    source_id_1 = await _create_source(client, name="S1")
    source_id_2 = await _create_source(client, name="S2")
    plan_id = await _create_plan(client, _two_source_graph(source_id_1, source_id_2))

    async def fake_pipeline(task_id, params):
        task = await db_session.get(CollectionTask, task_id)
        source_id = task.source_id
        if source_id == source_id_1:
            return {"error": "boom"}
        await _stub_store_for_task(db_session, task_id, source_id, f"hash-{source_id}")
        return _fake_pipeline_outcome()

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(side_effect=fake_pipeline),
    ):
        response = await client.post(f"/api/v1/plans/{plan_id}/run", json={})

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["success"] is False
    by_source = {r["source_id"]: r for r in data["source_results"]}
    assert by_source[source_id_1]["success"] is False
    assert "boom" in by_source[source_id_1]["error"]
    assert by_source[source_id_2]["success"] is True
