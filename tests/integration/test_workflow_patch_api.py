"""HTTP-seam tests for AI-authored WorkflowProject patch preview."""

import pytest

from tests.integration.test_workflow_compile_api import _valid_workflow_project


@pytest.mark.asyncio
async def test_patch_adds_existing_node_updates_params_connects_and_compiles(client):
    project = _valid_workflow_project()
    project["nodes"] = project["nodes"][:2]
    project["edges"] = project["edges"][:1]

    response = await client.post(
        "/api/v1/workflows/patch",
        json={
            "project": project,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "store-inbox",
                        "kind": "inbox",
                        "capability": "store",
                        "params": {"queue": "triage"},
                        "ui": {"catalogId": "intelligence.output.inbox"},
                    },
                },
                {
                    "op": "update_parameters",
                    "nodeId": "normalize-items",
                    "params": {"language": "en-US", "preserveSourceRefs": True},
                },
                {
                    "op": "connect_nodes",
                    "edge": {
                        "id": "e-normalize-store",
                        "source": "normalize-items",
                        "target": "store-inbox",
                    },
                },
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["errors"] == []
    assert data["missing_capabilities"] == []
    assert [operation["op"] for operation in data["patch"]["operations"]] == [
        "add_node",
        "update_parameters",
        "connect_nodes",
    ]
    patched = data["project"]
    assert [node["id"] for node in patched["nodes"]] == [
        "source-jin10",
        "normalize-items",
        "store-inbox",
    ]
    normalize = next(node for node in patched["nodes"] if node["id"] == "normalize-items")
    assert normalize["params"]["language"] == "en-US"
    assert data["compile"]["valid"] is True
    assert data["compile"]["plan"]["runtime"]["node_ids"] == [
        "source-jin10",
        "normalize-items",
        "store-inbox",
    ]


@pytest.mark.asyncio
async def test_patch_rejects_hand_rolled_primitive_and_executor(client):
    project = _valid_workflow_project()

    response = await client.post(
        "/api/v1/workflows/patch",
        json={
            "project": project,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "custom-ai-node",
                        "kind": "agent",
                        "capability": "summarize",
                        "params": {"rawOpencliCommand": "opencli collect custom"},
                        "ui": {
                            "primitiveId": "primitive.generated.custom",
                            "executor": {"type": "python"},
                            "missingCapability": "custom.ai.summary",
                        },
                    },
                }
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    assert data["project"] is None
    assert data["compile"] is None
    assert {error["code"] for error in data["errors"]} == {
        "forbidden_node_definition",
        "unknown_node_library_binding",
    }


@pytest.mark.asyncio
async def test_patch_rejects_unknown_adapter_after_apply(client):
    project = _valid_workflow_project()

    response = await client.post(
        "/api/v1/workflows/patch",
        json={
            "project": project,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "notify-slack",
                        "kind": "notify",
                        "capability": "send",
                        "adapter": "unknown-slack",
                        "params": {"target": "ops"},
                        "ui": {"catalogId": "intelligence.output.webhook"},
                    },
                }
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    assert data["project"] is None
    assert data["compile"]["valid"] is False
    errors = [error for error in data["errors"] if error["code"] == "missing_adapter_binding"]
    assert errors
    assert errors[0]["node_id"] == "notify-slack"


@pytest.mark.asyncio
async def test_patch_packages_selected_nodes_into_hda_and_compiles(client):
    project = _valid_workflow_project()
    project["nodes"] = project["nodes"][:2]
    project["edges"] = project["edges"][:1]

    response = await client.post(
        "/api/v1/workflows/patch",
        json={
            "project": project,
            "operations": [
                {
                    "op": "package_nodes",
                    "internalNodeIds": ["source-jin10", "normalize-items"],
                    "packageNode": {
                        "id": "collection-hda",
                        "kind": "source",
                        "capability": "fetch",
                        "adapter": "jin10-kuaixun",
                        "params": {"template": "collection-pipeline"},
                        "topicCollapse": {
                            "groupId": "collection-hda",
                            "nodeCount": 2,
                            "mode": "locked",
                            "packageInternal": True,
                        },
                        "ui": {"catalogId": "package.collection.pipeline"},
                    },
                }
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    assert data["errors"] == []
    patched = data["project"]
    assert [node["id"] for node in patched["nodes"]] == ["collection-hda"]
    package_node = patched["nodes"][0]
    assert [node["id"] for node in package_node["internals"]["nodes"]] == [
        "source-jin10",
        "normalize-items",
    ]
    assert [edge["id"] for edge in package_node["internals"]["edges"]] == [
        "e-source-normalize"
    ]
    assert data["compile"]["plan"]["runtime"]["node_ids"] == [
        "collection-hda",
        "collection-hda::source-jin10",
        "collection-hda::normalize-items",
    ]


@pytest.mark.asyncio
async def test_patch_reports_missing_capability_without_inventing_node(client):
    project = _valid_workflow_project()

    response = await client.post(
        "/api/v1/workflows/patch",
        json={
            "project": project,
            "operations": [
                {
                    "op": "request_missing_capability",
                    "capability": "browser.profile.smart-rotate",
                    "reason": "Need cross-machine browser profile fanout.",
                }
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    assert [node["id"] for node in data["project"]["nodes"]] == [
        node["id"] for node in project["nodes"]
    ]
    assert [edge["id"] for edge in data["project"]["edges"]] == [
        edge["id"] for edge in project["edges"]
    ]
    assert data["missing_capabilities"] == [
        {
            "capability": "browser.profile.smart-rotate",
            "reason": "Need cross-machine browser profile fanout.",
            "n8n_search_hint": "browser.profile.smart-rotate",
        }
    ]
    assert data["compile"]["valid"] is True
