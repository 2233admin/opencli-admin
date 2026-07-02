"""HTTP-seam tests for the Plan IR endpoints (issue 01):

- GET  /api/v1/plan-ir/schema                    — documented IR schema fetch
- POST /api/v1/plan-ir/validate                   — valid graph passes,
  each invalid-graph class (cycle, orphan merge, missing required param,
  port type mismatch) rejected with a node-anchored error
- GET  /api/v1/plan-ir/projection/{source_id}     — degenerate projection for
  every channel type, round-tripped through the validator
"""

import pytest

from backend.plan_ir.validation import validate_plan_graph
from backend.schemas.plan_ir import PLAN_IR_VERSION, PlanGraph

# One minimal, valid channel_config per channel type (backend/channels/*.py
# validate_config()'s required fields) — used to exercise the degenerate
# projection endpoint for every channel type per the issue's acceptance
# criterion.
CHANNEL_CONFIGS = {
    "opencli": {"site": "xueqiu", "command": "hot"},
    "web_scraper": {"url": "https://example.com", "selectors": {"title": "h1"}},
    "api": {"base_url": "https://example.com", "endpoint": "/items"},
    "rss": {"feed_url": "https://example.com/feed.xml"},
    "cli": {"binary": "echo", "command": "hello"},
    "skill": {"skill_id": "demo-skill"},
    "crawl4ai": {"url": "https://example.com", "selectors": {"title": "h1"}},
}


def _source_payload(channel_type: str) -> dict:
    return {
        "name": f"Test {channel_type} source",
        "channel_type": channel_type,
        "channel_config": CHANNEL_CONFIGS[channel_type],
        "enabled": True,
    }


# ── schema fetch ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_plan_ir_schema(client):
    response = await client.get("/api/v1/plan-ir/schema")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["ir_version"] == PLAN_IR_VERSION
    # Documented as an API contract: the JSON schema must describe the
    # PlanGraph shape (nodes/edges), not just echo a version string.
    schema = data["schema"]
    assert "properties" in schema
    assert "nodes" in schema["properties"]
    assert "edges" in schema["properties"]


# ── valid graph passes ────────────────────────────────────────────────────


def _valid_graph() -> dict:
    return {
        "name": "valid two-source merge",
        "nodes": [
            {
                "id": "src1",
                "kind": "source",
                "type": "rss_source",
                "source_id": "11111111-1111-1111-1111-111111111111",
                "outputs": [{"name": "records", "type": "records"}],
            },
            {
                "id": "src2",
                "kind": "source",
                "type": "rss_source",
                "draft": True,
                "outputs": [{"name": "records", "type": "records"}],
            },
            {
                "id": "merge1",
                "kind": "merge",
                "type": "merge",
                "inputs": [
                    {"name": "in1", "type": "records"},
                    {"name": "in2", "type": "records"},
                ],
                "outputs": [{"name": "records", "type": "records"}],
            },
            {
                "id": "sink1",
                "kind": "sink",
                "type": "collection_store",
                "required_params": ["destination"],
                "params": {"destination": "records"},
                "inputs": [{"name": "records", "type": "records"}],
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source_node": "src1",
                "source_port": "records",
                "target_node": "merge1",
                "target_port": "in1",
            },
            {
                "id": "e2",
                "source_node": "src2",
                "source_port": "records",
                "target_node": "merge1",
                "target_port": "in2",
            },
            {
                "id": "e3",
                "source_node": "merge1",
                "source_port": "records",
                "target_node": "sink1",
                "target_port": "records",
            },
        ],
    }


@pytest.mark.asyncio
async def test_validate_valid_graph_passes(client):
    response = await client.post("/api/v1/plan-ir/validate", json=_valid_graph())
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["errors"] == []


# ── invalid-graph classes, each node-anchored ─────────────────────────────


@pytest.mark.asyncio
async def test_validate_rejects_cycle(client):
    graph = {
        "nodes": [
            {
                "id": "a",
                "kind": "transform",
                "type": "noop",
                "inputs": [{"name": "in", "type": "records"}],
                "outputs": [{"name": "out", "type": "records"}],
            },
            {
                "id": "b",
                "kind": "transform",
                "type": "noop",
                "inputs": [{"name": "in", "type": "records"}],
                "outputs": [{"name": "out", "type": "records"}],
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source_node": "a",
                "source_port": "out",
                "target_node": "b",
                "target_port": "in",
            },
            {
                "id": "e2",
                "source_node": "b",
                "source_port": "out",
                "target_node": "a",
                "target_port": "in",
            },
        ],
    }
    response = await client.post("/api/v1/plan-ir/validate", json=graph)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    cycle_errors = [e for e in data["errors"] if e["code"] == "cycle"]
    assert {e["node_id"] for e in cycle_errors} == {"a", "b"}
    # Node-anchored: every cycle error names the offending node.
    for e in cycle_errors:
        assert e["node_id"] is not None


