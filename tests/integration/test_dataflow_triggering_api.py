"""HTTP-seam test for dataflow triggering (issue 05, ADR-0009,
docs/plan-ir-issues/05): create sources + a Plan over HTTP, trigger one
source's collection over HTTP, and observe the downstream shared segment's
output + Plan Health rows — end to end, through the REAL
``run_collection_pipeline`` body (not stubbed away at the module boundary
the way every other plan-ir HTTP test patches it), so the Phase 5 trigger
hook inside ``backend.pipeline.runner.run_collection_pipeline`` actually
runs.

Two things are faked, at the narrowest correct seams:
- ``backend.pipeline.collector.collect`` — the channel/network boundary
  (avoids any real RSS/opencli fetch); everything downstream (normalize,
  store, dataflow trigger, shared segment, Plan Health) runs unmodified.
- ``backend.database.AsyncSessionLocal`` — repointed at the SAME in-memory
  sqlite engine the test's own ``db_session``/``client`` fixtures use, so
  the pipeline's internally-opened sessions (it never accepts an injected
  session — each phase opens its own, by design, see runner.py's docstring)
  read/write the data this test can also see and assert on.
"""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.channels.base import ChannelResult
from backend.models.plan_health import PlanHealthRecord
from backend.models.record import CollectedRecord
from backend.pipeline.runner import run_collection_pipeline
from backend.schemas.plan_ir import PLAN_IR_VERSION


def _source_node(node_id, source_id):
    return {
        "id": node_id,
        "kind": "source",
        "type": "rss_source",
        "label": "Source",
        "params": {},
        "source_id": source_id,
        "outputs": [{"name": "records", "type": "records"}],
    }


def _merge_node(node_id="merge1"):
    return {
        "id": node_id,
        "kind": "merge",
        "type": "merge",
        "label": "Merge",
        "params": {},
        "inputs": [
            {"name": "in1", "type": "records"},
            {"name": "in2", "type": "records"},
        ],
        "outputs": [{"name": "records", "type": "records"}],
    }


def _dedupe_node(node_id="dedupe1"):
    return {
        "id": node_id,
        "kind": "transform",
        "type": "dedupe",
        "label": "Dedupe",
        "params": {},
        "inputs": [{"name": "records", "type": "records"}],
        "outputs": [{"name": "records", "type": "records"}],
    }


def _sink_node(node_id="sink1"):
    return {
        "id": node_id,
        "kind": "sink",
        "type": "collection_store",
        "label": "Sink",
        "params": {},
        "inputs": [{"name": "records", "type": "records"}],
    }


def _edge(edge_id, src, src_port, tgt, tgt_port):
    return {
        "id": edge_id,
        "source_node": src,
        "source_port": src_port,
        "target_node": tgt,
        "target_port": tgt_port,
    }


def _two_source_graph(src1, src2):
    return {
        "ir_version": PLAN_IR_VERSION,
        "name": "Dataflow-triggered shared segment",
        "nodes": [
            _source_node("n1", src1),
            _source_node("n2", src2),
            _merge_node(),
            _dedupe_node(),
            _sink_node(),
        ],
        "edges": [
            _edge("e1", "n1", "records", "merge1", "in1"),
            _edge("e2", "n2", "records", "merge1", "in2"),
            _edge("e3", "merge1", "records", "dedupe1", "records"),
            _edge("e4", "dedupe1", "records", "sink1", "records"),
        ],
    }


async def _create_source(client, **overrides) -> str:
    data = {
        "name": "Test RSS Source",
        "channel_type": "rss",
        "channel_config": {"feed_url": "https://example.com/feed.xml"},
        "enabled": True,
        **overrides,
    }
    resp = await client.post("/api/v1/sources", json=data)
    assert resp.status_code == 201
    return resp.json()["data"]["id"]


async def _create_plan(client, graph: dict, name="P1") -> str:
    resp = await client.post("/api/v1/plans", json={"name": name, "graph": graph})
    assert resp.status_code == 201
    return resp.json()["data"]["id"]


async def _no_background_dispatch(self, task_id: str, parameters: dict) -> dict:
    return {"task_id": task_id}


