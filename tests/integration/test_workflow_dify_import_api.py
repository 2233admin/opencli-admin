from __future__ import annotations

from pathlib import Path

import pytest

from backend.api.v1.dify_imports import get_dify_graphon_client
from backend.main import app
from backend.schemas.workflow import WorkflowProject

FIXTURES = Path(__file__).parents[1] / "fixtures" / "dify"


class FakeGraphonClient:
    async def inspect(self, *, source_content: str, source_sha256: str, policy: dict):
        del source_content, source_sha256, policy
        return {
            "loadStatus": "ready",
            "loadReason": None,
            "engine": {
                "name": "graphon",
                "version": "0.7.0",
                "commit": "b187ce7927fea1a7c137b642be3f78e3abb9f7de",
            },
            "appMode": "workflow",
            "nodes": [
                {"sourceNodeId": "source-start-001", "type": "start", "status": "ready"},
                {"sourceNodeId": "source-end-002", "type": "end", "status": "ready"},
            ],
            "dependencies": [],
            "blockers": [],
        }


class FakeWrongGraphonClient(FakeGraphonClient):
    async def inspect(self, *, source_content: str, source_sha256: str, policy: dict):
        inspection = await super().inspect(
            source_content=source_content,
            source_sha256=source_sha256,
            policy=policy,
        )
        inspection["engine"]["version"] = "0.8.0"
        return inspection


@pytest.fixture
def graphon_client_override():
    app.dependency_overrides[get_dify_graphon_client] = lambda: FakeGraphonClient()
    yield
    app.dependency_overrides.pop(get_dify_graphon_client, None)


