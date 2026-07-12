"""HTTP-seam tests for Canvas WorkflowProject compile preview."""

import pytest


def _assert_binding_includes(actual: dict, expected: dict) -> None:
    for key, value in expected.items():
        assert actual.get(key) == value
    if "contract" in actual:
        assert actual["contract"]["bindingId"] == expected["binding_id"]


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


def _native_nodes_first_loop_project() -> dict:
    return {
        "id": "wf-native-nodes-first-loop",
        "name": "Native nodes first loop",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "source-bilibili",
                "kind": "source",
                "capability": "fetch",
                "adapter": "opencli-bilibili",
                "params": {"site": "bilibili", "command": "search"},
                "ui": {"catalogId": "intelligence.source.opencli-slot"},
            },
            {
                "id": "source-xhs",
                "kind": "source",
                "capability": "fetch",
                "adapter": "opencli-xhs",
                "params": {"site": "xiaohongshu", "command": "search"},
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
                "id": "e-bilibili-normalize",
                "source": "source-bilibili",
                "target": "normalize-bilibili",
            },
            {
                "id": "e-xhs-normalize",
                "source": "source-xhs",
                "target": "normalize-xhs",
            },
            {
                "id": "e-bilibili-merge",
                "source": "normalize-bilibili",
                "target": "merge-candidates",
                "sourcePort": "out",
                "targetPort": "in1",
            },
            {
                "id": "e-xhs-merge",
                "source": "normalize-xhs",
                "target": "merge-candidates",
                "sourcePort": "out",
                "targetPort": "in2",
            },
            {
                "id": "e-merge-accept",
                "source": "merge-candidates",
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


def _registered_tool_project(*, version_pin: dict | None = None) -> dict:
    tool_capability = {
        "id": "tool.search.fixture",
        "executor": {"mode": "fixture", "output": {"title": "Pinned result"}},
    }
    if version_pin is not None:
        tool_capability["versionPin"] = version_pin
    return {
        "id": "wf-pinned-tool",
        "name": "Pinned tool capability",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "search-tool",
                "kind": "action",
                "capability": "store",
                "params": {"toolCapability": tool_capability},
                "ui": {"catalogId": "external.tool.capability"},
            }
        ],
        "edges": [],
        "adapters": [],
    }


def _installed_tool_version_pin() -> dict:
    return {
        "package": "opencli-admin",
        "packageVersion": "0.1.0",
        "capabilityVersion": "1.0.0",
        "provenance": "built-in",
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
async def test_compile_rejects_registered_tool_capability_without_version_pin(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _registered_tool_project()},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    assert data["plan"] is None
    assert data["errors"] == [
        {
            "code": "unpinned_tool_capability",
            "message": (
                'Workflow node "search-tool" must pin the exact package and '
                'capability version for Tool Capability "tool.search.fixture".'
            ),
            "node_id": "search-tool",
            "edge_id": None,
            "path": ["nodes", "search-tool", "params", "toolCapability", "versionPin"],
        }
    ]


@pytest.mark.asyncio
async def test_compile_rejects_unknown_tool_capability_even_with_a_pin(client):
    project = _registered_tool_project(version_pin=_installed_tool_version_pin())
    project["nodes"][0]["params"]["toolCapability"]["id"] = "tool.unknown"

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    error = response.json()["data"]["errors"][0]
    assert error["code"] == "unknown_tool_capability"
    assert "is not installed in the registry" in error["message"]


@pytest.mark.asyncio
async def test_compile_accepts_exact_installed_tool_capability_version_pin(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _registered_tool_project(version_pin=_installed_tool_version_pin())},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    node = data["plan"]["runtime"]["nodes"][0]
    assert node["runtime"]["external_tool"]["versionPin"] == (_installed_tool_version_pin())
    assert node["runtime"]["binding"]["input"]["toolCapabilityVersionPin"] == (
        _installed_tool_version_pin()
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("version_pin", "error_code"),
    [
        (
            {
                **_installed_tool_version_pin(),
                "capabilityVersion": "1.0.1",
            },
            "tool_capability_version_pin_mismatch",
        ),
        (
            {
                **_installed_tool_version_pin(),
                "provenance": "unverified",
            },
            "disallowed_tool_capability_provenance",
        ),
    ],
)
async def test_compile_rejects_disallowed_tool_version_or_provenance(
    client,
    version_pin,
    error_code,
):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _registered_tool_project(version_pin=version_pin)},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    assert [error["code"] for error in data["errors"]] == [error_code]


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
    _assert_binding_includes(
        source_node["runtime"]["binding"],
        {
            "status": "bound",
            "binding_id": "iii.collector-opencli.snapshot",
            "runtime": "iii",
            "worker": "collector-opencli",
            "function_id": "odp.collect::opencli_snapshot",
            "channel": "opencli",
            "input": {"site": "bilibili", "command": "search"},
        },
    )


