from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.api.v1.workflow_assets import router
from backend.api.v1.workflows import router as legacy_workflow_router
from backend.database import get_db
from backend.models.identity import User, Workspace, WorkspaceMembership, WorkspaceRole
from backend.models.workflow import WorkflowVersion
from backend.models.workflow_run import WorkflowRun
from backend.security.identity import RequestIdentity, get_request_identity


def _graph(label: str) -> dict:
    return {
        "id": "client-draft-id",
        "name": label,
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "normalize",
                "kind": "agent",
                "capability": "normalize",
                "params": {"label": label, "nested": {"value": label}},
            }
        ],
        "edges": [],
    }


def _imported_graph(label: str) -> dict:
    graph = _graph(label)
    graph["nodes"][0].update(
        {
            "params": {
                "compatRuntime": {
                    "target": "n8n",
                    "nodeType": "n8n-nodes-base.set",
                    "sourceNodeId": "source-1",
                }
            },
            "ui": {
                "n8n": {
                    "source": "n8n",
                    "originalId": "source-1",
                    "type": "n8n-nodes-base.set",
                    "parameters": {"fixtureOutput": {"validated": True}},
                }
            },
        }
    )
    return graph


async def _seed_member(db_session):
    user = User(subject="workflow-maintainer")
    workspace = Workspace(name="Workflow Lab", slug="workflow-lab")
    db_session.add_all((user, workspace))
    await db_session.flush()
    db_session.add(
        WorkspaceMembership(
            workspace_id=workspace.id,
            user_id=user.id,
            role=WorkspaceRole.MAINTAINER,
        )
    )
    await db_session.commit()
    return workspace


async def _client(db_session) -> AsyncClient:
    app = FastAPI()
    app.include_router(router)
    app.include_router(legacy_workflow_router)

    async def override_db():
        yield db_session

    async def override_identity():
        return RequestIdentity(subject="workflow-maintainer")

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_request_identity] = override_identity
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_published_workflow_is_immutable_and_run_pins_version(db_session):
    workspace = await _seed_member(db_session)
    client = await _client(db_session)
    base = f"/workspaces/{workspace.id}/projects"

    async with client:
        project_response = await client.post(
            base,
            json={"name": "Market data", "slug": "market-data"},
        )
        assert project_response.status_code == 201
        project_id = project_response.json()["data"]["id"]

        workflow_response = await client.post(
            f"{base}/{project_id}/workflows",
            json={"name": "Normalize feed", "graph": _graph("v1")},
        )
        assert workflow_response.status_code == 201
        workflow_id = workflow_response.json()["data"]["id"]
        workflow_base = f"{base}/{project_id}/workflows/{workflow_id}"

        listed = await client.get(f"{base}/{project_id}/workflows")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["data"]] == [workflow_id]

        published = await client.post(
            f"{workflow_base}/versions",
            json={"reason": "First stable graph"},
        )
        assert published.status_code == 201
        version_one = published.json()["data"]
        assert version_one["graph"]["id"] == workflow_id
        assert version_one["graph"]["nodes"][0]["params"]["label"] == "v1"

        updated = await client.put(
            f"{workflow_base}/draft",
            json={"revision": 1, "graph": _graph("v2")},
        )
        assert updated.status_code == 200
        assert updated.json()["data"]["revision"] == 2

        unchanged = await client.get(f"{workflow_base}/versions/1")
        assert unchanged.status_code == 200
        assert unchanged.json()["data"]["graph"] == version_one["graph"]

        run = await client.post(f"{workflow_base}/versions/1/runs", json={})
        assert run.status_code == 202
        run_id = run.json()["data"]["runId"]
        scoped_read = await client.get(f"{workflow_base}/versions/1/runs/{run_id}")
        assert scoped_read.status_code == 200
        unscoped_read = await client.get(f"/workflows/runs/{run_id}")
        assert unscoped_read.status_code == 404

    version_row = await db_session.scalar(
        select(WorkflowVersion)
        .where(WorkflowVersion.workflow_id == workflow_id)
        .where(WorkflowVersion.version == 1)
    )
    run_row = await db_session.get(WorkflowRun, run_id)
    assert version_row is not None
    assert run_row is not None
    assert run_row.workflow_version_id == version_row.id
    assert run_row.request["project"]["nodes"][0]["params"]["label"] == "v1"


