import pytest

PROJECT_APP_TYPES = ("chatbot", "agent", "chatflow", "workflow", "text-generator")


@pytest.mark.asyncio
async def test_studio_project_workflow_draft_persists(client):
    workspaces = (await client.get("/api/v1/workspaces")).json()["data"]
    assert len(workspaces) == 1
    workspace_id = workspaces[0]["id"]

    project_response = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects",
        json={"name": "采集项目", "slug": "collection", "description": "真实后端项目"},
    )
    assert project_response.status_code == 201, project_response.text
    project = project_response.json()["data"]
    assert project["app_type"] == "workflow"

    graph = {"id": "temporary", "name": "采集流", "nodes": [], "edges": [], "adapters": []}
    workflow_response = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project['id']}/workflows",
        json={"name": "采集流", "graph": graph},
    )
    assert workflow_response.status_code == 201, workflow_response.text
    workflow = workflow_response.json()["data"]

    draft_url = (
        f"/api/v1/workspaces/{workspace_id}/projects/{project['id']}"
        f"/workflows/{workflow['id']}/draft"
    )
    draft = (await client.get(draft_url)).json()["data"]
    assert draft["revision"] == 1
    assert draft["graph"]["id"] == workflow["id"]

    updated_graph = {**draft["graph"], "name": "已保存采集流"}
    update_response = await client.put(
        draft_url, json={"graph": updated_graph, "revision": 1}
    )
    assert update_response.status_code == 200
    assert update_response.json()["data"]["revision"] == 2

    stale_response = await client.put(
        draft_url, json={"graph": updated_graph, "revision": 1}
    )
    assert stale_response.status_code == 409

    listed = (
        await client.get(
            f"/api/v1/workspaces/{workspace_id}/projects/{project['id']}/workflows"
        )
    ).json()["data"]
    assert [item["id"] for item in listed] == [workflow["id"]]


@pytest.mark.asyncio
async def test_studio_project_app_type_is_validated_and_listed(client):
    workspace_id = (await client.get("/api/v1/workspaces")).json()["data"][0]["id"]

    created = []
    for app_type in PROJECT_APP_TYPES:
        response = await client.post(
            f"/api/v1/workspaces/{workspace_id}/projects",
            json={
                "name": f"{app_type} project",
                "slug": f"{app_type}-project",
                "app_type": app_type,
            },
        )
        assert response.status_code == 201, response.text
        project = response.json()["data"]
        assert project["app_type"] == app_type
        created.append(project)

    invalid = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects",
        json={"name": "invalid project", "slug": "invalid-project", "app_type": "tool"},
    )
    assert invalid.status_code == 422

    listed = (await client.get(f"/api/v1/workspaces/{workspace_id}/projects")).json()["data"]
    listed_types = {project["slug"]: project["app_type"] for project in listed}
    assert listed_types == {project["slug"]: project["app_type"] for project in created}
