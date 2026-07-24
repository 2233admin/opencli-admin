"""Executable workflow runtime conformance tests."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from backend.database import commit_session
from backend.workflow.block_reasons import WORKFLOW_BLOCK_REASON_TAXONOMY
from backend.workflow.conformance import (
    ConformanceCaseResult,
    load_expected_events,
    match_expected_events,
    parse_sse_node_events,
    write_runtime_passport,
)
from backend.workflow.event_mirror import (
    DEFAULT_WORKFLOW_EVENT_STREAM,
    WORKFLOW_EVENT_MIRROR_PROVIDER,
    list_workflow_event_mirror_records,
    list_workflow_event_mirror_transcript,
)
from backend.workflow.runtime_contracts import list_runtime_io_contracts
from tests.fixtures.workflow_conformance import (
    EXPECTED_FIRST_SLICE_BINDINGS,
    workflow_conformance_missing_runtime_resource_project,
    workflow_conformance_missing_source_credential_project,
    workflow_conformance_missing_webhook_url_project,
    workflow_conformance_project,
    workflow_conformance_source_outputs,
    workflow_conformance_webhook_delivery_project,
)

EXPECTED_EVENTS_DIR = (
    Path(__file__).parents[2] / "backend" / "workflow" / "conformance" / "expected_events"
)


class _FakeRedisStream:
    def __init__(self) -> None:
        self.entries: list[tuple[str, str, dict[str, str]]] = []
        self.closed = False

    async def xadd(self, stream: str, fields: dict[str, str]) -> str:
        entry_id = f"fake-{len(self.entries) + 1}"
        self.entries.append((stream, entry_id, fields))
        return entry_id

    async def xrange(self, stream: str, min: str = "-", max: str = "+"):
        return [
            (entry_id, fields)
            for entry_stream, entry_id, fields in self.entries
            if entry_stream == stream
        ]

    async def aclose(self) -> None:
        self.closed = True


def test_workflow_conformance_block_reason_taxonomy_defines_next_layer_codes():
    expected_categories = {
        "fetch_permission_required": "missing_permission",
        "send_permission_required": "missing_permission",
        "missing_delivery_projection": "missing_config",
        "missing_source_credential": "missing_source_credential",
        "missing_turbopush_service": "missing_runtime_resource",
        "missing_runtime_binding": "missing_runtime_binding",
        "missing_runtime_io_contract": "missing_runtime_binding",
    }

    for code, category in expected_categories.items():
        definition = WORKFLOW_BLOCK_REASON_TAXONOMY[code]
        assert definition.category == category
        assert definition.stable_fields


def test_workflow_conformance_real_node_io_contract_manifest_is_complete():
    required_keys = {
        "bindingId",
        "inputShape",
        "outputShape",
        "permissionGate",
        "configGate",
        "eventShape",
        "fixtureCoverage",
        "certification",
    }

    contracts = list_runtime_io_contracts()
    assert contracts
    for contract in contracts:
        manifest = contract.to_manifest()
        assert required_keys.issubset(manifest)
        assert manifest["bindingId"] == contract.binding_id
        assert isinstance(manifest["inputShape"]["ports"], list)
        assert isinstance(manifest["outputShape"]["ports"], list)
        assert manifest["eventShape"]["events"]
        assert manifest["fixtureCoverage"]["cases"]
        assert manifest["certification"]["realNodeIoContract"] is True

    webhook_contract = next(
        contract
        for contract in contracts
        if contract.binding_id == "workflow.notifier.webhook.send"
    ).to_manifest()
    assert webhook_contract["status"] == "blocked_until_preconditions"
    assert webhook_contract["certification"]["realWebhookDelivery"] is True
    assert webhook_contract["configGate"]["required"] == [
        "evidencebatch_projection_api",
        "delivery_projection",
        "webhook_url",
    ]


@pytest.mark.asyncio
async def test_workflow_conformance_happy_path_matches_expected_transcript(client):
    run_id = "conformance-happy-path"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(),
            "runId": run_id,
            "traceId": "trace-conformance-happy-path",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "completed"

    events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    match = match_expected_events(
        events,
        load_expected_events(EXPECTED_EVENTS_DIR / "happy-path.json"),
    )

    assert match.passed, match.failures


@pytest.mark.asyncio
async def test_workflow_conformance_compile_projects_real_node_io_contracts(client):
    response = await client.post(
        "/api/v1/workflows/compile",
        json={"project": workflow_conformance_project()},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["valid"] is True
    bound_nodes = [
        node
        for node in data["plan"]["runtime"]["nodes"]
        if isinstance(node["runtime"].get("binding"), dict)
    ]
    assert bound_nodes

    for node in bound_nodes:
        binding = node["runtime"]["binding"]
        contract = binding["contract"]
        assert contract["bindingId"] == binding["binding_id"]
        assert contract["certification"]["realNodeIoContract"] is True
        assert set(contract) >= {
            "inputShape",
            "outputShape",
            "permissionGate",
            "configGate",
            "eventShape",
            "fixtureCoverage",
        }


@pytest.mark.asyncio
async def test_workflow_conformance_sse_stream_matches_snapshot_transcript(client):
    run_id = "conformance-sse-parity"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(),
            "runId": run_id,
            "traceId": "trace-conformance-sse-parity",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    expected = load_expected_events(EXPECTED_EVENTS_DIR / "happy-path.json")

    snapshot_events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    snapshot_match = match_expected_events(snapshot_events, expected)
    assert snapshot_match.passed, snapshot_match.failures

    stream_response = await client.get(f"/api/v1/workflows/runs/{run_id}/events/stream")
    assert stream_response.status_code == 200
    assert stream_response.headers["content-type"].startswith("text/event-stream")
    stream_events = parse_sse_node_events(stream_response.text)
    stream_match = match_expected_events(stream_events, expected)
    assert stream_match.passed, stream_match.failures


@pytest.mark.asyncio
async def test_workflow_conformance_redis_event_mirror_matches_snapshot_transcript(
    client,
    db_session,
    monkeypatch,
):
    import redis.asyncio as aioredis

    fake_redis = _FakeRedisStream()
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_BACKEND", "redis")
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_REDIS_URL", "redis://conformance-redis/0")
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_STREAM", DEFAULT_WORKFLOW_EVENT_STREAM)
    monkeypatch.setattr(aioredis, "from_url", lambda *args, **kwargs: fake_redis)

    run_id = "conformance-redis-event-mirror"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(),
            "runId": run_id,
            "traceId": "trace-conformance-redis-event-mirror",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    await commit_session(db_session)
    assert {entry[0] for entry in fake_redis.entries} == {DEFAULT_WORKFLOW_EVENT_STREAM}

    expected = load_expected_events(EXPECTED_EVENTS_DIR / "happy-path.json")
    mirror_events = await list_workflow_event_mirror_transcript(
        run_id,
        backend="redis",
        stream=DEFAULT_WORKFLOW_EVENT_STREAM,
    )
    mirror_match = match_expected_events(mirror_events, expected)
    assert mirror_match.passed, mirror_match.failures

    mirror_records = await list_workflow_event_mirror_records(
        run_id,
        backend="redis",
        stream=DEFAULT_WORKFLOW_EVENT_STREAM,
    )
    assert mirror_records
    assert {record.provider for record in mirror_records} == {WORKFLOW_EVENT_MIRROR_PROVIDER}
    assert {record.ingest_mode for record in mirror_records} == {"stream"}
    assert all(record.stable_facts["nodeId"] for record in mirror_records)


@pytest.mark.asyncio
async def test_workflow_conformance_missing_webhook_url_blocks_with_stable_reason(client):
    run_id = "conformance-missing-webhook-url"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_missing_webhook_url_project(),
            "runId": run_id,
            "traceId": "trace-conformance-missing-webhook-url",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "blocked"
    states = {state["nodeId"]: state for state in projection["nodeStates"]}
    assert states["notify-webhook"]["blockReasons"][0]["code"] == ("missing_delivery_projection")

    events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    match = match_expected_events(
        events,
        load_expected_events(EXPECTED_EVENTS_DIR / "missing-webhook-url.json"),
    )

    assert match.passed, match.failures


@pytest.mark.asyncio
async def test_workflow_conformance_webhook_real_delivery_emits_http_request(
    client,
    monkeypatch,
):
    captured_requests: list[httpx.Request] = []

    async def fake_guarded_async_client(url: str, **client_kwargs):
        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(202, json={"ok": True}, request=request)

        return httpx.AsyncClient(transport=httpx.MockTransport(handler)), url

    monkeypatch.setattr(
        "backend.notifiers.webhook_notifier.guarded_async_client",
        fake_guarded_async_client,
    )

    run_id = "conformance-webhook-real-delivery"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_webhook_delivery_project(),
            "runId": run_id,
            "traceId": "trace-conformance-webhook-real-delivery",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "completed"

    events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    match = match_expected_events(
        events,
        load_expected_events(EXPECTED_EVENTS_DIR / "webhook-real-delivery.json"),
    )
    assert match.passed, match.failures

    assert len(captured_requests) == 1
    request = captured_requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://hooks.example.com/opencli-conformance"
    body = json.loads(request.content.decode("utf-8"))
    assert body["event"] == "workflow.evidence_batch.ready"
    assert body["source_id"] == "workflow-runtime-conformance"
    assert body["record_id"] == run_id
    assert body["data"]["schema"] == "workflow.webhook.evidence_batch.v1"
    assert body["data"]["workflowRunId"] == run_id
    assert body["data"]["nodeId"] == "notify-webhook"
    assert body["data"]["itemCount"] == 1
    assert body["data"]["items"][0]["title"] == "Fed signal: watch rates"


@pytest.mark.asyncio
async def test_workflow_conformance_webhook_delivery_blocks_without_send_permission(
    client,
    monkeypatch,
):
    captured_requests: list[httpx.Request] = []

    async def fake_guarded_async_client(url: str, **client_kwargs):
        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(202, request=request)

        return httpx.AsyncClient(transport=httpx.MockTransport(handler)), url

    monkeypatch.setattr(
        "backend.notifiers.webhook_notifier.guarded_async_client",
        fake_guarded_async_client,
    )

    run_id = "conf-webhook-missing-permission"
    assert len(run_id) <= 36
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_webhook_delivery_project(
                can_send_notifications=False
            ),
            "runId": run_id,
            "traceId": "trace-conformance-webhook-missing-permission",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "blocked"
    states = {state["nodeId"]: state for state in projection["nodeStates"]}
    reason = states["notify-webhook"]["blockReasons"][0]
    assert reason["code"] == "send_permission_required"
    assert reason["details"]["bindingId"] == "workflow.notifier.webhook.send"
    assert captured_requests == []


@pytest.mark.asyncio
async def test_workflow_conformance_webhook_delivery_blocks_without_projection(
    client,
    monkeypatch,
):
    captured_requests: list[httpx.Request] = []

    async def fake_guarded_async_client(url: str, **client_kwargs):
        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(202, request=request)

        return httpx.AsyncClient(transport=httpx.MockTransport(handler)), url

    monkeypatch.setattr(
        "backend.notifiers.webhook_notifier.guarded_async_client",
        fake_guarded_async_client,
    )

    run_id = "conf-webhook-missing-projection"
    assert len(run_id) <= 36
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_webhook_delivery_project(
                include_projection_edge=False
            ),
            "runId": run_id,
            "traceId": "trace-conformance-webhook-missing-projection",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "blocked"
    states = {state["nodeId"]: state for state in projection["nodeStates"]}
    reason = states["notify-webhook"]["blockReasons"][0]
    assert reason["code"] == "missing_delivery_projection"
    assert reason["details"]["bindingId"] == "workflow.notifier.webhook.send"
    assert reason["details"]["required_params"] == [
        "evidencebatch_projection_api",
        "delivery_projection",
    ]
    assert captured_requests == []


@pytest.mark.asyncio
async def test_workflow_conformance_missing_source_credential_blocks_with_stable_reason(
    client,
):
    run_id = "conf-missing-source-credential"
    assert len(run_id) <= 36
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_missing_source_credential_project(),
            "runId": run_id,
            "traceId": "trace-conformance-missing-source-credential",
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "blocked"
    states = {state["nodeId"]: state for state in projection["nodeStates"]}
    assert states["source-jin10"]["blockReasons"][0]["code"] == "missing_source_credential"

    events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    match = match_expected_events(
        events,
        load_expected_events(EXPECTED_EVENTS_DIR / "missing-source-credential.json"),
    )

    assert match.passed, match.failures


@pytest.mark.asyncio
async def test_workflow_conformance_missing_runtime_resource_blocks_with_stable_reason(
    client,
    monkeypatch,
    tmp_path,
):
    monkeypatch.delenv("TURBO_PUSH_PORT", raising=False)
    monkeypatch.delenv("TURBO_PUSH_AUTH", raising=False)
    monkeypatch.setenv("TURBO_PUSH_MCP_CONFIG", str(tmp_path / "missing-mcp.json"))

    run_id = "conformance-missing-runtime-resource"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_missing_runtime_resource_project(),
            "runId": run_id,
            "traceId": "trace-conformance-missing-runtime-resource",
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "blocked"
    states = {state["nodeId"]: state for state in projection["nodeStates"]}
    assert states["publish-turbopush"]["blockReasons"][0]["code"] == ("missing_turbopush_service")

    events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    match = match_expected_events(
        events,
        load_expected_events(EXPECTED_EVENTS_DIR / "missing-runtime-resource.json"),
    )

    assert match.passed, match.failures


@pytest.mark.asyncio
async def test_workflow_conformance_permission_blocked_transcript(client):
    run_id = "conformance-permission-blocked"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(
                can_fetch_network=False,
                can_send_notifications=False,
            ),
            "runId": run_id,
            "traceId": "trace-conformance-permission-blocked",
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "blocked"

    events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    match = match_expected_events(
        events,
        load_expected_events(EXPECTED_EVENTS_DIR / "permission-blocked.json"),
    )

    assert match.passed, match.failures


@pytest.mark.asyncio
async def test_workflow_conformance_missing_binding_transcript(client):
    run_id = "conformance-missing-binding"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(include_unsupported_node=True),
            "runId": run_id,
            "traceId": "trace-conformance-missing-binding",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["valid"] is True
    assert projection["status"] == "blocked"

    events = (await client.get(f"/api/v1/workflows/runs/{run_id}/events")).json()["data"]
    match = match_expected_events(
        events,
        load_expected_events(EXPECTED_EVENTS_DIR / "missing-binding.json"),
    )

    assert match.passed, match.failures


def test_workflow_conformance_passport_is_artifact_scoped(tmp_path):
    passport_path = write_runtime_passport(
        tmp_path / "opencli-conformance" / "local-run",
        [
            ConformanceCaseResult(
                id="happy-path",
                status="passed",
                bindings=EXPECTED_FIRST_SLICE_BINDINGS,
            ),
            ConformanceCaseResult(
                id="permission-blocked",
                status="passed",
                bindings=["workflow.source.fetch", "workflow.notify.send"],
                blockedReasons=[
                    "fetch_permission_required",
                    "send_permission_required",
                ],
            ),
            ConformanceCaseResult(
                id="missing-binding",
                status="passed",
                bindings=[],
                blockedReasons=["missing_runtime_binding"],
            ),
        ],
    )

    assert passport_path.name == "opencli-runtime-passport.json"
    assert passport_path.parent.name == "local-run"
    passport = json.loads(passport_path.read_text(encoding="utf-8"))
    assert passport["schemaVersion"] == 1
    assert passport["eventSource"] == "workflow-run-events"
    assert passport["status"] == "partial"
    assert passport["bindings"]["workflow.notify.send"]["status"] == ("conformance-known")
    assert (
        "send_permission_required"
        in (passport["bindings"]["workflow.notify.send"]["blockedReasons"])
    )
