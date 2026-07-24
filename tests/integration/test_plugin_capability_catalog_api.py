import pytest

from backend.plugins.capability_catalog import (
    DIFY_NODE_TYPE_TO_CAPABILITY_ID,
    OFFICIAL_DIFY_NODE_TYPES,
    build_plugin_node_catalog,
    get_plugin_node_capability,
    resolve_dify_node_capability_id,
)


def test_plugin_node_catalog_has_stable_unique_dify_mapping():
    catalog = build_plugin_node_catalog()
    nodes = {node.id: node for node in catalog.nodes}

    assert catalog.authority == "backend"
    assert catalog.version == "opencli.node-capabilities.v1"
    assert catalog.summary.total == len(nodes)
    assert len(nodes) == len(catalog.nodes)
    assert nodes["primitive.core.template-transform"].runtime_binding == (
        "workflow.native.template-transform"
    )
    assert nodes["primitive.core.variable-assign"].dify_node_types == ["assigner"]
    assert "variable-assigner" in nodes["primitive.core.variable-aggregate"].dify_node_types
    assert nodes["primitive.core.list-filter"].input_ports[0].type == "array"
    assert nodes["primitive.ai.llm"].parameters[0].name == "model"
    assert nodes["external.tool.capability"].readiness == "plugin_required"
    assert nodes["package.compat.dify-workflow"].origin == "compatibility"

    aliases = {
        alias: node.id
        for node in catalog.nodes
        for alias in node.dify_node_types
        if ":" not in alias
    }
    assert aliases["if-else"] == "primitive.core.if"
    assert aliases["iteration"] == "primitive.core.iteration"
    assert aliases["human-input"] == "primitive.human.approval"
    assert resolve_dify_node_capability_id("variable-assigner") == (
        "primitive.core.variable-aggregate"
    )
    assert get_plugin_node_capability("primitive.core.loop") is not None
    assert len(DIFY_NODE_TYPE_TO_CAPABILITY_ID) == 26
    assert len(OFFICIAL_DIFY_NODE_TYPES) == 25
    assert not {"loop-start", "loop-end", "iteration-start"} & OFFICIAL_DIFY_NODE_TYPES


@pytest.mark.asyncio
async def test_plugin_capabilities_endpoint_is_backend_authoritative(client):
    response = await client.get("/api/v1/plugins/capabilities")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["authority"] == "backend"
    assert data["version"] == "opencli.node-capabilities.v1"
    assert data["summary"]["total"] == len(data["nodes"])

    nodes = {node["id"]: node for node in data["nodes"]}
    template = nodes["primitive.core.template-transform"]
    assert template["kind"] == "agent"
    assert template["capability"] == "normalize"
    assert template["runtimeBinding"] == "workflow.native.template-transform"
    assert template["inputPorts"] == [{"name": "in", "type": "any", "required": False}]
    assert template["parameters"][0]["name"] == "template"

    categories = {category["id"]: category for category in data["categories"]}
    assert categories["transform"]["count"] >= 6
    assert categories["plugin"]["count"] >= 2
