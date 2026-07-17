"""HTTP-seam tests for the EvidenceBatch projection API."""

from __future__ import annotations

import pytest

from backend.workflow.opencli_hda_tracer import _RUNS
from tests.integration.test_workflow_opencli_hda_trace_api import (
    _multi_source_opencli_hda_project,
)


def _native_first_loop_project() -> dict:
    """Mirror the proven native-first-loop fixture used in issue 06 tests.

    The shape (source -> normalize -> merge -> accept -> record-sink) is the
    only one that exercises both batch refs and record-sink persistence
    without compile errors, so we reuse it for projection coverage.
    """

    return {
        "id": "wf-evidence-projection",
        "name": "Evidence projection fixture",
        "profile": "intelligence",
        "version": 1,
        "nodes": [
            {
                "id": "source-bilibili",
                "kind": "source",
                "capability": "fetch",
                "adapter": "opencli-bilibili",
                "params": {
                    "site": "bilibili",
                    "command": "search",
                    "fixtureItems": [
                        {
                            "title": "Bilibili AI video",
                            "url": "https://www.bilibili.com/video/ai",
                            "content": "AI video update",
                        }
                    ],
                },
                "ui": {"catalogId": "intelligence.source.opencli-slot"},
            },
            {
                "id": "source-xhs",
                "kind": "source",
                "capability": "fetch",
                "adapter": "opencli-xhs",
                "params": {
                    "site": "xiaohongshu",
                    "command": "search",
                    "fixtureItems": [
                        {
                            "title": "XHS AI note",
                            "url": "https://www.xiaohongshu.com/explore/ai",
                            "content": "AI note update",
                        }
                    ],
                },
                "ui": {"catalogId": "intelligence.source.opencli-slot"},
            },
            {
                "id": "normalize-bilibili",
                "kind": "agent",
                "capability": "normalize",
                "params": {"language": "zh-CN", "preserveSourceRefs": True},
                "ui": {"catalogId": "intelligence.processing.normalize"},
            },
            {
                "id": "normalize-xhs",
                "kind": "agent",
                "capability": "normalize",
                "params": {"language": "zh-CN", "preserveSourceRefs": True},
                "ui": {"catalogId": "intelligence.processing.normalize"},
            },
            {
                "id": "merge-candidates",
                "kind": "flow",
                "capability": "merge",
                "params": {
                    "strategy": "concat",
                    "preserveLineage": True,
                    "inputType": "recordCandidate[]",
                    "outputType": "recordCandidate[]",
                },
                "ui": {"catalogId": "intelligence.flow.merge"},
            },
            {
                "id": "accept-records",
                "kind": "control",
                "capability": "accept",
                "params": {
                    "mode": "automatic_with_review",
                    "schema": "record.v1",
                    "dedupe": "required",
                    "lineageRequired": True,
                    "minQuality": 0,
                },
                "ui": {"catalogId": "intelligence.control.record-acceptance"},
            },
            {
                "id": "record-sink",
                "kind": "sink",
                "capability": "store",
                "params": {
                    "target": "records",
                    "writeMode": "append",
                    "preserveLineage": True,
                },
                "ui": {"catalogId": "intelligence.sink.records"},
            },
        ],
        "edges": [
            {
                "id": "e-source1-normalize",
                "source": "source-bilibili",
                "target": "normalize-bilibili",
            },
            {
                "id": "e-source2-normalize",
                "source": "source-xhs",
                "target": "normalize-xhs",
            },
            {
                "id": "e-normalize1-merge",
                "source": "normalize-bilibili",
                "target": "merge-candidates",
                "sourcePort": "out",
                "targetPort": "in1",
            },
            {
                "id": "e-normalize2-merge",
                "source": "normalize-xhs",
                "target": "merge-candidates",
                "sourcePort": "out",
                "targetPort": "in2",
            },
            {
                "id": "e-merge-accept",
                "source": "merge-candidates",
                "target": "accept-records",
                "sourcePort": "out",
                "targetPort": "candidates",
            },
            {
                "id": "e-accept-sink",
                "source": "accept-records",
                "target": "record-sink",
                "sourcePort": "records",
                "targetPort": "records",
            },
        ],
        "adapters": [
            {
                "id": "opencli-bilibili",
                "type": "source",
                "provider": "opencli",
                "mode": "live",
                "config": {"channel": "opencli"},
            },
            {
                "id": "opencli-xhs",
                "type": "source",
                "provider": "opencli",
                "mode": "live",
                "config": {"channel": "opencli"},
            },
        ],
        "agentPermissions": {
            "canFetchNetwork": True,
            "canSendNotifications": False,
            "canWriteInbox": True,
            "allowedDomains": ["bilibili.com", "xiaohongshu.com"],
        },
    }


