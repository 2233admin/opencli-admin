"""HTTP-seam tests for Dify/n8n external workflow import."""

from __future__ import annotations

import pytest

from backend.schemas.workflow import WorkflowProjectNode
from backend.workflow.node_registry import resolve_node_origin


def _base_project() -> dict:
    return {
        "id": "wf-import-target",
        "name": "Import target",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "inbox-existing",
                "kind": "inbox",
                "capability": "store",
                "params": {"queue": "macro-watch"},
            }
        ],
        "edges": [],
    }


def _find_node(nodes: list[dict], node_id: str) -> dict:
    return next(node for node in nodes if node["id"] == node_id)


@pytest.mark.asyncio
async def test_import_n8n_graph_tags_provenance_and_flattens_connections(client):
    graph = {
        "nodes": [
            {"id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook"},
            {"id": "2", "name": "Merge", "type": "n8n-nodes-base.merge"},
        ],
        "connections": {
            "Webhook": {"main": [[{"node": "Merge", "type": "main", "index": 0}]]},
        },
    }

    response = await client.post(
        "/api/v1/workflows/import/external-runtime",
        json={"project": _base_project(), "runtime": "n8n", "graph": graph, "name": "n8n export"},
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["valid"] is True, data["errors"]

    nodes = data["project"]["nodes"]
    webhook_node = _find_node(nodes, "webhook")
    merge_node = _find_node(nodes, "merge")

    assert webhook_node["ui"]["catalogId"] == "external.tool.capability"
    assert webhook_node["ui"]["n8n"] == {
        "source": "n8n",
        "nodeId": "Webhook",
        "nodeType": "n8n-nodes-base.webhook",
    }
    assert merge_node["ui"]["catalogId"] == "intelligence.flow.merge"
    assert merge_node["ui"]["n8n"] == {
        "source": "n8n",
        "nodeId": "Merge",
        "nodeType": "n8n-nodes-base.merge",
    }

    edges = data["project"]["edges"]
    imported_edge = next(e for e in edges if e["source"] == "webhook" and e["target"] == "merge")
    assert imported_edge["ui"]["externalWorkflow"]["runtime"] == "n8n"

    # catalogId resolution takes precedence over the ui.n8n provenance tag (see
    # resolve_node_origin), so importer output always classifies as node_library —
    # the n8n tag is provenance metadata only, not a classification switch.
    assert resolve_node_origin(WorkflowProjectNode.model_validate(webhook_node)).kind == (
        "node_library"
    )
    assert resolve_node_origin(WorkflowProjectNode.model_validate(merge_node)).kind == (
        "node_library"
    )


@pytest.mark.asyncio
async def test_import_dify_graph_tags_provenance_without_n8n_marker(client):
    graph = {
        "nodes": [
            {"id": "node-1", "type": "llm", "name": "LLM call"},
            {"id": "node-2", "type": "transform", "name": "Normalize output"},
        ],
        "edges": [{"source": "node-1", "target": "node-2"}],
    }

    response = await client.post(
        "/api/v1/workflows/import/external-runtime",
        json={"project": _base_project(), "runtime": "dify", "graph": graph, "name": "dify export"},
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["valid"] is True, data["errors"]

    nodes = data["project"]["nodes"]
    llm_node = _find_node(nodes, "node-1")
    normalize_node = _find_node(nodes, "node-2")

    assert llm_node["ui"]["externalWorkflow"]["runtime"] == "dify"
    assert "n8n" not in llm_node["ui"]
    assert normalize_node["ui"]["catalogId"] == "intelligence.processing.normalize"
    assert "n8n" not in normalize_node["ui"]

    edges = data["project"]["edges"]
    imported_edge = next(e for e in edges if e["source"] == "node-1" and e["target"] == "node-2")
    assert imported_edge["ui"]["externalWorkflow"]["runtime"] == "dify"


def test_resolve_node_origin_classifies_unmapped_n8n_tagged_node():
    node = WorkflowProjectNode(
        id="raw-n8n-node",
        kind="action",
        capability="store",
        ui={"n8n": {"source": "n8n", "nodeId": "Raw", "nodeType": "n8n-nodes-base.rawUnmapped"}},
    )

    origin = resolve_node_origin(node)

    assert origin.kind == "n8n"
    assert origin.n8n == {
        "source": "n8n",
        "nodeId": "Raw",
        "nodeType": "n8n-nodes-base.rawUnmapped",
    }
