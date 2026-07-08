"""Integration tests for the /api/v1/plans endpoints (issue 02)."""

import pytest


def _draft_source_node(node_id: str = "n1") -> dict:
    """A source node with neither source_id nor draft=True materialized —
    i.e. explicitly draft (unmaterialized Draft Source Node, ADR-0009)."""
    return {
        "id": node_id,
        "kind": "source",
        "type": "opencli_source",
        "label": "Draft source",
        "params": {},
        "draft": True,
        "outputs": [{"name": "records", "type": "records"}],
    }


def _materialized_source_node(node_id: str = "n1", source_id: str = "src-1") -> dict:
    return {
        "id": node_id,
        "kind": "source",
        "type": "opencli_source",
        "label": "Materialized source",
        "params": {},
        "source_id": source_id,
        "outputs": [{"name": "records", "type": "records"}],
    }


def _sink_node(node_id: str = "n2") -> dict:
    return {
        "id": node_id,
        "kind": "sink",
        "type": "collection_store",
        "label": "Sink",
        "params": {},
        "inputs": [{"name": "records", "type": "records"}],
    }


def _edge(edge_id: str, src_node: str, tgt_node: str) -> dict:
    return {
        "id": edge_id,
        "source_node": src_node,
        "source_port": "records",
        "target_node": tgt_node,
        "target_port": "records",
    }


def _draft_plan_graph() -> dict:
    return {
        "name": "My Plan",
        "nodes": [_draft_source_node(), _sink_node()],
        "edges": [_edge("e1", "n1", "n2")],
    }


def _runnable_plan_graph() -> dict:
    return {
        "name": "My Plan",
        "nodes": [_materialized_source_node(), _sink_node()],
        "edges": [_edge("e1", "n1", "n2")],
    }


def _cyclic_plan_graph() -> dict:
    """n1 -> n1 self-loop: fails the issue-01 cycle check."""
    return {
        "name": "Cyclic",
        "nodes": [
            {
                "id": "n1",
                "kind": "transform",
                "type": "dedupe",
                "label": "Loop",
                "params": {},
                "inputs": [{"name": "in", "type": "any"}],
                "outputs": [{"name": "out", "type": "any"}],
            }
        ],
        "edges": [_edge("e1", "n1", "n1")],
    }


# ── CRUD ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_plans_empty(client):
    response = await client.get("/api/v1/plans")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"] == []
    assert data["meta"]["total"] == 0


@pytest.mark.asyncio
async def test_create_plan(client):
    response = await client.post(
        "/api/v1/plans", json={"name": "P1", "graph": _runnable_plan_graph()}
    )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["name"] == "P1"
    assert data["version"] == 1
    assert "id" in data


