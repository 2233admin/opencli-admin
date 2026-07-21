from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from backend.api.v1.dify_imports import get_dify_graphon_client
from backend.main import app

FIXTURES = Path(__file__).parents[1] / "fixtures" / "dify"
GRAPHON_COMMIT = "b187ce7927fea1a7c137b642be3f78e3abb9f7de"


class PolicyAwareGraphonClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.engine_commit = GRAPHON_COMMIT

    async def inspect(self, *, source_content: str, source_sha256: str, policy: dict):
        self.calls.append(
            {
                "source_content": source_content,
                "source_sha256": source_sha256,
                "policy": policy,
            }
        )
        blockers: list[dict] = []
        dependencies: list[dict] = []
        payload = yaml.safe_load(source_content)
        graph_nodes = payload.get("workflow", {}).get("graph", {}).get("nodes", [])
        nodes = [
            {
                "sourceNodeId": str(node.get("id")),
                "type": str(node.get("data", {}).get("type", "unknown")),
                "status": "ready",
            }
            for node in graph_nodes
        ]
        if "type: code" in source_content:
            blockers.append(
                {
                    "code": "dify_sandbox_required",
                    "message": "Dify code nodes require the sandbox runtime.",
                    "nodeId": "code",
                }
            )
            dependencies.append({"type": "sandbox", "id": "dify-sandbox"})
        elif "type: llm" in source_content:
            blockers.extend(
                [
                    {
                        "code": "dify_model_provider_required",
                        "message": "A matching model provider is required.",
                        "nodeId": "llm",
                    },
                    {
                        "code": "dify_slim_runtime_required",
                        "message": "The Dify Slim runtime is required.",
                        "nodeId": "llm",
                    },
                ]
            )
            dependencies.extend(
                [
                    {"type": "model", "id": "openai-compatible"},
                    {"type": "runtime", "id": "dify-slim"},
                ]
            )
        elif "type: http-request" in source_content and not policy.get("allowNetwork"):
            blockers.append(
                {
                    "code": "dify_network_permission_required",
                    "message": "HTTP request nodes require network permission.",
                    "nodeId": "http",
                }
            )
            dependencies.append({"type": "network", "id": "workflow-network"})
        return {
            "loadStatus": "blocked" if blockers else "ready",
            "loadReason": blockers[0]["code"] if blockers else None,
            "engine": {
                "name": "graphon",
                "version": "0.7.0",
                "commit": self.engine_commit,
            },
            "appMode": "workflow",
            "nodes": nodes,
            "dependencies": dependencies,
            "blockers": blockers,
        }


@pytest.fixture
def graphon_client():
    client = PolicyAwareGraphonClient()
    app.dependency_overrides[get_dify_graphon_client] = lambda: client
    yield client
    app.dependency_overrides.pop(get_dify_graphon_client, None)


async def _import_project(client, fixture_name: str) -> dict:
    source = (FIXTURES / fixture_name).read_text(encoding="utf-8")
    response = await client.post("/api/v1/workflows/import/dify", json={"source": source})
    assert response.status_code == 200
    return response.json()["data"]["project"]


@pytest.mark.asyncio
async def test_compile_emits_one_graphon_binding_without_flattening_internals(
    client,
    graphon_client,
):
    project = await _import_project(client, "pure_logic.yml")

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    compiled = response.json()["data"]
    assert compiled["valid"] is True
    runtime = compiled["plan"]["runtime"]
    assert runtime["node_ids"] == [project["nodes"][0]["id"]]
    assert len(runtime["nodes"]) == 1
    package = runtime["nodes"][0]
    assert package["runtime"]["binding"]["binding_id"] == "workflow.compat.dify.graphon"
    assert package["runtime"]["binding"]["input"]["sourceSha256"]
    binding_input = package["runtime"]["binding"]["input"]
    assert binding_input["contractVersion"] == "opencli.graphon.compat.v1"
    assert binding_input["engineCommit"] == GRAPHON_COMMIT
    assert binding_input["policy"]["allowNetwork"] is False
    assert binding_input["sourceNodeIndex"] == ["source-start-001", "source-end-002"]
    assert package["runtime"]["structural"] is False
    assert package["runtime"]["executable"] is True
    assert package["package"]["locked"] is True
    assert package["package"]["managed"] is True
    assert len(runtime["plan_ir"]["nodes"]) == 1
    assert "sourceContent" not in response.text
    assert len(graphon_client.calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fixture_name", "expected_codes"),
    [
        ("code_blocked.yml", ["dify_sandbox_required"]),
        (
            "llm_answer.yml",
            ["dify_model_provider_required", "dify_slim_runtime_required"],
        ),
        ("http_request.yml", ["dify_network_permission_required"]),
    ],
)
async def test_compile_projects_graphon_blockers_with_stable_codes(
    client,
    graphon_client,
    fixture_name,
    expected_codes,
):
    project = await _import_project(client, fixture_name)

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.status_code == 200
    compiled = response.json()["data"]
    assert compiled["valid"] is False
    assert [error["code"] for error in compiled["errors"]] == expected_codes


@pytest.mark.asyncio
async def test_compile_rejects_a_tampered_canonical_source_digest(client, graphon_client):
    project = await _import_project(client, "pure_logic.yml")
    project["nodes"][0]["params"]["compatRuntime"]["sourceContent"] += "\n# tampered"

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    compiled = response.json()["data"]
    assert compiled["valid"] is False
    assert compiled["errors"][0]["code"] == "dify_source_digest_mismatch"
    assert len(graphon_client.calls) == 1


@pytest.mark.asyncio
async def test_compile_rejects_an_unpinned_graphon_runtime(client, graphon_client):
    project = await _import_project(client, "pure_logic.yml")
    graphon_client.engine_commit = "untrusted-build"

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    compiled = response.json()["data"]
    assert compiled["valid"] is False
    assert compiled["errors"][0]["code"] == "dify_graphon_unavailable"


@pytest.mark.asyncio
async def test_compile_uses_trusted_binding_metadata(client, graphon_client):
    project = await _import_project(client, "pure_logic.yml")
    compat = project["nodes"][0]["params"]["compatRuntime"]
    compat["contractVersion"] = "attacker-contract"
    compat["engineCommit"] = "attacker-commit"

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    binding_input = response.json()["data"]["plan"]["runtime"]["nodes"][0]["runtime"][
        "binding"
    ]["input"]
    assert binding_input["contractVersion"] == "opencli.graphon.compat.v1"
    assert binding_input["engineCommit"] == GRAPHON_COMMIT


@pytest.mark.asyncio
async def test_compile_leaves_managed_dify_loop_topology_to_graphon(client, graphon_client):
    source = """kind: app
app: {name: Loop, mode: workflow}
workflow:
  graph:
    nodes:
      - id: loop
        data: {type: loop}
      - id: body
        data: {type: template-transform}
    edges:
      - {id: forward, source: loop, target: body}
      - {id: back, source: body, target: loop}
"""
    imported = await client.post("/api/v1/workflows/import/dify", json={"source": source})
    project = imported.json()["data"]["project"]

    response = await client.post("/api/v1/workflows/compile", json={"project": project})

    assert response.json()["data"]["valid"] is True
