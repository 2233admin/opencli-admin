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


def _opencli_workflow_project() -> dict:
    project = _valid_workflow_project()
    project["nodes"][0] = {
        "id": "source-bilibili",
        "kind": "source",
        "capability": "fetch",
        "adapter": "opencli-bilibili",
        "params": {"site": "bilibili", "command": "search"},
        "sourceAnchor": {
            "kind": "url",
            "label": "Bilibili",
            "href": "https://www.bilibili.com/",
        },
    }
    project["edges"][0]["source"] = "source-bilibili"
    project["adapters"] = [
        {
            "id": "opencli-bilibili",
            "type": "source",
            "provider": "opencli",
            "mode": "live",
            "config": {"channel": "opencli"},
        }
    ]
    return project


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
async def test_compile_resolves_opencli_source_to_iii_runtime_binding(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _opencli_workflow_project()},
    )

    assert response.status_code == 200
    runtime = response.json()["data"]["plan"]["runtime"]
    source_node = runtime["nodes"][0]
    assert source_node["id"] == "source-bilibili"
    assert source_node["runtime"]["binding"] == {
        "status": "bound",
        "binding_id": "iii.collector-opencli.snapshot",
        "runtime": "iii",
        "worker": "collector-opencli",
        "function_id": "odp.collect::opencli_snapshot",
        "channel": "opencli",
        "input": {"site": "bilibili", "command": "search"},
    }


@pytest.mark.asyncio
async def test_compile_marks_unsupported_nodes_with_structured_missing_runtime(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _opencli_workflow_project()},
    )

    assert response.status_code == 200
    runtime_nodes = response.json()["data"]["plan"]["runtime"]["nodes"]
    normalize_node = runtime_nodes[1]
    assert normalize_node["id"] == "normalize-items"
    assert normalize_node["runtime"]["missing_runtime"] == {
        "status": "missing",
        "code": "missing_runtime_binding",
        "node_id": "normalize-items",
        "kind": "agent",
        "capability": "normalize",
        "message": "No runtime binding registered for workflow.agent.normalize",
    }


@pytest.mark.asyncio
async def test_compile_marks_opencli_source_without_site_command_as_missing_runtime_parameter(
    client,
):
    project = _opencli_workflow_project()
    project["nodes"][0]["params"] = {"site": "bilibili"}

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    source_node = response.json()["data"]["plan"]["runtime"]["nodes"][0]
    assert "binding" not in source_node["runtime"]
    assert source_node["runtime"]["missing_runtime"] == {
        "status": "missing",
        "code": "missing_runtime_parameter",
        "node_id": "source-bilibili",
        "kind": "source",
        "capability": "fetch",
        "adapter_id": "opencli-bilibili",
        "provider": "opencli",
        "required_params": ["command"],
        "message": "OpenCLI runtime binding requires node.params.site and node.params.command",
    }


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
async def test_compile_resolves_opencli_hda_internal_source_binding(client):
    project = _opencli_workflow_project()
    project["nodes"] = [
        {
            "id": "multi-source-hda",
            "kind": "agent",
            "capability": "normalize",
            "topicCollapse": {
                "groupId": "opencli-package",
                "nodeCount": 2,
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
                        "params": {"site": "bilibili", "command": "search"},
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
                        "id": "source-normalize",
                        "source": "source-bilibili",
                        "target": "internal-normalize",
                    }
                ],
            },
        }
    ]
    project["edges"] = []

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    runtime_nodes = response.json()["data"]["plan"]["runtime"]["nodes"]
    package_node = runtime_nodes[0]
    internal_source = runtime_nodes[1]
    assert package_node["id"] == "multi-source-hda"
    assert "binding" not in package_node["runtime"]
    assert package_node["runtime"]["missing_runtime"]["code"] == "missing_runtime_binding"
    assert internal_source["id"] == "multi-source-hda::source-bilibili"
    assert internal_source["runtime"]["package_parent_id"] == "multi-source-hda"
    assert internal_source["runtime"]["binding"]["function_id"] == "odp.collect::opencli_snapshot"
    assert internal_source["runtime"]["binding"]["input"] == {
        "site": "bilibili",
        "command": "search",
    }