@pytest.mark.asyncio
async def test_compile_projects_native_first_loop_nodes_to_runtime_bindings(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _native_nodes_first_loop_project()},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    runtime_nodes = {node["id"]: node for node in data["plan"]["runtime"]["nodes"]}

    merge = runtime_nodes["merge-candidates"]
    assert merge["kind"] == "flow"
    assert merge["capability"] == "merge"
    assert merge["runtime"]["binding"]["binding_id"] == "workflow.flow.merge"
    assert merge["runtime"]["merge"] == {
        "node_id": "merge-candidates",
        "strategy": "concat",
        "lineage": "preserved",
    }

    gate = runtime_nodes["accept-records"]
    assert gate["kind"] == "control"
    assert gate["capability"] == "accept"
    assert gate["runtime"]["binding"]["binding_id"] == ("workflow.gate.record-acceptance")
    assert gate["runtime"]["record_acceptance"] == {
        "node_id": "accept-records",
        "candidate_port": "recordCandidate[]",
        "record_port": "record[]",
    }

    sink = runtime_nodes["record-sink"]
    assert sink["kind"] == "sink"
    assert sink["capability"] == "store"
    assert sink["runtime"]["binding"]["binding_id"] == "workflow.record-sink.records"

    plan_nodes = {node["id"]: node for node in data["plan"]["runtime"]["plan_ir"]["nodes"]}
    assert plan_nodes["merge-candidates"]["kind"] == "merge"
    assert plan_nodes["merge-candidates"]["inputs"] == [
        {"name": "in1", "type": "recordCandidate[]"},
        {"name": "in2", "type": "recordCandidate[]"},
    ]
    assert plan_nodes["accept-records"]["outputs"] == [{"name": "records", "type": "record[]"}]
    assert plan_nodes["record-sink"]["kind"] == "sink"
    assert plan_nodes["record-sink"]["inputs"] == [{"name": "records", "type": "record[]"}]


@pytest.mark.asyncio
async def test_compile_rejects_incompatible_typed_native_edge(client):
    project = _native_nodes_first_loop_project()
    project["edges"][-1] = {
        "id": "e-merge-sink-invalid",
        "source": "merge-candidates",
        "target": "record-sink",
        "sourcePort": "out",
        "targetPort": "records",
    }

    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": project},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    assert data["plan"] is None
    errors = [error for error in data["errors"] if error["code"] == "incompatible_edge_ports"]
    assert errors == [
        {
            "code": "incompatible_edge_ports",
            "message": (
                'Workflow edge "e-merge-sink-invalid" connects incompatible '
                "port types: recordCandidate[] -> record[]"
            ),
            "node_id": None,
            "edge_id": "e-merge-sink-invalid",
            "path": ["edges", "e-merge-sink-invalid"],
        }
    ]


@pytest.mark.asyncio
async def test_compile_rejects_invalid_typed_native_port_id(client):
    project = _native_nodes_first_loop_project()
    project["edges"][-1]["sourcePort"] = "out"

    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": project},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    errors = [error for error in data["errors"] if error["code"] == "invalid_edge_source_port"]
    assert errors[0]["edge_id"] == "e-accept-sink"
    assert errors[0]["path"] == ["edges", "e-accept-sink", "sourcePort"]


