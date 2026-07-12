"""HTTP-seam tests for the Workspace -> Project -> WorkflowDraft -> WorkflowVersion
persistence closed loop."""

from __future__ import annotations

from copy import deepcopy

import pytest

from tests.fixtures.workflow_conformance import workflow_conformance_project


async def _create_workspace(client, *, slug: str = "macro-desk") -> dict:
    response = await client.post(
        "/api/v1/workspaces",
        json={"name": "Macro Desk", "slug": slug, "description": "Macro workflows"},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _create_project(client, workspace_id: str, *, slug: str = "jin10-watch") -> dict:
    response = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects",
        json={"name": "JIN10 Watch", "slug": slug},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _create_draft(client, project_id: str, *, snapshot: dict | None = None) -> dict:
    response = await client.post(
        f"/api/v1/projects/{project_id}/drafts",
        json={"name": "Draft v1", "snapshot": snapshot or workflow_conformance_project()},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


@pytest.mark.asyncio
async def test_workspace_project_draft_validation_publish_closed_loop(client):
    workspace = await _create_workspace(client)
    settings_response = await client.get(f"/api/v1/workspaces/{workspace['id']}/settings")
    assert settings_response.status_code == 200
    settings = settings_response.json()["data"]
    assert settings["timezone"] == "Asia/Shanghai"
    assert settings["deterministic_simulation"] is True

    project = await _create_project(client, workspace["id"])
    draft = await _create_draft(client, project["id"])
    assert draft["revision"] == 1

    validation_response = await client.post(
        f"/api/v1/drafts/{draft['id']}/validation-runs", json={}
    )
    assert validation_response.status_code == 201, validation_response.text
    validation_run = validation_response.json()["data"]
    assert validation_run["compile_valid"] is True
    assert validation_run["status"] == "passed"

    get_run_response = await client.get(
        f"/api/v1/drafts/{draft['id']}/validation-runs/{validation_run['id']}"
    )
    assert get_run_response.status_code == 200
    assert get_run_response.json()["data"]["id"] == validation_run["id"]

    publish_response = await client.post(
        f"/api/v1/drafts/{draft['id']}/publish",
        json={"validation_run_id": validation_run["id"], "expected_revision": 1},
    )
    assert publish_response.status_code == 200, publish_response.text
    version = publish_response.json()["data"]
    assert version["version_number"] == 1
    assert version["project_id"] == project["id"]

    versions_response = await client.get(f"/api/v1/projects/{project['id']}/versions")
    assert versions_response.status_code == 200
    versions = versions_response.json()["data"]
    assert len(versions) == 1
    assert versions[0]["id"] == version["id"]

    version_response = await client.get(f"/api/v1/versions/{version['id']}")
    assert version_response.status_code == 200
    assert version_response.json()["data"]["id"] == version["id"]


@pytest.mark.asyncio
async def test_draft_update_rejects_stale_revision(client):
    workspace = await _create_workspace(client, slug="macro-desk-2")
    project = await _create_project(client, workspace["id"], slug="jin10-watch-2")
    draft = await _create_draft(client, project["id"])

    snapshot = workflow_conformance_project()
    ok_response = await client.put(
        f"/api/v1/drafts/{draft['id']}",
        json={"snapshot": snapshot, "expected_revision": 1},
    )
    assert ok_response.status_code == 200, ok_response.text
    assert ok_response.json()["data"]["revision"] == 2

    stale_response = await client.put(
        f"/api/v1/drafts/{draft['id']}",
        json={"snapshot": snapshot, "expected_revision": 1},
    )
    assert stale_response.status_code == 409


@pytest.mark.asyncio
async def test_publish_rejects_already_consumed_validation_run(client):
    workspace = await _create_workspace(client, slug="macro-desk-3")
    project = await _create_project(client, workspace["id"], slug="jin10-watch-3")
    draft = await _create_draft(client, project["id"])

    validation_run = (
        await client.post(f"/api/v1/drafts/{draft['id']}/validation-runs", json={})
    ).json()["data"]
    assert validation_run["status"] == "passed"

    first_publish = await client.post(
        f"/api/v1/drafts/{draft['id']}/publish",
        json={"validation_run_id": validation_run["id"], "expected_revision": 1},
    )
    assert first_publish.status_code == 200, first_publish.text

    second_publish = await client.post(
        f"/api/v1/drafts/{draft['id']}/publish",
        json={"validation_run_id": validation_run["id"], "expected_revision": 1},
    )
    assert second_publish.status_code == 409


@pytest.mark.asyncio
async def test_publish_rejects_validation_run_stale_after_draft_update(client):
    workspace = await _create_workspace(client, slug="macro-desk-4")
    project = await _create_project(client, workspace["id"], slug="jin10-watch-4")
    draft = await _create_draft(client, project["id"])

    validation_run = (
        await client.post(f"/api/v1/drafts/{draft['id']}/validation-runs", json={})
    ).json()["data"]

    await client.put(
        f"/api/v1/drafts/{draft['id']}",
        json={"snapshot": workflow_conformance_project(), "expected_revision": 1},
    )

    publish_response = await client.post(
        f"/api/v1/drafts/{draft['id']}/publish",
        json={"validation_run_id": validation_run["id"], "expected_revision": 2},
    )
    assert publish_response.status_code == 409


@pytest.mark.asyncio
async def test_workspace_settings_update_persists(client):
    workspace = await _create_workspace(client, slug="macro-desk-5")

    update_response = await client.put(
        f"/api/v1/workspaces/{workspace['id']}/settings",
        json={"timezone": "UTC", "max_items_per_run": 50},
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()["data"]
    assert updated["timezone"] == "UTC"
    assert updated["max_items_per_run"] == 50

    get_response = await client.get(f"/api/v1/workspaces/{workspace['id']}/settings")
    assert get_response.json()["data"]["timezone"] == "UTC"


@pytest.mark.asyncio
async def test_validation_run_fails_on_invalid_snapshot(client):
    workspace = await _create_workspace(client, slug="macro-desk-6")
    project = await _create_project(client, workspace["id"], slug="jin10-watch-6")
    broken_snapshot = deepcopy(workflow_conformance_project())
    broken_snapshot["edges"].append(
        {"id": "e-dangling", "source": "does-not-exist", "target": "agent-normalize"}
    )
    draft = await _create_draft(client, project["id"], snapshot=broken_snapshot)

    response = await client.post(f"/api/v1/drafts/{draft['id']}/validation-runs", json={})
    assert response.status_code == 201, response.text
    validation_run = response.json()["data"]
    assert validation_run["status"] == "failed"
    assert validation_run["failure_reason"] == "compile_failed"

    publish_response = await client.post(
        f"/api/v1/drafts/{draft['id']}/publish",
        json={"validation_run_id": validation_run["id"], "expected_revision": 1},
    )
    assert publish_response.status_code == 409
