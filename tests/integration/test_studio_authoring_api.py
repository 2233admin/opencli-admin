import pytest

from tests.fixtures.workflow_conformance import workflow_conformance_project


@pytest.mark.asyncio
async def test_studio_project_workflow_draft_persists(client):
    workspaces = (await client.get("/api/v1/workspaces")).json()["data"]
    assert len(workspaces) == 1
    workspace_id = workspaces[0]["id"]

    graph = workflow_conformance_project()
    bootstrap_response = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/bootstrap",
        json={
            "project": {
                "name": "采集项目",
                "slug": "collection",
                "description": "真实后端项目",
            },
            "workflow": {"name": "采集流", "graph": graph},
        },
    )
    assert bootstrap_response.status_code == 201, bootstrap_response.text
    bootstrap = bootstrap_response.json()["data"]
    project = bootstrap["project"]
    workflow = bootstrap["primary_workflow"]
    assert project["app_type"] == "workflow"

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

    project_after_first_workflow = (
        await client.get(f"/api/v1/workspaces/{workspace_id}/projects")
    ).json()["data"][0]
    assert project_after_first_workflow["primary_workflow_id"] == workflow["id"]

    second_workflow_response = await client.post(
        f"/api/v1/workspaces/{workspace_id}/projects/{project['id']}/workflows",
        json={"name": "辅助流", "graph": graph},
    )
    assert second_workflow_response.status_code == 201, second_workflow_response.text
    project_after_second_workflow = (
        await client.get(f"/api/v1/workspaces/{workspace_id}/projects")
    ).json()["data"][0]
    assert project_after_second_workflow["primary_workflow_id"] == workflow["id"]
