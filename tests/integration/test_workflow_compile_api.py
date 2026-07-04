"""HTTP-seam tests for Canvas WorkflowProject compile preview."""

import pytest


def _valid_workflow_project() -> dict:
    return {
        "id": "wf-opencli-multi-source",
        "name": "OpenCLI multi-source collection",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "source-jin10",
                "kind": "source",
                "capability": "fetch",
                "adapter": "jin10-kuaixun",
                "params": {"limit": 20},
                "sourceAnchor": {
                    "kind": "url",
                    "label": "JIN10",
                    "href": "https://www.jin10.com/",
                },
            },
            {
                "id": "normalize-items",
                "kind": "agent",
                "capability": "normalize",
                "params": {"language": "zh-CN"},
            },
            {
                "id": "store-inbox",
                "kind": "inbox",
                "capability": "store",
                "params": {"queue": "macro-watch"},
            },
        ],
        "edges": [
            {
                "id": "e-source-normalize",
                "source": "source-jin10",
                "target": "normalize-items",
                "sourcePort": "records",
                "targetPort": "records",
            },
            {
                "id": "e-normalize-store",
                "source": "normalize-items",
                "target": "store-inbox",
                "sourcePort": "records",
                "targetPort": "records",
            },
        ],
        "settings": {
            "timezone": "Asia/Shanghai",
            "deterministicSimulation": False,
            "maxItemsPerRun": 1000,
        },
        "adapters": [
            {
                "id": "jin10-kuaixun",
                "type": "source",
                "provider": "jin10",
                "mode": "live",
                "config": {"feed": "kuaixun"},
            }
        ],
        "agentPermissions": {
            "canFetchNetwork": True,
            "canSendNotifications": False,
            "canWriteInbox": True,
            "allowedDomains": ["jin10.com"],
        },
    }


@pytest.mark.asyncio
async def test_compile_valid_workflow_returns_plan_preview(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _valid_workflow_project()},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["valid"] is True
    assert data["errors"] == []

    plan = data["plan"]
    assert plan["authoring"]["project_id"] == "wf-opencli-multi-source"
    assert plan["authoring"]["node_count"] == 3
    assert plan["runtime"]["execution_mode"] == "preview"
    assert plan["runtime"]["dispatch"] == "none"
    assert plan["runtime"]["nodes"][0]["adapter"]["provider"] == "jin10"
    assert plan["runtime"]["plan_ir"]["draft"] is True


@pytest.mark.asyncio
async def test_compile_rejects_missing_edge_target_with_canvas_anchor(client):
    project = _valid_workflow_project()
    project["edges"][0]["target"] = "missing-node"

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    assert data["plan"] is None
    errors = [error for error in data["errors"] if error["code"] == "missing_edge_target"]
    assert errors
    assert errors[0]["edge_id"] == "e-source-normalize"
    assert errors[0]["path"] == ["edges", "e-source-normalize", "target"]


@pytest.mark.asyncio
async def test_compile_rejects_source_without_adapter_binding(client):
    project = _valid_workflow_project()
    project["nodes"][0].pop("adapter")

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    errors = [error for error in data["errors"] if error["code"] == "missing_adapter_binding"]
    assert errors
    assert errors[0]["node_id"] == "source-jin10"
    assert errors[0]["path"] == ["nodes", "source-jin10", "adapter"]


@pytest.mark.asyncio
async def test_compile_preserves_node_ids_in_runtime_and_plan_ir(client):
    project = _valid_workflow_project()
    expected_ids = [node["id"] for node in project["nodes"]]

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    runtime = response.json()["data"]["plan"]["runtime"]
    assert runtime["node_ids"] == expected_ids
    assert [node["id"] for node in runtime["nodes"]] == expected_ids
    assert [node["id"] for node in runtime["plan_ir"]["nodes"]] == expected_ids