async def test_duplicate_workflow_name_returns_conflict(db_session):
    workspace = await _seed_member(db_session)
    client = await _client(db_session)
    base = f"/workspaces/{workspace.id}/projects"

    async with client:
        project = await client.post(base, json={"name": "Feeds", "slug": "feeds"})
        project_id = project.json()["data"]["id"]
        path = f"{base}/{project_id}/workflows"
        first = await client.post(path, json={"name": "Normalize", "graph": _graph("v1")})
        duplicate = await client.post(
            path,
            json={"name": "Normalize", "graph": _graph("v2")},
        )

    assert first.status_code == 201
    assert duplicate.status_code == 409


async def test_imported_draft_requires_completed_validation_for_same_revision(db_session):
    workspace = await _seed_member(db_session)
    client = await _client(db_session)
    base = f"/workspaces/{workspace.id}/projects"

    async with client:
        project = await client.post(base, json={"name": "Imports", "slug": "imports"})
        project_id = project.json()["data"]["id"]
        workflow = await client.post(
            f"{base}/{project_id}/workflows",
            json={"name": "Imported n8n", "graph": _imported_graph("v1")},
        )
        workflow_id = workflow.json()["data"]["id"]
        workflow_base = f"{base}/{project_id}/workflows/{workflow_id}"

        blocked = await client.post(
            f"{workflow_base}/versions", json={"reason": "Unvalidated import"}
        )
        assert blocked.status_code == 409
        assert blocked.json()["detail"]["draftRevision"] == 1

        validation = await client.post(f"{workflow_base}/draft/validation-runs", json={})
        assert validation.status_code == 202
        assert validation.json()["data"]["status"] == "completed"

        published = await client.post(
            f"{workflow_base}/versions", json={"reason": "Validated import"}
        )
        assert published.status_code == 201

        versions = await client.get(f"{workflow_base}/versions")
        assert versions.status_code == 200
        assert [version["version"] for version in versions.json()["data"]] == [1]

        updated = await client.put(
            f"{workflow_base}/draft",
            json={"revision": 1, "graph": _imported_graph("v2")},
        )
        assert updated.json()["data"]["revision"] == 2
        stale_validation = await client.post(
            f"{workflow_base}/versions", json={"reason": "Stale validation"}
        )
        assert stale_validation.status_code == 409
        assert stale_validation.json()["detail"]["draftRevision"] == 2


async def test_stale_draft_revision_returns_conflict_without_overwrite(db_session):
    workspace = await _seed_member(db_session)
    client = await _client(db_session)
    base = f"/workspaces/{workspace.id}/projects"

    async with client:
        project = await client.post(base, json={"name": "Drafts", "slug": "drafts"})
        project_id = project.json()["data"]["id"]
        workflow = await client.post(
            f"{base}/{project_id}/workflows",
            json={"name": "Concurrent edits", "graph": _graph("v1")},
        )
        workflow_id = workflow.json()["data"]["id"]
        draft_path = f"{base}/{project_id}/workflows/{workflow_id}/draft"

        saved = await client.put(
            draft_path,
            json={"revision": 1, "graph": _graph("v2")},
        )
        conflict = await client.put(
            draft_path,
            json={"revision": 1, "graph": _graph("stale")},
        )
        current = await client.get(draft_path)

    assert saved.status_code == 200
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {
        "code": "draft_revision_conflict",
        "latestRevision": 2,
    }
    assert current.json()["data"]["revision"] == 2
    assert current.json()["data"]["graph"]["nodes"][0]["params"]["label"] == "v2"


async def test_legacy_workflow_run_remains_unpinned(client, db_session):
    response = await client.post(
        "/api/v1/workflows/runs",
        json={"project": _graph("legacy")},
    )

    assert response.status_code == 202
    run = await db_session.get(WorkflowRun, response.json()["data"]["runId"])
    assert run is not None
    assert run.workflow_version_id is None