@pytest.mark.asyncio
async def test_source_collection_over_http_triggers_shared_segment_and_plan_health(
    client, db_session, db_engine
):
    """create sources + plan (HTTP) -> trigger source collection (HTTP,
    POST /tasks/trigger) -> the REAL run_collection_pipeline body executes,
    ending in the issue-05 Phase 5 hook -> the Plan's shared segment runs
    incrementally over just this delivery, and Plan Health rows land —
    exactly the acceptance criterion's "HTTP-seam test observing an
    end-to-end scheduled flow" (manual trigger here; the trigger hook fires
    identically regardless of scheduled vs manual — see runner.py Phase 5's
    docstring)."""
    source_id_1 = await _create_source(client, name="S1")
    source_id_2 = await _create_source(client, name="S2")
    await _create_plan(client, _two_source_graph(source_id_1, source_id_2))

    # Repoint AsyncSessionLocal (used by every phase inside
    # run_collection_pipeline/run_pipeline/the dataflow trigger) at the same
    # in-memory engine db_session/client already use, so this test can see
    # what the real pipeline body writes.
    test_session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )

    fake_channel_result = ChannelResult.ok(
        [{"title": "hello from S1", "url": "https://example.com/1"}]
    )

    with patch(
        "backend.executor.local.LocalExecutor.dispatch_collection",
        new=_no_background_dispatch,
    ):
        trigger_resp = await client.post(
            "/api/v1/tasks/trigger",
            json={"source_id": source_id_1, "parameters": {}},
        )
    assert trigger_resp.status_code == 202
    task_id = trigger_resp.json()["data"]["task_id"]

    with patch("backend.database.AsyncSessionLocal", test_session_factory), patch(
        "backend.pipeline.runner.AsyncSessionLocal", test_session_factory
    ), patch("backend.pipeline.collector.collect", new=AsyncMock(return_value=fake_channel_result)):
        outcome = await run_collection_pipeline(task_id, {})

    assert outcome["success"] is True
    assert outcome["stored"] == 1

    # The source's own record landed under its own source_id, as always.
    own_records = (
        await db_session.execute(
            select(CollectedRecord).where(CollectedRecord.source_id == source_id_1)
        )
    ).scalars().all()
    assert len(own_records) == 1

    # The dataflow trigger (issue 05 Phase 5 hook) ran the Plan's shared
    # segment incrementally over just this delivery: one merged/deduped/
    # stored item lands under the Plan's own shared-store identity.
    plans_resp = await client.get("/api/v1/plans")
    plan_id = plans_resp.json()["data"][0]["id"]

    shared_records = (
        await db_session.execute(
            select(CollectedRecord).where(CollectedRecord.source_id == plan_id)
        )
    ).scalars().all()
    assert len(shared_records) == 1
    prov = shared_records[0].normalized_data["_plan_provenance"]
    assert prov["plan_id"] == plan_id
    assert prov["source_id"] == source_id_1
    assert prov["source_node_id"] == "n1"

    # Plan Health recorded for this incremental run, identically in shape to
    # a manual whole-plan run (merge -> dedupe -> sink all ran).
    health_resp = await client.get(f"/api/v1/plans/{plan_id}/health")
    assert health_resp.status_code == 200
    health_rows = health_resp.json()["data"]
    assert {r["node_id"] for r in health_rows} == {"merge1", "dedupe1", "sink1"}
    assert all(r["success"] for r in health_rows)

    # The source's own TaskRun is unaffected by the shared segment ever
    # having run — it already completed before Phase 5 fired.
    runs_resp = await client.get(f"/api/v1/tasks/{task_id}/runs")
    assert runs_resp.status_code == 200
    assert runs_resp.json()["data"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_source_not_in_any_plan_triggers_no_shared_segment(client, db_session, db_engine):
    """A source with no Plan at all: collection over HTTP behaves exactly as
    it does today — no Plan Health rows appear anywhere, no shared-store
    record is written under any identity other than the source's own."""
    source_id = await _create_source(client, name="Lone")

    test_session_factory = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    fake_channel_result = ChannelResult.ok(
        [{"title": "solo item", "url": "https://example.com/x"}]
    )

    with patch(
        "backend.executor.local.LocalExecutor.dispatch_collection",
        new=_no_background_dispatch,
    ):
        trigger_resp = await client.post(
            "/api/v1/tasks/trigger", json={"source_id": source_id, "parameters": {}}
        )
    task_id = trigger_resp.json()["data"]["task_id"]

    with patch("backend.database.AsyncSessionLocal", test_session_factory), patch(
        "backend.pipeline.runner.AsyncSessionLocal", test_session_factory
    ), patch("backend.pipeline.collector.collect", new=AsyncMock(return_value=fake_channel_result)):
        outcome = await run_collection_pipeline(task_id, {})

    assert outcome["success"] is True

    health_rows = (await db_session.execute(select(PlanHealthRecord))).scalars().all()
    assert health_rows == []