@pytest.mark.asyncio
async def test_compile_materializes_opencli_hda_sources_from_ai_params_in_parallel(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "multi-source-opencli",
            "kind": "agent",
            "capability": "normalize",
            "params": {
                "template": "opencli-multi-source",
                "runtime": "iii",
                "lockedInternals": True,
                "execution": {
                    "fanout": "serial",
                    "maxConcurrency": 4,
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
            },
            "topicCollapse": {
                "groupId": "opencli-package",
                "nodeCount": 0,
                "mode": "locked",
                "packageInternal": True,
            },
            "ui": {"catalogId": "package.opencli.multi-source-hda"},
        }
    ]
    project["edges"] = []
    project["adapters"] = []

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    runtime = data["plan"]["runtime"]
    assert runtime["node_ids"] == [
        "multi-source-opencli",
        "multi-source-opencli::source-bili",
        "multi-source-opencli::source-xhs",
        "multi-source-opencli::internal-normalize",
    ]
    package_node = runtime["nodes"][0]
    source_bili = runtime["nodes"][1]
    source_xhs = runtime["nodes"][2]
    normalize = runtime["nodes"][3]
    assert package_node["params"]["execution"]["fanout"] == "parallel"
    assert package_node["params"]["execution"]["maxConcurrency"] == 4
    assert source_bili["depends_on"] == ["multi-source-opencli"]
    assert source_xhs["depends_on"] == ["multi-source-opencli"]
    assert normalize["depends_on"] == [
        "multi-source-opencli::source-bili",
        "multi-source-opencli::source-xhs",
    ]
    assert source_bili["runtime"]["origin"]["catalog_id"] == "intelligence.source.opencli-slot"
    assert source_bili["runtime"]["binding"]["function_id"] == "odp.collect::opencli_snapshot"
    assert source_xhs["runtime"]["binding"]["input"] == {
        "site": "xiaohongshu",
        "command": "search",
    }
    assert package_node["package"]["internal_node_ids"] == [
        "multi-source-opencli::source-bili",
        "multi-source-opencli::source-xhs",
        "multi-source-opencli::internal-normalize",
    ]


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


@pytest.mark.asyncio
async def test_compile_records_existing_node_library_origin(client):
    project = _valid_workflow_project()
    project["nodes"][0]["ui"] = {"catalogId": "intelligence.source.jin10"}
    project["nodes"][1]["ui"] = {"primitiveId": "primitive.transform.map-fields"}

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    nodes = response.json()["data"]["plan"]["runtime"]["nodes"]
    assert nodes[0]["runtime"]["origin"] == {
        "kind": "node_library",
        "catalog_id": "intelligence.source.jin10",
        "notes": [],
    }
    assert nodes[1]["runtime"]["origin"] == {
        "kind": "primitive_library",
        "primitive_id": "primitive.transform.map-fields",
        "notes": [],
    }


@pytest.mark.asyncio
async def test_compile_accepts_n8n_translated_missing_capability(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "n8n-http-request",
            "kind": "source",
            "capability": "fetch",
            "adapter": "n8n-http-request",
            "params": {"n8nType": "httpRequest", "method": "GET"},
            "ui": {
                "missingCapability": "vendor.http.request",
                "n8n": {
                    "source": "n8n",
                    "originalId": "1",
                    "originalName": "HTTP Request",
                    "type": "n8n-nodes-base.httpRequest",
                },
            },
        }
    ]
    project["edges"] = []
    project["adapters"] = [
        {
            "id": "n8n-http-request",
            "type": "source",
            "provider": "http_request",
            "mode": "fixture",
            "config": {"translatedFrom": "n8n"},
        }
    ]

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    origin = data["plan"]["runtime"]["nodes"][0]["runtime"]["origin"]
    assert origin["kind"] == "n8n"
    assert origin["missing_capability"] == "vendor.http.request"
    assert origin["n8n"]["type"] == "n8n-nodes-base.httpRequest"


@pytest.mark.asyncio
async def test_compile_rejects_unknown_node_library_binding_without_n8n(client):
    project = _valid_workflow_project()
    project["nodes"][1]["ui"] = {
        "catalogId": "generated.agent.custom-summary",
        "primitiveId": "primitive.generated.custom-summary",
        "missingCapability": "custom.summary",
    }

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    errors = [error for error in data["errors"] if error["code"] == "unknown_node_library_binding"]
    assert errors
    assert errors[0]["node_id"] == "normalize-items"
    assert errors[0]["path"] == ["nodes", "normalize-items", "ui"]