@pytest.mark.asyncio
async def test_compile_expands_package_internals_and_binds_public_params(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "multi-source-hda",
            "kind": "agent",
            "capability": "normalize",
            "params": {"limit": 50},
            "topicCollapse": {
                "groupId": "opencli-package",
                "nodeCount": 2,
                "mode": "draft",
                "packageInternal": True,
            },
            "parameterInterface": {
                "groups": [{"id": "public", "label": "Public"}],
                "fields": [
                    {
                        "id": "limit",
                        "label": "Limit",
                        "groupId": "public",
                        "type": "number",
                        "binding": {
                            "nodeId": "internal-fetch",
                            "source": "params",
                            "fieldId": "limit",
                        },
                        "value": 20,
                    }
                ],
            },
            "internals": {
                "nodes": [
                    {
                        "id": "internal-fetch",
                        "kind": "source",
                        "capability": "fetch",
                        "adapter": "jin10-kuaixun",
                        "params": {"limit": 10},
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
                        "id": "internal-fetch-normalize",
                        "source": "internal-fetch",
                        "target": "internal-normalize",
                    }
                ],
            },
        }
    ]
    project["edges"] = []

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    runtime = data["plan"]["runtime"]
    assert runtime["node_ids"] == [
        "multi-source-hda",
        "multi-source-hda::internal-fetch",
        "multi-source-hda::internal-normalize",
    ]
    package_node = runtime["nodes"][0]
    assert package_node["id"] == "multi-source-hda"
    assert package_node["package"]["internal_node_ids"] == [
        "multi-source-hda::internal-fetch",
        "multi-source-hda::internal-normalize",
    ]
    internal_fetch = runtime["nodes"][1]
    assert internal_fetch["params"]["limit"] == 50
    assert internal_fetch["runtime"]["package_parent_id"] == "multi-source-hda"
    assert internal_fetch["depends_on"] == ["multi-source-hda"]
    assert runtime["edges"][0]["id"] == "multi-source-hda::internal-fetch-normalize"
    assert [node["id"] for node in runtime["plan_ir"]["nodes"]] == runtime["node_ids"]


@pytest.mark.asyncio
async def test_compile_marks_locked_package_internals_non_editable(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "locked-hda",
            "kind": "agent",
            "capability": "normalize",
            "topicCollapse": {
                "groupId": "locked-package",
                "nodeCount": 1,
                "mode": "locked",
                "packageInternal": True,
            },
            "internals": {
                "locked": True,
                "nodes": [
                    {
                        "id": "internal-normalize",
                        "kind": "agent",
                        "capability": "normalize",
                        "params": {"language": "zh-CN"},
                    }
                ],
                "edges": [],
            },
        }
    ]
    project["edges"] = []

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    runtime = response.json()["data"]["plan"]["runtime"]
    assert runtime["nodes"][0]["package"]["locked"] is True
    assert runtime["nodes"][0]["package"]["editable"] is False
    assert runtime["nodes"][1]["runtime"]["editable"] is False


@pytest.mark.asyncio
async def test_compile_rejects_invalid_package_parameter_binding(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "broken-hda",
            "kind": "agent",
            "capability": "normalize",
            "parameterInterface": {
                "groups": [{"id": "public", "label": "Public"}],
                "fields": [
                    {
                        "id": "limit",
                        "label": "Limit",
                        "groupId": "public",
                        "type": "number",
                        "binding": {
                            "nodeId": "missing-internal",
                            "source": "params",
                            "fieldId": "limit",
                        },
                        "value": 20,
                    }
                ],
            },
            "internals": {
                "nodes": [
                    {
                        "id": "internal-fetch",
                        "kind": "source",
                        "capability": "fetch",
                        "adapter": "jin10-kuaixun",
                        "params": {"limit": 10},
                    }
                ],
                "edges": [],
            },
        }
    ]
    project["edges"] = []

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    errors = [error for error in data["errors"] if error["code"] == "invalid_parameter_binding"]
    assert errors
    assert errors[0]["node_id"] == "broken-hda"
    assert errors[0]["path"] == [
        "nodes",
        "broken-hda",
        "parameterInterface",
        "fields",
        "limit",
        "binding",
    ]