@pytest.mark.asyncio
async def test_validate_rejects_orphan_merge(client):
    graph = {
        "nodes": [
            {
                "id": "src1",
                "kind": "source",
                "type": "rss_source",
                "draft": True,
                "outputs": [{"name": "records", "type": "records"}],
            },
            {
                "id": "merge1",
                "kind": "merge",
                "type": "merge",
                "inputs": [
                    {"name": "in1", "type": "records"},
                    {"name": "in2", "type": "records"},
                ],
                "outputs": [{"name": "records", "type": "records"}],
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source_node": "src1",
                "source_port": "records",
                "target_node": "merge1",
                "target_port": "in1",
            },
        ],
    }
    response = await client.post("/api/v1/plan-ir/validate", json=graph)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    orphan_errors = [e for e in data["errors"] if e["code"] == "orphan_merge"]
    assert len(orphan_errors) == 1
    assert orphan_errors[0]["node_id"] == "merge1"


@pytest.mark.asyncio
async def test_validate_rejects_missing_required_param(client):
    graph = {
        "nodes": [
            {
                "id": "sink1",
                "kind": "sink",
                "type": "collection_store",
                "required_params": ["destination"],
                "params": {},
                "inputs": [{"name": "records", "type": "records"}],
            },
        ],
        "edges": [],
    }
    response = await client.post("/api/v1/plan-ir/validate", json=graph)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    missing = [e for e in data["errors"] if e["code"] == "missing_required_param"]
    assert len(missing) == 1
    assert missing[0]["node_id"] == "sink1"


@pytest.mark.asyncio
async def test_validate_rejects_port_type_mismatch(client):
    graph = {
        "nodes": [
            {
                "id": "src1",
                "kind": "source",
                "type": "rss_source",
                "draft": True,
                "outputs": [{"name": "records", "type": "records"}],
            },
            {
                "id": "sink1",
                "kind": "sink",
                "type": "collection_store",
                "inputs": [{"name": "events", "type": "events"}],
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source_node": "src1",
                "source_port": "records",
                "target_node": "sink1",
                "target_port": "events",
            },
        ],
    }
    response = await client.post("/api/v1/plan-ir/validate", json=graph)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    mismatches = [e for e in data["errors"] if e["code"] == "port_type_mismatch"]
    assert len(mismatches) == 1
    assert mismatches[0]["edge_id"] == "e1"
    assert mismatches[0]["node_id"] == "sink1"


@pytest.mark.asyncio
async def test_validate_rejects_source_node_missing_entity_reference(client):
    """ADR-0009: a source node must carry source_id XOR draft=True."""
    graph = {
        "nodes": [
            {
                "id": "src1",
                "kind": "source",
                "type": "rss_source",
                "outputs": [{"name": "records", "type": "records"}],
            },
        ],
        "edges": [],
    }
    response = await client.post("/api/v1/plan-ir/validate", json=graph)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    errs = [e for e in data["errors"] if e["code"] == "source_node_missing_reference"]
    assert len(errs) == 1
    assert errs[0]["node_id"] == "src1"


@pytest.mark.asyncio
async def test_validate_rejects_entity_reference_on_non_source_node(client):
    graph = {
        "nodes": [
            {
                "id": "t1",
                "kind": "transform",
                "type": "noop",
                "source_id": "11111111-1111-1111-1111-111111111111",
            },
        ],
        "edges": [],
    }
    response = await client.post("/api/v1/plan-ir/validate", json=graph)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    errs = [e for e in data["errors"] if e["code"] == "entity_reference_on_non_source_node"]
    assert len(errs) == 1
    assert errs[0]["node_id"] == "t1"


# ── degenerate projection: every channel type round-trips ────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("channel_type", sorted(CHANNEL_CONFIGS))
async def test_degenerate_projection_round_trips_for_every_channel_type(
    client, channel_type
):
    create_resp = await client.post("/api/v1/sources", json=_source_payload(channel_type))
    assert create_resp.status_code == 201
    source_id = create_resp.json()["data"]["id"]

    response = await client.get(f"/api/v1/plan-ir/projection/{source_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    plan = body["data"]

    # Degenerate = exactly one source node + one sink node, wired directly.
    assert plan["draft"] is True
    assert len(plan["nodes"]) == 2
    source_nodes = [n for n in plan["nodes"] if n["kind"] == "source"]
    assert len(source_nodes) == 1
    assert source_nodes[0]["source_id"] == source_id
    assert source_nodes[0]["draft"] is False
    assert source_nodes[0]["params"]["channel_type"] == channel_type
    for key, value in CHANNEL_CONFIGS[channel_type].items():
        assert source_nodes[0]["params"][key] == value

    # Round-trips against the IR validator with zero errors — this is the
    # issue 01 acceptance criterion, exercised here via the same validator
    # the /validate endpoint uses (proving the projection is not just
    # schema-shaped but structurally valid).
    result = validate_plan_graph(PlanGraph.model_validate(plan))
    assert result.valid, result.to_dict()


@pytest.mark.asyncio
async def test_degenerate_projection_source_not_found(client):
    response = await client.get("/api/v1/plan-ir/projection/nonexistent-id")
    assert response.status_code == 404
