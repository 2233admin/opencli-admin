import pytest

from tests.fixtures.workflow_conformance import workflow_conformance_project

PROJECT_APP_TYPES = ("chatbot", "agent", "chatflow", "workflow", "text-generator")


def _bootstrap_payload(*, slug: str = "bootstrapped-project") -> dict:
    return {
        "project": {
            "name": "Bootstrapped project",
            "slug": slug,
            "description": "Created atomically",
            "app_type": "workflow",
        },
        "workflow": {
            "name": "Primary workflow",
            "description": "Canonical authoring entry",
            "graph": workflow_conformance_project(),
        },
    }


@pytest.mark.asyncio
async def test_studio_project_bootstrap_creates_primary_workflow_and_draft(client):
    workspace_id = (await client.get("/api/v1/workspaces")).json()["data"][0]["id"]
    response = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/bootstrap",
        json=_bootstrap_payload(),
    )

    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data["project"]["primary_workflow_id"] == data["primary_workflow"]["id"]
    assert data["primary_workflow"]["project_id"] == data["project"]["id"]
    assert data["draft"]["revision"] == 1
    assert data["draft"]["graph"]["id"] == data["primary_workflow"]["id"]
    assert all(
        value is not None
        for node in data["draft"]["graph"]["nodes"]
        for value in node.values()
    )

    draft_url = (
        f"/api/v1/workspaces/{workspace_id}/projects/{data['project']['id']}"
        f"/workflows/{data['primary_workflow']['id']}/draft"
    )
    persisted_draft = (await client.get(draft_url)).json()["data"]
    assert persisted_draft["graph"] == data["draft"]["graph"]
    assert all(
        value is not None
        for node in persisted_draft["graph"]["nodes"]
        for value in node.values()
    )

    projects = (await client.get(f"/api/v1/workspaces/{workspace_id}/projects")).json()[
        "data"
    ]
    assert projects[0]["primary_workflow_id"] == data["primary_workflow"]["id"]


@pytest.mark.asyncio
async def test_studio_project_bootstrap_rejects_invalid_graph_without_orphan_project(client):
    workspace_id = (await client.get("/api/v1/workspaces")).json()["data"][0]["id"]
    payload = _bootstrap_payload(slug="invalid-bootstrap")
    payload["workflow"]["graph"] = {"id": "invalid"}

    response = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/bootstrap",
        json=payload,
    )

    assert response.status_code == 422, response.text
    projects = (await client.get(f"/api/v1/workspaces/{workspace_id}/projects")).json()[
        "data"
    ]
    assert projects == []


@pytest.mark.asyncio
async def test_studio_project_bootstrap_duplicate_slug_creates_no_half_finished_objects(client):
    workspace_id = (await client.get("/api/v1/workspaces")).json()["data"][0]["id"]
    url = f"/api/v1/workspaces/{workspace_id}/projects/bootstrap"
    first = await client.post(url, json=_bootstrap_payload(slug="stable-bootstrap"))
    assert first.status_code == 201, first.text

    duplicate = await client.post(url, json=_bootstrap_payload(slug="stable-bootstrap"))

    assert duplicate.status_code == 409, duplicate.text
    projects = (await client.get(f"/api/v1/workspaces/{workspace_id}/projects")).json()[
        "data"
    ]
    assert [project["id"] for project in projects] == [
        first.json()["data"]["project"]["id"]
    ]
    workflows = (
        await client.get(
            f"/api/v1/workspaces/{workspace_id}/projects/{projects[0]['id']}/workflows"
        )
    ).json()["data"]
    assert [workflow["id"] for workflow in workflows] == [
        first.json()["data"]["primary_workflow"]["id"]
    ]


@pytest.mark.asyncio
async def test_studio_project_app_type_is_validated_and_listed(client):
    workspace_id = (await client.get("/api/v1/workspaces")).json()["data"][0]["id"]

    created = []
    for app_type in PROJECT_APP_TYPES:
        payload = _bootstrap_payload(slug=f"{app_type}-project")
        payload["project"].update(
            {"name": f"{app_type} project", "app_type": app_type}
        )
        response = await client.post(
            f"/api/v1/workspaces/{workspace_id}/projects/bootstrap",
            json=payload,
        )
        assert response.status_code == 201, response.text
        project = response.json()["data"]["project"]
        assert project["app_type"] == app_type
        created.append(project)

    invalid_payload = _bootstrap_payload(slug="invalid-project")
    invalid_payload["project"]["app_type"] = "tool"
    invalid = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/bootstrap",
        json=invalid_payload,
    )
    assert invalid.status_code == 422

    listed = (await client.get(f"/api/v1/workspaces/{workspace_id}/projects")).json()[
        "data"
    ]
    listed_types = {project["slug"]: project["app_type"] for project in listed}
    assert listed_types == {
        project["slug"]: project["app_type"] for project in created
    }
