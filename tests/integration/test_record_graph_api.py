"""Integration coverage for bounded project record-graph previews."""

import pytest

from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.studio import StudioProject, StudioWorkflow, StudioWorkspace
from backend.models.task import CollectionTask


async def _project(db_session, *, name: str, slug: str):
    workspace = StudioWorkspace(name=f"{name} workspace", slug=f"{slug}-workspace")
    db_session.add(workspace)
    await db_session.flush()
    project = StudioProject(
        workspace_id=workspace.id,
        name=name,
        slug=slug,
        created_by_user_id="local-user",
    )
    db_session.add(project)
    await db_session.flush()
    workflow = StudioWorkflow(project_id=project.id, name=f"{name} workflow")
    db_session.add(workflow)
    await db_session.flush()
    project.primary_workflow_id = workflow.id
    await db_session.flush()
    return workspace, project, workflow


async def _record(
    db_session,
    *,
    workflow_id: str,
    run_id: str,
    source_name: str,
    index: int,
):
    source = DataSource(
        name=source_name,
        channel_type="opencli",
        channel_config={"workflowId": workflow_id, "workflowRunId": run_id},
    )
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(
        source_id=source.id,
        trigger_type="workflow",
        parameters={"workflowId": workflow_id, "workflowRunId": run_id},
        status="completed",
    )
    db_session.add(task)
    await db_session.flush()
    record = CollectedRecord(
        task_id=task.id,
        source_id=source.id,
        workflow_id=workflow_id,
        workflow_run_id=run_id,
        raw_data={"title": f"消息 {index}"},
        normalized_data={
            "title": f"消息 {index}",
            "url": f"https://example.com/items/{index}",
            "tags": ["共同主题"],
        },
        ai_enrichment={"tags": ["共同主题"]},
        content_hash=f"graph-hash-{workflow_id}-{index}",
        status="ai_processed",
    )
    db_session.add(record)
    await db_session.flush()
    return record


@pytest.mark.asyncio
async def test_project_graph_is_scoped_and_contains_bidirectional_semantic_hub(
    client, db_session
):
    workspace, project, workflow = await _project(
        db_session, name="舆情项目", slug="opinion"
    )
    other_workspace, other_project, other_workflow = await _project(
        db_session, name="其他项目", slug="other"
    )
    await _record(
        db_session,
        workflow_id=workflow.id,
        run_id="11111111-1111-4111-8111-111111111111",
        source_name="微博",
        index=1,
    )
    await _record(
        db_session,
        workflow_id=workflow.id,
        run_id="11111111-1111-4111-8111-111111111111",
        source_name="微博",
        index=2,
    )
    await _record(
        db_session,
        workflow_id=other_workflow.id,
        run_id="22222222-2222-4222-8222-222222222222",
        source_name="隔离来源",
        index=3,
    )

    response = await client.get(
        f"/api/v1/workspaces/{workspace.id}/projects/{project.id}/record-graph"
    )

    assert response.status_code == 200
    preview = response.json()["data"]
    assert preview["project_id"] == project.id
    assert preview["stats"]["total_records"] == 2
    assert preview["stats"]["sampled_records"] == 2
    assert preview["stats"]["total_workflows"] == 1
    assert all(node.get("workflow_id") != other_workflow.id for node in preview["nodes"])
    assert any(
        node["kind"] == "entity" and node["label"] == "共同主题"
        for node in preview["nodes"]
    )
    assert any(
        edge["kind"] == "semantic" and edge["bidirectional"] is True
        for edge in preview["edges"]
    )
    assert other_workspace.id != workspace.id
    assert other_project.id != project.id


@pytest.mark.asyncio
async def test_project_graph_exposes_source_published_time_separately_from_ingestion(
    client, db_session
):
    workspace, project, workflow = await _project(
        db_session, name="时效项目", slug="freshness"
    )
    record = await _record(
        db_session,
        workflow_id=workflow.id,
        run_id="33333333-3333-4333-8333-333333333333",
        source_name="实时快讯",
        index=1,
    )
    record.normalized_data = {
        **record.normalized_data,
        "published_at": "2026-07-23T21:51:21+08:00",
    }
    record_without_source_time = await _record(
        db_session,
        workflow_id=workflow.id,
        run_id="33333333-3333-4333-8333-333333333333",
        source_name="无源时间数据",
        index=2,
    )
    await db_session.flush()

    response = await client.get(
        f"/api/v1/workspaces/{workspace.id}/projects/{project.id}/record-graph"
    )

    assert response.status_code == 200
    record_node = next(
        node
        for node in response.json()["data"]["nodes"]
        if node["id"] == f"record:{record.id}"
    )
    assert record_node["source_published_at"] == "2026-07-23T21:51:21+08:00"
    assert record_node["created_at"] != record_node["source_published_at"]
    missing_time_node = next(
        node
        for node in response.json()["data"]["nodes"]
        if node["id"] == f"record:{record_without_source_time.id}"
    )
    assert missing_time_node["source_published_at"] is None
    assert missing_time_node["created_at"] is not None


@pytest.mark.asyncio
async def test_project_graph_prefers_exact_source_display_time_over_date_only_time(
    client, db_session
):
    workspace, project, workflow = await _project(
        db_session, name="公告项目", slug="announcement-freshness"
    )
    record = await _record(
        db_session,
        workflow_id=workflow.id,
        run_id="44444444-4444-4444-8444-444444444444",
        source_name="交易所公告",
        index=1,
    )
    record.raw_data = {
        "title": "公司公告",
        "time": "2026-07-24 00:00:00",
        "noticeDate": "2026-07-24 00:00:00",
        "displayTime": "2026-07-23 21:23:02:245",
    }
    record.normalized_data = {
        **record.normalized_data,
        "published_at": "2026-07-24 00:00:00",
    }
    await db_session.flush()

    response = await client.get(
        f"/api/v1/workspaces/{workspace.id}/projects/{project.id}/record-graph"
    )

    assert response.status_code == 200
    record_node = next(
        node
        for node in response.json()["data"]["nodes"]
        if node["id"] == f"record:{record.id}"
    )
    assert record_node["source_published_at"] == "2026-07-23 21:23:02:245"


@pytest.mark.asyncio
async def test_project_graph_respects_visible_node_budget(client, db_session):
    workspace, project, workflow = await _project(
        db_session, name="大规模项目", slug="large"
    )
    for index in range(140):
        await _record(
            db_session,
            workflow_id=workflow.id,
            run_id=f"00000000-0000-4000-8000-{index:012d}",
            source_name=f"来源 {index}",
            index=index,
        )

    response = await client.get(
        f"/api/v1/workspaces/{workspace.id}/projects/{project.id}/record-graph"
        "?max_nodes=100"
    )

    assert response.status_code == 200
    preview = response.json()["data"]
    assert preview["stats"]["total_records"] == 140
    assert preview["stats"]["visible_nodes"] <= 100
    assert preview["stats"]["visible_edges"] <= 600
    assert preview["truncated"] is True
    assert preview["stats"]["hidden_records"] > 0


@pytest.mark.asyncio
async def test_project_graph_returns_not_found(client):
    response = await client.get(
        "/api/v1/workspaces/missing/projects/missing/record-graph"
    )
    assert response.status_code == 404
