from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from backend.api.v1.dify_imports import get_dify_graphon_client
from backend.main import app
from backend.schemas.dify_compat import (
    DifyRuntimeEventPage,
    DifyRuntimeRunStart,
)
from backend.workflow.dify_graphon_client import DifyGraphonUnavailableError
from backend.workflow.opencli_hda_tracer import _RUNS

FIXTURE = Path(__file__).parents[1] / "fixtures" / "dify" / "pure_logic.yml"
GRAPHON_COMMIT = "b187ce7927fea1a7c137b642be3f78e3abb9f7de"


class ReplayGraphonClient:
    timeout_seconds = 1.0

    def __init__(self) -> None:
        self.replay_calls: list[int] = []

    async def inspect(self, *, source_content: str, source_sha256: str, policy: dict):
        payload = yaml.safe_load(source_content)
        nodes = payload["workflow"]["graph"]["nodes"]
        return {
            "loadStatus": "ready",
            "loadReason": None,
            "engine": {
                "name": "graphon",
                "version": "0.7.0",
                "commit": GRAPHON_COMMIT,
            },
            "appMode": "workflow",
            "nodes": [
                {
                    "sourceNodeId": node["id"],
                    "type": node["data"]["type"],
                    "status": "ready",
                }
                for node in nodes
            ],
            "dependencies": [],
            "blockers": [],
        }

    async def start_run(self, **_kwargs):
        return DifyRuntimeRunStart.model_validate(
            {
                "contractVersion": "opencli.graphon.compat.v1",
                "runtimeRunId": "graphon-run-1",
                "status": "queued",
                "eventsUrl": "/v1/dify/runs/graphon-run-1/events",
            }
        )

    async def replay_events(self, runtime_run_id: str, *, after_sequence: int):
        assert runtime_run_id == "graphon-run-1"
        self.replay_calls.append(after_sequence)
        if after_sequence == 0:
            return DifyRuntimeEventPage.model_validate(
                {
                    "contractVersion": "opencli.graphon.compat.v1",
                    "runtimeRunId": runtime_run_id,
                    "status": "running",
                    "nextSequence": 2,
                    "events": [
                        {
                            "sequence": 1,
                            "eventType": "node_started",
                            "nodeId": "source-start-001",
                            "payload": {},
                        },
                        {
                            "sequence": 2,
                            "eventType": "node_completed",
                            "nodeId": "source-start-001",
                            "payload": {"outputs": {"started": True}},
                        },
                    ],
                }
            )
        return DifyRuntimeEventPage.model_validate(
            {
                "contractVersion": "opencli.graphon.compat.v1",
                "runtimeRunId": runtime_run_id,
                "status": "completed",
                "nextSequence": 5,
                "events": [
                    {
                        "sequence": 2,
                        "eventType": "node_completed",
                        "nodeId": "source-start-001",
                        "payload": {"outputs": {"duplicate": True}},
                    },
                    {
                        "sequence": 3,
                        "eventType": "node_started",
                        "nodeId": "source-end-002",
                        "payload": {},
                    },
                    {
                        "sequence": 4,
                        "eventType": "node_completed",
                        "nodeId": "source-end-002",
                        "payload": {
                            "outputs": {"answer": "done"},
                            "api_key": "runtime-secret",
                            "sourceContent": "full-source-must-not-persist",
                        },
                    },
                    {
                        "sequence": 5,
                        "eventType": "graph_completed",
                        "payload": {"outputs": {"answer": "done"}},
                    },
                ],
            }
        )

    async def cancel_run(self, _runtime_run_id: str):
        raise AssertionError("completed runs must not be cancelled")


class UnavailableRunGraphonClient(ReplayGraphonClient):
    async def start_run(self, **_kwargs):
        raise DifyGraphonUnavailableError("offline")


@pytest.fixture
def replay_graphon_client():
    graphon = ReplayGraphonClient()
    app.dependency_overrides[get_dify_graphon_client] = lambda: graphon
    yield graphon
    app.dependency_overrides.pop(get_dify_graphon_client, None)
    _RUNS.clear()


async def _import_project(client) -> dict:
    response = await client.post(
        "/api/v1/workflows/import/dify",
        json={"source": FIXTURE.read_text(encoding="utf-8")},
    )
    assert response.status_code == 200
    return response.json()["data"]["project"]


@pytest.mark.asyncio
async def test_managed_dify_run_persists_nested_graphon_events(
    client,
    replay_graphon_client,
):
    project = await _import_project(client)

    response = await client.post(
        "/api/v1/workflows/runs",
        json={"project": project, "runId": "dify-run-projection"},
    )

    assert response.status_code == 202
    projection = response.json()["data"]
    assert projection["status"] == "completed"
    event_response = await client.get("/api/v1/workflows/runs/dify-run-projection/events")
    events = event_response.json()["data"]
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    nested = [event for event in events if len(event["nodePath"]) == 2]
    assert {event["internalNodeId"] for event in nested} == {
        "source-start-001",
        "source-end-002",
    }
    assert all(event["nodePath"][1] == event["internalNodeId"] for event in nested)
    assert sum(
        event["details"].get("runtimeSequence") == 2 for event in nested
    ) == 1
    serialized = event_response.text
    assert "runtime-secret" not in serialized
    assert "full-source-must-not-persist" not in serialized
    assert replay_graphon_client.replay_calls == [0, 2]


@pytest.mark.asyncio
async def test_managed_dify_event_replay_survives_memory_reset(
    client,
    replay_graphon_client,
):
    project = await _import_project(client)
    await client.post(
        "/api/v1/workflows/runs",
        json={"project": project, "runId": "dify-run-replay"},
    )
    initial = (
        await client.get("/api/v1/workflows/runs/dify-run-replay/events")
    ).json()["data"]

    _RUNS.clear()
    replayed = (
        await client.get("/api/v1/workflows/runs/dify-run-replay/events")
    ).json()["data"]

    assert replayed == initial


@pytest.mark.asyncio
async def test_managed_dify_run_maps_sidecar_unavailability_to_stable_failure(client):
    graphon = UnavailableRunGraphonClient()
    app.dependency_overrides[get_dify_graphon_client] = lambda: graphon
    try:
        project = await _import_project(client)
        response = await client.post(
            "/api/v1/workflows/runs",
            json={"project": project, "runId": "dify-run-unavailable"},
        )
    finally:
        app.dependency_overrides.pop(get_dify_graphon_client, None)
        _RUNS.clear()

    projection = response.json()["data"]
    assert projection["status"] == "failed"
    package_state = next(
        state for state in projection["nodeStates"] if state["nodeId"].startswith("dify-")
    )
    assert package_state["blockReasons"][0]["code"] == "dify_graphon_unavailable"
