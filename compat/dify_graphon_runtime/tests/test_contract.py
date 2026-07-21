from __future__ import annotations

import hashlib
import time
from textwrap import dedent

from fastapi.testclient import TestClient

from app import app, create_app
from engine import EngineIdentity, GraphonRuntime, RuntimeLimits

PURE_LOGIC_DSL = dedent(
    """
    kind: app
    app:
      mode: workflow
    workflow:
      graph:
        nodes:
          - id: start
            data:
              type: start
              title: Start
              variables: []
          - id: end
            data:
              type: end
              title: End
              outputs: []
        edges:
          - source: start
            target: end
    """
).strip()


def _source(content: str = PURE_LOGIC_DSL) -> dict[str, str]:
    return {
        "format": "dify-app-dsl",
        "sha256": hashlib.sha256(content.encode()).hexdigest(),
        "content": content,
    }


def test_health_reports_the_pinned_graphon_runtime() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["contractVersion"] == "opencli.graphon.compat.v1"
    assert payload["engine"] == {
        "name": "graphon",
        "version": "0.7.0",
        "commit": "b187ce7927fea1a7c137b642be3f78e3abb9f7de",
    }
    assert payload["helpers"]["slim"] == {
        "name": "dify-plugin-daemon-slim",
        "version": "0.6.5",
        "commit": "14877f8f8b6dd63d3cec760411a875cc8e077547",
        "available": False,
    }