@pytest.mark.asyncio
async def test_get_plan(client):
    create_resp = await client.post(
        "/api/v1/plans", json={"name": "P1", "graph": _runnable_plan_graph()}
    )
    plan_id = create_resp.json()["data"]["id"]

    response = await client.get(f"/api/v1/plans/{plan_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == plan_id


@pytest.mark.asyncio
async def test_get_plan_not_found(client):
    response = await client.get("/api/v1/plans/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_plan_name_only_does_not_bump_version(client):
    create_resp = await client.post(
        "/api/v1/plans", json={"name": "P1", "graph": _runnable_plan_graph()}
    )
    plan_id = create_resp.json()["data"]["id"]

    response = await client.patch(f"/api/v1/plans/{plan_id}", json={"name": "P1 renamed"})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["name"] == "P1 renamed"
    assert data["version"] == 1


@pytest.mark.asyncio
async def test_update_plan_not_found(client):
    response = await client.patch(
        "/api/v1/plans/nonexistent-id", json={"name": "renamed"}
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_plan(client):
    create_resp = await client.post(
        "/api/v1/plans", json={"name": "P1", "graph": _runnable_plan_graph()}
    )
    plan_id = create_resp.json()["data"]["id"]

    delete_resp = await client.delete(f"/api/v1/plans/{plan_id}")
    assert delete_resp.status_code == 200

    get_resp = await client.get(f"/api/v1/plans/{plan_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_plan_not_found(client):
    response = await client.delete("/api/v1/plans/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_plans_pagination(client):
    for i in range(3):
        await client.post(
            "/api/v1/plans", json={"name": f"P{i}", "graph": _runnable_plan_graph()}
        )

    response = await client.get("/api/v1/plans?page=1&limit=2")
    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]) == 2
    assert body["meta"]["total"] == 3
    assert body["meta"]["pages"] == 2


# ── version increments on update ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_plan_graph_increments_version(client):
    create_resp = await client.post(
        "/api/v1/plans", json={"name": "P1", "graph": _runnable_plan_graph()}
    )
    plan_id = create_resp.json()["data"]["id"]
    assert create_resp.json()["data"]["version"] == 1

    new_graph = _runnable_plan_graph()
    new_graph["name"] = "P1 v2"
    response = await client.patch(f"/api/v1/plans/{plan_id}", json={"graph": new_graph})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["version"] == 2

    # A second graph update bumps again.
    response2 = await client.patch(f"/api/v1/plans/{plan_id}", json={"graph": new_graph})
    assert response2.status_code == 200
    assert response2.json()["data"]["version"] == 3


# ── byte-faithful round-trip ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_graph_round_trips_byte_faithfully(client):
    graph = _runnable_plan_graph()
    # Extra, IR-schema-legal but non-required fields to prove nothing gets
    # silently dropped or renormalized on the way in/out.
    graph["ir_version"] = "1.0.0"

    create_resp = await client.post("/api/v1/plans", json={"name": "P1", "graph": graph})
    assert create_resp.status_code == 201
    assert create_resp.json()["data"]["graph"] == graph

    plan_id = create_resp.json()["data"]["id"]
    get_resp = await client.get(f"/api/v1/plans/{plan_id}")
    assert get_resp.json()["data"]["graph"] == graph


# ── draft / runnable flagging ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_plan_with_draft_source_node_saves_and_is_flagged_draft(client):
    response = await client.post(
        "/api/v1/plans", json={"name": "Draft plan", "graph": _draft_plan_graph()}
    )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["draft"] is True
    assert data["runnable"] is False


@pytest.mark.asyncio
async def test_plan_with_only_materialized_sources_is_flagged_runnable(client):
    response = await client.post(
        "/api/v1/plans", json={"name": "Runnable plan", "graph": _runnable_plan_graph()}
    )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["draft"] is False
    assert data["runnable"] is True


@pytest.mark.asyncio
async def test_plan_with_no_source_nodes_is_not_runnable(client):
    graph = {
        "name": "No sources",
        "nodes": [_sink_node("n1")],
        "edges": [],
    }
    response = await client.post("/api/v1/plans", json={"name": "P", "graph": graph})
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["draft"] is False
    assert data["runnable"] is False


@pytest.mark.asyncio
async def test_updating_graph_from_draft_to_materialized_flips_flags(client):
    create_resp = await client.post(
        "/api/v1/plans", json={"name": "P1", "graph": _draft_plan_graph()}
    )
    plan_id = create_resp.json()["data"]["id"]
    assert create_resp.json()["data"]["draft"] is True

    response = await client.patch(
        f"/api/v1/plans/{plan_id}", json={"graph": _runnable_plan_graph()}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["draft"] is False
    assert data["runnable"] is True


# ── validation failure: 422 + node-anchored errors (reuses issue-01 validator) ──


@pytest.mark.asyncio
async def test_create_plan_with_cycle_returns_422_node_anchored(client):
    response = await client.post(
        "/api/v1/plans", json={"name": "Bad plan", "graph": _cyclic_plan_graph()}
    )
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert isinstance(errors, list)
    assert any(e["code"] == "cycle" and e["node_id"] == "n1" for e in errors)


@pytest.mark.asyncio
async def test_create_plan_with_orphan_merge_returns_422(client):
    graph = {
        "name": "Orphan merge",
        "nodes": [
            _materialized_source_node("n1"),
            {
                "id": "n2",
                "kind": "merge",
                "type": "merge",
                "label": "Merge",
                "params": {},
                "inputs": [{"name": "a", "type": "records"}, {"name": "b", "type": "records"}],
                "outputs": [{"name": "out", "type": "records"}],
            },
        ],
        "edges": [_edge("e1", "n1", "n2")],
    }
    graph["edges"][0]["target_port"] = "a"
    response = await client.post("/api/v1/plans", json={"name": "P", "graph": graph})
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert any(e["code"] == "orphan_merge" and e["node_id"] == "n2" for e in errors)


@pytest.mark.asyncio
async def test_invalid_graph_is_never_persisted(client):
    response = await client.post(
        "/api/v1/plans", json={"name": "Bad plan", "graph": _cyclic_plan_graph()}
    )
    assert response.status_code == 422

    list_resp = await client.get("/api/v1/plans")
    assert list_resp.json()["data"] == []


@pytest.mark.asyncio
async def test_update_plan_with_invalid_graph_returns_422_and_does_not_mutate(client):
    create_resp = await client.post(
        "/api/v1/plans", json={"name": "P1", "graph": _runnable_plan_graph()}
    )
    plan_id = create_resp.json()["data"]["id"]

    response = await client.patch(
        f"/api/v1/plans/{plan_id}", json={"graph": _cyclic_plan_graph()}
    )
    assert response.status_code == 422

    unchanged = await client.get(f"/api/v1/plans/{plan_id}")
    assert unchanged.json()["data"]["graph"] == _runnable_plan_graph()
    assert unchanged.json()["data"]["version"] == 1


@pytest.mark.asyncio
async def test_create_plan_missing_required_ir_field_returns_422(client):
    """A structurally-malformed IR document (fails Pydantic parsing before
    the structural validator even runs) still 422s — FastAPI's own request
    validation, not the node-anchored validator, but the same status code
    contract callers rely on."""
    response = await client.post(
        "/api/v1/plans",
        json={"name": "Bad", "graph": {"nodes": [{"kind": "source"}], "edges": []}},
    )
    assert response.status_code == 422


# ── list filter by draft ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_plans_filter_by_draft(client):
    await client.post("/api/v1/plans", json={"name": "Draft", "graph": _draft_plan_graph()})
    await client.post(
        "/api/v1/plans", json={"name": "Runnable", "graph": _runnable_plan_graph()}
    )

    draft_only = await client.get("/api/v1/plans?draft=true")
    assert draft_only.json()["meta"]["total"] == 1
    assert draft_only.json()["data"][0]["name"] == "Draft"

    runnable_only = await client.get("/api/v1/plans?draft=false")
    assert runnable_only.json()["meta"]["total"] == 1
    assert runnable_only.json()["data"][0]["name"] == "Runnable"