@pytest.mark.asyncio
async def test_import_returns_one_managed_package_and_preserves_source_ids(
    client,
    graphon_client_override,
):
    source = (FIXTURES / "pure_logic.yml").read_text(encoding="utf-8")

    response = await client.post(
        "/api/v1/workflows/import/dify",
        json={"source": source},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["inspection"]["loadStatus"] == "ready"
    assert len(data["project"]["nodes"]) == 1
    package = data["project"]["nodes"][0]
    assert package["params"]["packageExecution"] == "managed"
    assert package["params"]["compatRuntime"]["engine"] == "graphon"
    assert package["internals"]["locked"] is True
    assert [node["id"] for node in package["internals"]["nodes"]] == [
        "source-start-001",
        "source-end-002",
    ]


@pytest.mark.asyncio
async def test_canonical_digest_is_stable_across_yaml_formatting(
    client,
    graphon_client_override,
):
    compact = """kind: app
app: {name: Stable, mode: workflow}
workflow: {graph: {nodes: [{id: start, data: {type: start, variables: []}}], edges: []}}
"""
    expanded = """workflow:
  graph:
    edges: []
    nodes:
      - data:
          variables: []
          type: start
        id: start
app:
  mode: workflow
  name: Stable
kind: app
"""

    first = await client.post("/api/v1/workflows/import/dify", json={"source": compact})
    second = await client.post("/api/v1/workflows/import/dify", json={"source": expanded})

    assert first.status_code == second.status_code == 200
    first_runtime = first.json()["data"]["project"]["nodes"][0]["params"]["compatRuntime"]
    second_runtime = second.json()["data"]["project"]["nodes"][0]["params"]["compatRuntime"]
    assert first_runtime["sourceSha256"] == second_runtime["sourceSha256"]
    assert first_runtime["sourceContent"] == second_runtime["sourceContent"]


@pytest.mark.asyncio
async def test_import_rejects_oversized_source(client, graphon_client_override):
    response = await client.post(
        "/api/v1/workflows/import/dify",
        json={"source": "x" * (1024 * 1024 + 1)},
    )

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "dify_source_too_large"


@pytest.mark.asyncio
async def test_import_rejects_unsupported_app_mode(client, graphon_client_override):
    response = await client.post(
        "/api/v1/workflows/import/dify",
        json={"source": "kind: app\napp: {name: Chat, mode: completion}\nworkflow: {}\n"},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "dify_app_mode_unsupported"


@pytest.mark.asyncio
async def test_unknown_node_is_an_explicit_blocker_not_a_generic_action(
    client,
    graphon_client_override,
):
    source = """kind: app
app: {name: Unknown, mode: workflow}
workflow:
  graph:
    nodes:
      - id: mystery
        data: {type: future-node, title: Future}
    edges: []
"""

    response = await client.post("/api/v1/workflows/import/dify", json={"source": source})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["inspection"]["loadStatus"] == "blocked"
    assert data["inspection"]["blockers"] == [
        {
            "code": "dify_node_unsupported",
            "message": 'Dify node type "future-node" is not supported by the pinned runtime.',
            "nodeId": "mystery",
        }
    ]
    internal = data["project"]["nodes"][0]["internals"]["nodes"][0]
    assert internal["ui"]["catalogId"] == "compat.dify.unsupported"
    assert (internal["kind"], internal["capability"]) != ("action", "send")


@pytest.mark.asyncio
async def test_imported_project_and_report_never_return_embedded_secrets(
    client,
    graphon_client_override,
):
    source = """kind: app
app: {name: Secret fixture, mode: workflow}
workflow:
  graph:
    nodes:
      - id: start
        data:
          type: start
          variables: []
          api_key: model-secret-value
          authorization: Bearer http-secret-value
          max_tokens: 512
          headers: "Authorization: Bearer header-secret-value"
          digest_headers: "Authorization: Digest username=alice, response=digest-secret-value"
          header_parameters:
            - key: Authorization
              value: Bearer list-secret-value
    edges: []
"""

    response = await client.post("/api/v1/workflows/import/dify", json={"source": source})

    assert response.status_code == 200
    serialized = response.text
    assert "model-secret-value" not in serialized
    assert "http-secret-value" not in serialized
    assert "header-secret-value" not in serialized
    assert "list-secret-value" not in serialized
    assert "digest-secret-value" not in serialized
    assert '"max_tokens":512' in serialized


@pytest.mark.asyncio
async def test_import_rejects_graphon_runtime_that_does_not_match_the_pin(client):
    app.dependency_overrides[get_dify_graphon_client] = lambda: FakeWrongGraphonClient()
    try:
        source = (FIXTURES / "pure_logic.yml").read_text(encoding="utf-8")
        response = await client.post(
            "/api/v1/workflows/import/dify",
            json={"source": source},
        )
    finally:
        app.dependency_overrides.pop(get_dify_graphon_client, None)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "dify_graphon_unavailable"


@pytest.mark.asyncio
async def test_import_preserves_source_ids_with_opencli_separator_characters(
    client,
    graphon_client_override,
):
    source = """kind: app
app: {name: Source ids, mode: workflow}
workflow:
  graph:
    nodes:
      - id: stage::source__1
        data: {type: start, title: Original}
    edges: []
"""

    response = await client.post("/api/v1/workflows/import/dify", json={"source": source})

    assert response.status_code == 200
    package = response.json()["data"]["project"]["nodes"][0]
    round_tripped = package["internals"]["nodes"][0]
    assert round_tripped["id"].startswith("dify-source-")
    assert round_tripped["ui"]["dify"]["originalId"] == "stage::source__1"
    assert round_tripped["params"]["compatRuntime"]["sourceNodeId"] == "stage::source__1"
    persisted = WorkflowProject.model_validate(response.json()["data"]["project"])
    reloaded = WorkflowProject.model_validate_json(persisted.model_dump_json(by_alias=True))
    reloaded_node = reloaded.nodes[0].internals.nodes[0]
    assert reloaded_node.ui["dify"]["originalId"] == "stage::source__1"
    assert reloaded_node.params["compatRuntime"]["sourceNodeId"] == "stage::source__1"


@pytest.mark.asyncio
async def test_import_disambiguates_internal_id_hash_collisions(
    client,
    graphon_client_override,
):
    reserved_id = "stage::source__1"
    digest = __import__("hashlib").sha256(reserved_id.encode()).hexdigest()[:16]
    colliding_id = f"dify-source-{digest}"
    source = f"""kind: app
app: {{name: Collision, mode: workflow}}
workflow:
  graph:
    nodes:
      - id: {colliding_id}
        data: {{type: start}}
      - id: {reserved_id}
        data: {{type: end}}
    edges:
      - id: edge
        source: {colliding_id}
        target: {reserved_id}
"""

    response = await client.post("/api/v1/workflows/import/dify", json={"source": source})

    assert response.status_code == 200
    package = response.json()["data"]["project"]["nodes"][0]
    internal_ids = [node["id"] for node in package["internals"]["nodes"]]
    assert internal_ids == [colliding_id, f"{colliding_id}-2"]
    edge = package["internals"]["edges"][0]
    assert (edge["source"], edge["target"]) == tuple(internal_ids)
