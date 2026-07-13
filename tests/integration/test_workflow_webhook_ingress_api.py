"""Integration coverage for workflow-specific webhook ingress."""

import pytest


def _webhook_project(*, trigger_ui: dict | None = None) -> dict:
    return {
        "id": "wf-webhook-ingress",
        "name": "Webhook ingress workflow",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "incoming-webhook",
                "kind": "schedule",
                "capability": "trigger",
                "params": {"method": "POST", "path": "/incoming"},
                "ui": trigger_ui or {"primitiveId": "primitive.core.webhook-trigger"},
            },
            {
                "id": "after-webhook",
                "kind": "agent",
                "capability": "normalize",
                "params": {"language": "zh-CN"},
                "ui": {"catalogId": "intelligence.processing.normalize"},
            },
        ],
        "edges": [
            {
                "id": "webhook-normalize",
                "source": "incoming-webhook",
                "target": "after-webhook",
                "sourcePort": "request",
                "targetPort": "in",
            }
        ],
        "adapters": [],
        "agentPermissions": {
            "canFetchNetwork": False,
            "canSendNotifications": False,
            "canWriteInbox": True,
            "allowedDomains": [],
        },
    }


@pytest.mark.asyncio
async def test_workflow_webhook_ingress_rejects_malformed_payload(client):
    response = await client.post(
        "/api/v1/workflows/wf-webhook-ingress/webhooks/incoming-webhook",
        json={"workflowProject": _webhook_project(), "input": {"payload": []}},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_workflow_webhook_ingress_rejects_unsupported_trigger_node(client):
    project = _webhook_project(trigger_ui={"catalogId": "intelligence.schedule.cron"})
    response = await client.post(
        "/api/v1/workflows/wf-webhook-ingress/webhooks/incoming-webhook",
        json={"workflowProject": project, "input": {"payload": {"event": "created"}}},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "unsupported_webhook_trigger",
        "message": (
            "The selected node does not implement the workflow webhook input contract."
        ),
        "workflowId": "wf-webhook-ingress",
        "nodeId": "incoming-webhook",
    }


@pytest.mark.asyncio
async def test_workflow_webhook_ingress_starts_run_with_traceable_identifiers(client):
    project = _webhook_project()
    response = await client.post(
        "/api/v1/workflows/wf-webhook-ingress/webhooks/incoming-webhook",
        headers={
            "Idempotency-Key": "delivery-001",
            "X-Request-ID": "request-001",
            "X-Source-ID": "github-app-001",
        },
        json={
            "workflowProject": project,
            "input": {
                "payload": {"event": "created", "item": {"id": "item-001"}},
                "query": {"tenant": "acme"},
            },
        },
    )

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["workflowId"] == "wf-webhook-ingress"
    assert data["triggerNodeId"] == "incoming-webhook"
    assert data["requestId"] == "request-001"
    assert data["sourceId"] == "github-app-001"
    assert data["idempotencyKey"] == "delivery-001"
    assert data["projectionPath"] == f"/api/v1/workflows/runs/{data['runId']}"
    assert data["eventsPath"] == f"/api/v1/workflows/runs/{data['runId']}/events"
    assert data["projection"]["workflowId"] == data["workflowId"]
    assert data["projection"]["runId"] == data["runId"]
    assert data["projection"]["traceId"] == data["traceId"]

    events_response = await client.get(data["eventsPath"])
    assert events_response.status_code == 200
    events = events_response.json()["data"]
    webhook_events = [event for event in events if event["nodeId"] == "incoming-webhook"]
    downstream_events = [event for event in events if event["nodeId"] == "after-webhook"]
    assert [event["eventType"] for event in webhook_events] == [
        "queued",
        "started",
        "partial",
        "completed",
    ]
    assert downstream_events[-1]["eventType"] == "completed"
    partial = webhook_events[2]
    assert partial["workflowId"] == data["workflowId"]
    assert partial["workflowRunId"] == data["runId"]
    assert partial["traceId"] == data["traceId"]
    assert partial["sourceId"] == "github-app-001"
    assert partial["details"]["nodeId"] == "incoming-webhook"
    assert partial["details"]["sourceId"] == "github-app-001"
    assert partial["details"]["requestId"] == "request-001"
    assert partial["details"]["runtimeInputEnvelope"]["request"]["payload"] == {
        "event": "created",
        "item": {"id": "item-001"},
    }
    assert downstream_events[-1]["sourceId"] == "github-app-001"

    stream_response = await client.get(f"{data['eventsPath']}/stream")
    assert stream_response.status_code == 200
    assert '"sourceId":"github-app-001"' in stream_response.text

    replay = await client.post(
        "/api/v1/workflows/wf-webhook-ingress/webhooks/incoming-webhook",
        headers={"Idempotency-Key": "delivery-001", "X-Request-ID": "request-retry"},
        json={"workflowProject": project, "input": {"payload": {"event": "duplicate"}}},
    )
    assert replay.status_code == 202
    assert replay.json()["data"]["runId"] == data["runId"]