@pytest.mark.asyncio
async def test_compile_resolves_normalize_to_native_transform_binding(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": _opencli_workflow_project()},
    )

    assert response.status_code == 200
    runtime_nodes = response.json()["data"]["plan"]["runtime"]["nodes"]
    normalize_node = runtime_nodes[1]
    assert normalize_node["id"] == "normalize-items"
    _assert_binding_includes(
        normalize_node["runtime"]["binding"],
        {
            "status": "bound",
            "binding_id": "workflow.transform.normalize",
            "runtime": "workflow",
            "channel": "transform",
            "input": {
                "language": "zh-CN",
                "preserveSourceRefs": True,
                "inputPort": "items[]",
                "outputPort": "recordCandidate[]",
            },
        },
    )
    assert normalize_node["runtime"]["normalize"] == {
        "node_id": "normalize-items",
        "candidate_port": "recordCandidate[]",
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
async def test_compile_recursively_expands_nested_package_internals(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "outer",
            "kind": "agent",
            "capability": "normalize",
            "internals": {
                "nodes": [
                    {
                        "id": "inner",
                        "kind": "agent",
                        "capability": "normalize",
                        "internals": {
                            "nodes": [
                                {
                                    "id": "leaf",
                                    "kind": "agent",
                                    "capability": "normalize",
                                }
                            ],
                            "edges": [],
                        },
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
    assert runtime["node_ids"] == ["outer", "outer::inner", "outer::inner::leaf"]
    inner, leaf = runtime["nodes"][1:]
    assert inner["package"]["internal_node_ids"] == ["outer::inner::leaf"]
    assert leaf["depends_on"] == ["outer::inner"]
    assert leaf["runtime"]["package_parent_id"] == "outer::inner"
    assert leaf["runtime"]["package_path"] == ["outer", "inner", "leaf"]


@pytest.mark.asyncio
async def test_compile_rejects_cycle_inside_nested_package(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "outer",
            "kind": "agent",
            "capability": "normalize",
            "internals": {
                "nodes": [
                    {
                        "id": "inner",
                        "kind": "agent",
                        "capability": "normalize",
                        "internals": {
                            "nodes": [
                                {"id": "a", "kind": "agent", "capability": "normalize"},
                                {"id": "b", "kind": "agent", "capability": "normalize"},
                            ],
                            "edges": [
                                {"id": "a-b", "source": "a", "target": "b"},
                                {"id": "b-a", "source": "b", "target": "a"},
                            ],
                        },
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
    assert {error["node_id"] for error in data["errors"] if error["code"] == "cycle"} == {
        "outer::inner"
    }


@pytest.mark.asyncio
async def test_compile_rejects_package_depth_over_sixteen(client):
    nested = {"id": "leaf", "kind": "agent", "capability": "normalize"}
    for depth in range(17, 0, -1):
        nested = {
            "id": f"package-{depth}",
            "kind": "agent",
            "capability": "normalize",
            "internals": {"nodes": [nested], "edges": []},
        }
    project = _valid_workflow_project()
    project["nodes"] = [nested]
    project["edges"] = []

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is False
    depth_error = next(
        error for error in data["errors"] if error["code"] == "package_depth_exceeded"
    )
    assert depth_error["node_id"].count("::") == 16


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
        "multi-source-opencli::source-pool",
        "multi-source-opencli::source-bili",
        "multi-source-opencli::source-xhs",
        "multi-source-opencli::internal-normalize",
        "multi-source-opencli::collection-output",
    ]
    package_node = runtime["nodes"][0]
    source_pool = runtime["nodes"][1]
    source_bili = runtime["nodes"][2]
    source_xhs = runtime["nodes"][3]
    normalize = runtime["nodes"][4]
    collection_output = runtime["nodes"][5]
    assert package_node["params"]["execution"]["fanout"] == "parallel"
    assert package_node["params"]["execution"]["maxConcurrency"] == 4
    assert source_pool["depends_on"] == ["multi-source-opencli"]
    assert source_pool["runtime"]["binding"]["binding_id"] == (
        "workflow.source-pool.parallel-fanout"
    )
    assert source_pool["runtime"]["binding"]["input"] == {
        "sourceCount": 2,
        "sourceGroups": ["video", "social"],
        "fanout": "parallel",
    }
    assert source_bili["depends_on"] == ["multi-source-opencli::source-pool"]
    assert source_xhs["depends_on"] == ["multi-source-opencli::source-pool"]
    assert normalize["depends_on"] == [
        "multi-source-opencli::source-bili",
        "multi-source-opencli::source-xhs",
    ]
    assert collection_output["depends_on"] == ["multi-source-opencli::internal-normalize"]
    assert collection_output["runtime"]["binding"]["binding_id"] == (
        "workflow.collection-output.items"
    )
    assert source_bili["runtime"]["origin"]["catalog_id"] == "intelligence.source.opencli-slot"
    assert source_bili["runtime"]["binding"]["function_id"] == "odp.collect::opencli_snapshot"
    assert source_xhs["runtime"]["binding"]["input"] == {
        "site": "xiaohongshu",
        "command": "search",
    }
    assert package_node["package"]["internal_node_ids"] == [
        "multi-source-opencli::source-pool",
        "multi-source-opencli::source-bili",
        "multi-source-opencli::source-xhs",
        "multi-source-opencli::internal-normalize",
        "multi-source-opencli::collection-output",
    ]
    assert [edge["source"] for edge in runtime["edges"]] == [
        "multi-source-opencli::source-pool",
        "multi-source-opencli::source-pool",
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
            "params": {
                "n8nType": "httpRequest",
                "method": "GET",
                "compatRuntime": {
                    "target": "n8n",
                    "nodeType": "n8n-nodes-base.httpRequest",
                    "sourceNodeId": "1",
                },
            },
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
    runtime = data["plan"]["runtime"]["nodes"][0]["runtime"]
    assert runtime["binding"]["binding_id"] == "workflow.compat.n8n.execute"
    assert runtime["binding"]["worker"] == "n8n-compat"
    assert runtime["binding"]["input"]["nodeType"] == "n8n-nodes-base.httpRequest"
    assert runtime["binding"]["contract"]["status"] == "dispatch_only"


@pytest.mark.asyncio
async def test_compile_routes_dify_translated_node_to_compat_worker(client):
    project = _valid_workflow_project()
    project["nodes"] = [
        {
            "id": "dify-llm",
            "kind": "agent",
            "capability": "summarize",
            "params": {
                "compatRuntime": {
                    "target": "dify",
                    "nodeType": "llm",
                    "sourceNodeId": "llm-1",
                }
            },
            "ui": {
                "dify": {
                    "source": "dify",
                    "originalId": "llm-1",
                    "originalName": "LLM",
                    "type": "llm",
                    "parameters": {"model": "gpt"},
                }
            },
        }
    ]
    project["edges"] = []
    project["adapters"] = []

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    runtime = data["plan"]["runtime"]["nodes"][0]["runtime"]
    assert runtime["binding"]["binding_id"] == "workflow.compat.dify.execute"
    assert runtime["binding"]["worker"] == "dify-compat"
    assert runtime["binding"]["input"]["parameters"] == {"model": "gpt"}


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
        node for node in data["plan"]["runtime"]["nodes"] if node["id"] == "collection-need"
    )
    assert node["runtime"]["origin"]["catalog_id"] == "intelligence.input.collection-need"
    assert node["runtime"]["binding"]["binding_id"] == "workflow.demand-draft.patch"
    assert "missing_runtime" not in node["runtime"]


@pytest.mark.asyncio
async def test_compile_resolves_schedule_trigger_binding(client):
    project = _valid_workflow_project()
    project["nodes"].insert(
        0,
        {
            "id": "schedule-cron",
            "kind": "schedule",
            "capability": "trigger",
            "params": {
                "interval": "5m",
                "timezone": "Asia/Shanghai",
                "enabled": True,
            },
            "ui": {"catalogId": "intelligence.schedule.cron"},
        },
    )
    project["edges"].insert(
        0,
        {
            "id": "e-schedule-source",
            "source": "schedule-cron",
            "target": "source-jin10",
        },
    )

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    node = next(node for node in data["plan"]["runtime"]["nodes"] if node["id"] == "schedule-cron")
    assert node["runtime"]["origin"]["catalog_id"] == "intelligence.schedule.cron"
    _assert_binding_includes(
        node["runtime"]["binding"],
        {
            "status": "bound",
            "binding_id": "workflow.trigger.schedule_tick",
            "runtime": "workflow",
            "channel": "schedule",
            "input": {
                "interval": "5m",
                "timezone": "Asia/Shanghai",
                "enabled": True,
            },
        },
    )
    assert node["runtime"]["trigger"] == {
        "node_id": "schedule-cron",
        "mode": "manual_schedule_tick",
    }
    assert "missing_runtime" not in node["runtime"]