@pytest.mark.asyncio
async def test_compile_rejects_hand_rolled_node_implementation(client):
    project = _valid_workflow_project()
    project["nodes"][1]["ui"] = {"executor": {"type": "python"}}
    project["nodes"][1]["params"]["rawOpencliCommand"] = "opencli collect whatever"

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    errors = [error for error in data["errors"] if error["code"] == "forbidden_node_definition"]
    assert {error["path"][-1] for error in errors} == {"executor", "rawOpencliCommand"}


@pytest.mark.asyncio
async def test_compile_accepts_collection_need_input_node(client):
    project = _valid_workflow_project()
    project["nodes"].insert(
        0,
        {
            "id": "collection-need",
            "kind": "schedule",
            "capability": "trigger",
            "params": {
                "text": "抓小红书热帖",
                "locale": "zh-CN",
                "mode": "demand-draft",
            },
            "ui": {"catalogId": "intelligence.input.collection-need"},
        },
    )
    project["edges"].insert(
        0,
        {
            "id": "e-need-source",
            "source": "collection-need",
            "target": "source-jin10",
        },
    )

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    node = next(
        node
        for node in data["plan"]["runtime"]["nodes"]
        if node["id"] == "collection-need"
    )
    assert node["runtime"]["origin"]["catalog_id"] == "intelligence.input.collection-need"
    assert node["runtime"]["binding"]["binding_id"] == "workflow.demand-draft.patch"
    assert "missing_runtime" not in node["runtime"]


@pytest.mark.asyncio
async def test_workflow_capabilities_project_real_backend_surfaces(client):
    response = await client.get("/api/v1/workflows/capabilities")

    assert response.status_code == 200
    data = response.json()["data"]

    catalog = {item["id"]: item for item in data["catalog"]}
    assert catalog["intelligence.input.collection-need"]["status"] == "runnable"
    assert catalog["intelligence.input.collection-need"]["backendAvailable"] is True
    assert catalog["intelligence.input.collection-need"]["runtimeBinding"] == "workflow.demand-draft.patch"
    assert catalog["intelligence.source.opencli-slot"]["status"] == "runnable"
    assert catalog["intelligence.source.opencli-slot"]["backendAvailable"] is True
    assert catalog["intelligence.source.opencli-slot"]["runtimeBinding"]
    assert "frontend_run_event_binding" not in catalog["intelligence.source.opencli-slot"]["missing"]
    assert catalog["package.opencli.multi-source-hda"]["status"] == "runnable"
    assert "frontend_run_event_binding" not in catalog["package.opencli.multi-source-hda"]["missing"]
    assert "typed_demand_input_envelope" not in catalog["package.opencli.multi-source-hda"]["missing"]
    assert catalog["intelligence.output.webhook"]["status"] == "blocked"
    assert catalog["intelligence.output.webhook"]["backendAvailable"] is True

    channels = {item["channelType"]: item for item in data["channels"]}
    assert set(channels) == {
        "api",
        "cli",
        "crawl4ai",
        "opencli",
        "rss",
        "skill",
        "web_scraper",
    }
    assert channels["opencli"]["status"] == "runnable"
    assert channels["opencli"]["backendAvailable"] is True
    assert channels["rss"]["status"] == "blocked"
    assert channels["rss"]["backendAvailable"] is True
    assert "canvas_source_projection" in channels["rss"]["missing"]

    notifiers = {item["notifierType"]: item for item in data["notifiers"]}
    assert "webhook" in notifiers
    assert notifiers["webhook"]["status"] == "blocked"
    assert notifiers["webhook"]["backendAvailable"] is True

    primitives = {item["id"]: item for item in data["primitives"]}
    assert primitives["primitive.ops.trigger-webhook"]["status"] == "blocked"
    assert primitives["primitive.ops.trigger-webhook"]["backendAvailable"] is True

    triggers = {item["id"]: item for item in data["triggers"]}
    assert triggers["trigger.manual"]["status"] == "runnable"
    assert triggers["trigger.manual"]["missing"] == []
    assert triggers["trigger.webhook"]["status"] == "blocked"
