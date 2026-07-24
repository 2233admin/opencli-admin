"""HTTP contract tests for run-scoped EvidenceBatch projections."""

import pytest

from tests.integration.test_workflow_opencli_hda_trace_api import (
    _multi_source_opencli_hda_project,
    _native_first_loop_project,
)


def _runtime_output_project() -> dict:
    project = _native_first_loop_project()
    for node in project["nodes"]:
        if node["id"] in {"source-bilibili", "source-xhs"}:
            node["params"].pop("fixtureItems")
    return project


def _source_outputs() -> dict:
    return {
        "source-bilibili": [
            {
                "title": "Evidence Bilibili item",
                "url": "https://www.bilibili.com/video/evidence",
                "content": "Evidence payload",
            }
        ],
        "source-xhs": [
            {
                "title": "Evidence XHS item",
                "url": "https://www.xiaohongshu.com/explore/evidence",
                "content": "Evidence payload",
            }
        ],
    }


@pytest.mark.asyncio
async def test_evidence_batch_list_detail_projection_and_replay_are_idempotent(client):
    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _runtime_output_project(),
            "runId": "run-evidence-projection",
            "traceId": "trace-evidence-projection",
            "sourceOutputs": _source_outputs(),
        },
    )
    assert started.status_code == 202

    listed = await client.get(
        "/api/v1/workflows/runs/run-evidence-projection/evidence-batches"
    )
    assert listed.status_code == 200
    data = listed.json()["data"]
    assert data["runId"] == "run-evidence-projection"
    assert data["nextCursor"] is None
    assert len(data["batches"]) == 4
    assert {batch["nodeId"] for batch in data["batches"]} == {
        "source-bilibili",
        "source-xhs",
        "normalize-bilibili",
        "normalize-xhs",
    }
    assert len({batch["batchId"] for batch in data["batches"]}) == 4
    assert all(batch["runId"] == "run-evidence-projection" for batch in data["batches"])
    assert all(batch["traceId"] == "trace-evidence-projection" for batch in data["batches"])
    assert all(batch["status"] == "completed" for batch in data["batches"])
    assert all("raw" not in batch for batch in data["batches"])
    assert all(
        batch["manifestUri"]
        == (
            "/api/v1/workflows/runs/run-evidence-projection/"
            f"evidence-batches/{batch['batchId']}"
        )
        for batch in data["batches"]
    )

    first_page = await client.get(
        "/api/v1/workflows/runs/run-evidence-projection/evidence-batches",
        params={"limit": 1},
    )
    first_page_data = first_page.json()["data"]
    assert len(first_page_data["batches"]) == 1
    assert first_page_data["nextCursor"] == first_page_data["batches"][0]["batchId"]
    second_page = await client.get(
        "/api/v1/workflows/runs/run-evidence-projection/evidence-batches",
        params={"limit": 1, "cursor": first_page_data["nextCursor"]},
    )
    assert second_page.json()["data"]["batches"][0]["batchId"] != (
        first_page_data["batches"][0]["batchId"]
    )

    source_batch = next(
        batch for batch in data["batches"] if batch["nodeId"] == "source-bilibili"
    )
    detail = await client.get(
        "/api/v1/workflows/runs/run-evidence-projection/"
        f"evidence-batches/{source_batch['batchId']}"
    )
    detail_data = detail.json()["data"]
    assert detail.status_code == 200
    assert detail_data["batch"] == source_batch
    assert detail_data["sourceCoverage"] == {
        "sourceGroup": "opencli-bilibili",
        "status": "completed",
        "batchCount": 1,
        "itemCount": 1,
        "recordCount": 0,
    }

    projection = await client.get(
        "/api/v1/workflows/runs/run-evidence-projection/projection"
    )
    projection_data = projection.json()["data"]
    assert projection.status_code == 200
    assert projection_data["status"] == "completed"
    assert projection_data["clusters"] == []
    assert projection_data["conflicts"] == []
    assert projection_data["missingSources"] == []
    assert len(projection_data["summaries"]) == 4
    assert len(projection_data["artifacts"]) == 4
    assert "records" not in projection_data

    replay = await client.post(
        "/api/v1/workflows/runs/run-evidence-projection/source-outputs",
        json={"sourceOutputs": _source_outputs()},
    )
    assert replay.status_code == 202
    replayed = (
        await client.get(
            "/api/v1/workflows/runs/run-evidence-projection/evidence-batches"
        )
    ).json()["data"]
    assert [batch["batchId"] for batch in replayed["batches"]] == [
        batch["batchId"] for batch in data["batches"]
    ]
    assert len(replayed["batches"]) == 4


@pytest.mark.asyncio
async def test_evidence_projection_filters_empty_and_validates_requests(client):
    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _runtime_output_project(),
            "runId": "run-evidence-errors",
            "traceId": "trace-evidence-errors",
            "sourceOutputs": _source_outputs(),
        },
    )
    assert started.status_code == 202

    empty = await client.get(
        "/api/v1/workflows/runs/run-evidence-errors/evidence-batches",
        params={"node_id": "missing-node"},
    )
    assert empty.status_code == 200
    assert empty.json()["data"] == {
        "runId": "run-evidence-errors",
        "batches": [],
        "nextCursor": None,
    }

    invalid_cursor = await client.get(
        "/api/v1/workflows/runs/run-evidence-errors/evidence-batches",
        params={"cursor": "unknown-batch"},
    )
    assert invalid_cursor.status_code == 400
    invalid_include = await client.get(
        "/api/v1/workflows/runs/run-evidence-errors/projection",
        params={"include": "summaries,rawRecords"},
    )
    assert invalid_include.status_code == 400
    missing_run = await client.get(
        "/api/v1/workflows/runs/missing-run/evidence-batches"
    )
    assert missing_run.status_code == 404
    missing_batch = await client.get(
        "/api/v1/workflows/runs/run-evidence-errors/evidence-batches/missing-batch"
    )
    assert missing_batch.status_code == 404


@pytest.mark.asyncio
async def test_failed_and_blocked_nodes_remain_typed_in_evidence_projection(
    client,
    monkeypatch,
):
    async def failed_dispatch(dispatch, fleet_match, *, node=None):
        return [], {
            "attempted": True,
            "success": False,
            "error": "worker unavailable",
        }

    monkeypatch.setattr(
        "backend.workflow.opencli_hda_tracer._dispatch_opencli_source_to_fleet",
        failed_dispatch,
    )
    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _multi_source_opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-evidence-failed",
            "traceId": "trace-evidence-failed",
        },
    )
    assert started.status_code == 202
    assert started.json()["data"]["status"] == "failed"

    batches = (
        await client.get(
            "/api/v1/workflows/runs/run-evidence-failed/evidence-batches"
        )
    ).json()["data"]["batches"]
    assert len(batches) == 3
    assert {batch["status"] for batch in batches} == {"completed", "failed"}
    assert len([batch for batch in batches if batch["status"] == "failed"]) == 2

    projection = (
        await client.get("/api/v1/workflows/runs/run-evidence-failed/projection")
    ).json()["data"]
    assert projection["status"] == "failed"
    assert {entry["status"] for entry in projection["missingSources"]} >= {
        "blocked",
        "failed",
    }
    assert all("reasons" in entry for entry in projection["missingSources"])