def _opencli_hda_project() -> dict:
    """Project fixture that emits real batch_ready events.

    The Multi Source OpenCLI HDA path is what actually produces batch refs at
    runtime, so we reuse the proven fixture from issue 06 to exercise the
    batch projection surface.
    """

    project = _multi_source_opencli_hda_project()
    project["id"] = "wf-evidence-opencli-hda"
    return project


@pytest.mark.asyncio
async def test_evidence_batches_list_pagination_and_filter(client):
    start = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-evidence-list",
            "traceId": "trace-evidence-list",
        },
    )
    assert start.status_code == 202
    assert start.json()["data"]["runId"] == "run-evidence-list"
    _RUNS.pop("run-evidence-list", None)

    response = await client.get(
        "/api/v1/workflows/runs/run-evidence-list/evidence-batches",
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["runId"] == "run-evidence-list"
    assert len(payload["batches"]) >= 1
    sample = payload["batches"][0]
    assert sample["runId"] == "run-evidence-list"
    assert sample["nodeId"]
    assert sample["batchId"]
    assert sample["status"] in {"ready", "ingested", "partial"}
    assert sample["traceId"] == "trace-evidence-list"
    assert sample["manifestUri"].startswith(
        f"/api/v1/workflows/runs/run-evidence-list/batches/{sample['batchId']}"
    )
    assert sample["odpRef"].startswith(
        f"odp://workflow-runs/run-evidence-list/nodes/{sample['nodeId']}"
    )

    bili_only = await client.get(
        "/api/v1/workflows/runs/run-evidence-list/evidence-batches",
        params={"nodeId": "multi-source-opencli::source-bilibili"},
    )
    bili_payload = bili_only.json()["data"]
    assert bili_payload["runId"] == "run-evidence-list"
    assert {batch["nodeId"] for batch in bili_payload["batches"]} == {
        "multi-source-opencli::source-bilibili"
    }

    paged = await client.get(
        "/api/v1/workflows/runs/run-evidence-list/evidence-batches",
        params={"limit": 1},
    )
    page = paged.json()["data"]
    assert len(page["batches"]) == 1
    assert page["nextCursor"] == page["batches"][0]["batchId"]

    next_page = await client.get(
        "/api/v1/workflows/runs/run-evidence-list/evidence-batches",
        params={"limit": 1, "cursor": page["nextCursor"]},
    )
    next_payload = next_page.json()["data"]
    if next_payload["batches"]:
        assert next_payload["batches"][0]["batchId"] != page["batches"][0]["batchId"]


@pytest.mark.asyncio
async def test_evidence_batches_returns_404_for_unknown_run(client):
    response = await client.get(
        "/api/v1/workflows/runs/missing-run/evidence-batches",
    )
    assert response.status_code == 404
    detail = response.json().get("detail") or response.json().get("error") or ""
    assert "not found" in detail.lower()


@pytest.mark.asyncio
async def test_evidence_batch_detail_links_run_node_and_batch(client):
    start = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-evidence-detail",
            "traceId": "trace-evidence-detail",
        },
    )
    assert start.status_code == 202
    _RUNS.pop("run-evidence-detail", None)

    list_response = await client.get(
        "/api/v1/workflows/runs/run-evidence-detail/evidence-batches",
    )
    batches = list_response.json()["data"]["batches"]
    assert batches, "fixture must produce at least one batch"
    target = batches[0]
    batch_id = target["batchId"]

    detail = await client.get(
        f"/api/v1/workflows/runs/run-evidence-detail/evidence-batches/{batch_id}",
    )
    assert detail.status_code == 200
    detail_payload = detail.json()["data"]
    assert detail_payload["runId"] == "run-evidence-detail"
    assert detail_payload["batch"]["batchId"] == batch_id
    assert detail_payload["manifestUri"] == target["manifestUri"]
    assert detail_payload["odpRef"] == target["odpRef"]
    assert detail_payload["recordCount"] == target["recordCount"]
    assert detail_payload["itemCount"] == target["itemCount"]
    assert detail_payload["sourceCoverage"], "source coverage must be projected"
    coverage_groups = {entry["sourceGroup"] for entry in detail_payload["sourceCoverage"]}
    assert target["sourceGroup"] in coverage_groups

    missing = await client.get(
        "/api/v1/workflows/runs/run-evidence-detail/evidence-batches/not-a-real-batch",
    )
    assert missing.status_code == 404
    detail = missing.json().get("detail") or missing.json().get("error") or ""
    assert "not found" in detail.lower()