def test_inspect_returns_nodes_and_ready_status_for_a_pure_logic_workflow() -> None:
    response = TestClient(app).post(
        "/v1/dify/inspect",
        json={
            "source": _source(),
            "policy": {"allowNetwork": False, "allowCode": False},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["loadStatus"] == "ready"
    assert payload["appMode"] == "workflow"
    assert payload["nodes"] == [
        {"id": "start", "type": "start", "title": "Start"},
        {"id": "end", "type": "end", "title": "End"},
    ]
    assert payload["dependencies"] == []
    assert payload["blockers"] == []


def test_unsupported_dify_app_mode_is_a_contract_result_not_a_500() -> None:
    content = dedent(
        """
        kind: app
        app:
          mode: completion
        """
    ).strip()

    response = TestClient(app).post(
        "/v1/dify/inspect",
        json={"source": _source(content), "policy": {}},
    )

    assert response.status_code == 200
    assert response.json()["loadStatus"] == "unsupported"
    assert "inspect-only" in response.json()["loadReason"]


def test_code_node_is_blocked_when_no_sandbox_permission_is_granted() -> None:
    content = dedent(
        """
        kind: app
        app:
          mode: workflow
        workflow:
          graph:
            nodes:
              - id: start
                data:
                  type: start
                  variables: []
              - id: code
                data:
                  type: code
            edges:
              - source: start
                target: code
        """
    ).strip()

    response = TestClient(app).post(
        "/v1/dify/inspect",
        json={"source": _source(content), "policy": {"allowCode": False}},
    )

    assert response.status_code == 200
    assert response.json()["loadStatus"] == "blocked"
    assert response.json()["blockers"] == [
        {
            "code": "dify_sandbox_required",
            "message": "Code nodes require an explicitly configured Dify sandbox.",
            "nodeId": "code",
        }
    ]


def test_code_node_stays_blocked_without_a_configured_sandbox(
    monkeypatch,
) -> None:
    monkeypatch.delenv("DIFY_SANDBOX_ENDPOINT", raising=False)
    content = dedent(
        """
        kind: app
        app:
          mode: workflow
        workflow:
          graph:
            nodes:
              - id: start
                data: {type: start, variables: []}
              - id: code
                data: {type: code}
            edges:
              - {source: start, target: code}
        """
    ).strip()

    response = TestClient(create_app(GraphonRuntime())).post(
        "/v1/dify/inspect",
        json={"source": _source(content), "policy": {"allowCode": True}},
    )

    assert response.status_code == 200
    assert response.json()["loadStatus"] == "blocked"
    assert response.json()["blockers"][0]["code"] == "dify_sandbox_required"


def test_run_events_are_monotonic_replayable_and_cancellation_is_idempotent() -> None:
    client = TestClient(app)
    run_response = client.post(
        "/v1/dify/runs",
        json={"source": _source(), "policy": {}, "inputs": {}},
    )

    assert run_response.status_code == 202
    runtime_run_id = run_response.json()["runtimeRunId"]
    deadline = time.monotonic() + 5
    replay_payload: dict[str, object] = {}
    while time.monotonic() < deadline:
        replay = client.get(
            f"/v1/dify/runs/{runtime_run_id}/events",
            params={"afterSequence": 0},
        )
        assert replay.status_code == 200
        replay_payload = replay.json()
        if replay_payload["status"] in {"completed", "failed", "cancelled"}:
            break
        time.sleep(0.01)

    assert replay_payload["status"] == "completed"
    events = replay_payload["events"]
    assert isinstance(events, list)
    sequences = [event["sequence"] for event in events]
    assert sequences == list(range(1, len(events) + 1))
    assert events[0]["eventType"] == "graph_started"
    assert events[-1]["eventType"] == "graph_completed"

    cursor = sequences[-1]
    assert (
        client.get(
            f"/v1/dify/runs/{runtime_run_id}/events",
            params={"afterSequence": cursor},
        ).json()["events"]
        == []
    )

    first_cancel = client.post(f"/v1/dify/runs/{runtime_run_id}/cancel")
    second_cancel = client.post(f"/v1/dify/runs/{runtime_run_id}/cancel")
    assert first_cancel.status_code == 200
    assert second_cancel.status_code == 200
    assert first_cancel.json()["status"] == "completed"
    assert second_cancel.json()["status"] == "completed"
    assert first_cancel.json()["cancelRequested"] is True
    assert second_cancel.json()["cancelRequested"] is True


def test_health_is_unhealthy_when_the_graphon_engine_is_unavailable() -> None:
    class UnavailableRuntime:
        identity = EngineIdentity()
        healthy = False
        health_reason = "Graphon import failed: ImportError."

    response = TestClient(create_app(UnavailableRuntime())).get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "unhealthy"
    assert response.json()["reason"] == "Graphon import failed: ImportError."


def test_grant_secrets_are_never_returned_by_run_or_event_responses() -> None:
    leak_sentinel = "redaction-fixture-value"
    client = TestClient(app)
    response = client.post(
        "/v1/dify/runs",
        json={
            "source": _source(),
            "policy": {},
            "grants": {
                "model_credentials": [
                    {"provider": "openai", "values": {"api_key": leak_sentinel}}
                ]
            },
        },
    )

    assert response.status_code == 202
    assert leak_sentinel not in response.text
    runtime_run_id = response.json()["runtimeRunId"]
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        replay = client.get(f"/v1/dify/runs/{runtime_run_id}/events")
        assert leak_sentinel not in replay.text
        if replay.json()["status"] in {"completed", "failed", "cancelled"}:
            break
        time.sleep(0.01)


def test_source_size_limit_returns_a_stable_error_without_a_traceback() -> None:
    runtime = GraphonRuntime(
        limits=RuntimeLimits(
            max_request_bytes=64,
            max_output_bytes=1_048_576,
            execution_timeout_seconds=120,
            max_concurrent_runs=2,
        )
    )
    response = TestClient(create_app(runtime)).post(
        "/v1/dify/inspect",
        json={"source": _source(), "policy": {}},
    )

    assert response.status_code == 413
    assert response.json() == {
        "error": {
            "code": "request.too_large",
            "message": "The DSL source exceeds the configured request limit.",
            "details": {"maxBytes": 64},
        }
    }
    assert "traceback" not in response.text.lower()


def test_large_graphon_event_payload_is_replaced_by_a_bounded_marker() -> None:
    runtime = GraphonRuntime(
        limits=RuntimeLimits(
            max_request_bytes=1_048_576,
            max_output_bytes=180,
            execution_timeout_seconds=120,
            max_concurrent_runs=2,
        )
    )
    client = TestClient(create_app(runtime))
    response = client.post(
        "/v1/dify/runs",
        json={
            "source": _source(),
            "policy": {},
            "inputs": {"large": "x" * 2_000},
        },
    )
    assert response.status_code == 202

    runtime_run_id = response.json()["runtimeRunId"]
    deadline = time.monotonic() + 5
    events: list[dict[str, object]] = []
    while time.monotonic() < deadline:
        replay = client.get(f"/v1/dify/runs/{runtime_run_id}/events")
        events = replay.json()["events"]
        if replay.json()["status"] in {"completed", "failed", "cancelled"}:
            break
        time.sleep(0.01)

    assert any(event["eventType"] == "output_truncated" for event in events)
    assert all(len(str(event).encode()) < 400 for event in events)