@pytest.mark.asyncio
async def test_evidence_run_projection_with_includes(client):
    start = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-evidence-projection",
            "traceId": "trace-evidence-projection",
        },
    )
    assert start.status_code == 202
    _RUNS.pop("run-evidence-projection", None)

    projection = await client.get(
        "/api/v1/workflows/runs/run-evidence-projection/projection",
        params={"include": "clusters,missingSources,summaries,conflicts"},
    )
    assert projection.status_code == 200
    body = projection.json()["data"]
    assert body["runId"] == "run-evidence-projection"
    assert body["status"] in {"completed", "partial", "running", "queued"}
    assert body["valid"] is True
    assert body["nodes"]
    assert body["artifacts"], "artifacts must include manifest/trace refs"
    assert body["batches"]
    assert body["clusters"], "clusters must be projected when requested"
    for cluster in body["clusters"]:
        assert cluster["clusterId"]
        assert cluster["sourceGroups"], "cluster must keep source group refs"
    assert body["summaries"], "summaries must be projected for completed runs"
    assert all(
        entry.get("code") for entry in body["missingSources"]
    ), "missing sources must carry a stable code when present"

    bad_include = await client.get(
        "/api/v1/workflows/runs/run-evidence-projection/projection",
        params={"include": "definitely-not-a-section"},
    )
    assert bad_include.status_code == 400
    detail = bad_include.json().get("detail") or bad_include.json().get("error") or ""
    assert "include" in detail.lower()

    missing_run = await client.get(
        "/api/v1/workflows/runs/missing-run/projection",
    )
    assert missing_run.status_code == 404


@pytest.mark.asyncio
async def test_evidence_projection_filters_batches_by_node(client):
    start = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": _opencli_hda_project(),
            "packageNodeId": "multi-source-opencli",
            "runId": "run-evidence-filter",
            "traceId": "trace-evidence-filter",
        },
    )
    assert start.status_code == 202
    _RUNS.pop("run-evidence-filter", None)

    empty = await client.get(
        "/api/v1/workflows/runs/run-evidence-filter/projection",
        params={"nodeId": "non-existent-node"},
    )
    assert empty.status_code == 200
    body = empty.json()["data"]
    assert body["runId"] == "run-evidence-filter"
    assert body["batches"] == []
    assert body["artifacts"], "trace artifact ref remains even for filtered view"
