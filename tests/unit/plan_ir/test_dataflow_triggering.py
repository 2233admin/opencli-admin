"""Executor-seam tests for dataflow triggering (issue 05, ADR-0009,
docs/plan-ir-issues/05).

Covers the acceptance criteria at the executor/service seam (direct-invoke,
no HTTP, no scheduler timing — same "session + explicit inputs" contract as
issues 03/04's tests):

- a single delivery flows through the downstream shared segment incrementally
- dedupe still works across successive deliveries (issue 04's store-level
  dedup scope, exercised here rather than rebuilt)
- a source with no runnable Plan triggers nothing (and costs one cheap query)
- two sources on different cadences in one Plan trigger independently
- a shared-segment failure on the incremental path is isolated: Plan Health
  records it, the triggering source's own state is untouched, and the
  trigger_incremental_shared_segments loop itself never raises

The HTTP-seam counterpart (real /tasks/trigger -> real run_collection_pipeline
-> dataflow trigger -> shared segment + Plan Health) lives in
tests/integration/test_dataflow_triggering_api.py.
"""

from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy import select

from backend.models.plan import Plan
from backend.models.plan_health import PlanHealthRecord
from backend.models.record import CollectedRecord
from backend.models.source import DataSource
from backend.models.source_measurement import SourceMeasurement
from backend.models.task import CollectionTask
from backend.plan_ir.executor import run_plan_shared_segment_incremental
from backend.schemas.plan import PlanCreate
from backend.schemas.plan_ir import PLAN_IR_VERSION
from backend.services import plan_service
from backend.services.plan_trigger_service import trigger_incremental_shared_segments

# ── graph builders (mirrors test_executor_v2.py's convention) ──────────────


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
        "name": "Two-source shared segment",
        "draft": False,
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


async def _make_source(session, **overrides) -> DataSource:
    source = DataSource(
        name=overrides.get("name", "Test Source"),
        channel_type=overrides.get("channel_type", "rss"),
        channel_config=overrides.get("channel_config", {"feed_url": "https://x/feed"}),
        enabled=overrides.get("enabled", True),
    )
    session.add(source)
    await session.flush()
    return source


async def _make_plan_via_service(session, graph: dict, name="P1") -> Plan:
    """Go through the real plan_service.create_plan so plan_source_index
    (issue 05) is populated exactly as it would be for a Plan saved through
    the HTTP API — the trigger service's membership lookup depends on this
    index being maintained, so tests must exercise the real write path, not
    hand-construct a bare Plan row."""
    _parsed, result = plan_service.validate_graph_dict(graph)
    assert result.valid, result.to_dict()
    draft, runnable = plan_service.derive_flags(_parsed)
    plan = await plan_service.create_plan(
        session, PlanCreate(name=name, graph=graph), draft=draft, runnable=runnable
    )
    return plan


async def _store_records_for_task(session, task_id: str, source_id: str, items: list[dict]):
    """Stand in for storer.store_records for one source's delivery: writes
    CollectedRecord rows directly under task_id/source_id, exactly like the
    per-source pipeline's own store step would."""
    for item in items:
        rec = CollectedRecord(
            task_id=task_id,
            source_id=source_id,
            raw_data=item,
            normalized_data={"title": item.get("title", ""), "source_id": source_id},
            content_hash=item["content_hash"],
            status="normalized",
        )
        session.add(rec)
    await session.flush()


async def _make_task(session, source_id: str, trigger_type: str = "scheduled") -> CollectionTask:
    task = CollectionTask(
        source_id=source_id, trigger_type=trigger_type, parameters={},
        priority=5, status="completed",
    )
    session.add(task)
    await session.flush()
    return task


# ── single delivery flows through incrementally ────────────────────────────


@pytest.mark.asyncio
async def test_single_delivery_flows_through_shared_segment_incrementally(db_session):
    src1 = await _make_source(db_session, name="S1")
    src2 = await _make_source(db_session, name="S2")
    plan = await _make_plan_via_service(db_session, _two_source_graph(src1.id, src2.id))

    task = await _make_task(db_session, src1.id)
    await _store_records_for_task(
        db_session, task.id, src1.id, [{"title": "x", "content_hash": "hash-1"}]
    )

    results = await trigger_incremental_shared_segments(
        db_session, source_id=src1.id, task_id=task.id
    )

    assert len(results) == 1
    result = results[0]
    assert result.plan_id == plan.id
    assert result.source_id == src1.id
    assert result.source_node_id == "n1"
    assert result.success is True
    assert result.shared_segment is not None
    assert result.shared_segment.items_in == 1
    assert result.shared_segment.stored == 1

    # Only src1's one item flowed through — src2 never delivered anything
    # this pass (no lockstep, no waiting for the other source).
    stored_query = select(CollectedRecord).where(CollectedRecord.source_id == plan.id)
    stored_rows = (await db_session.execute(stored_query)).scalars().all()
    assert len(stored_rows) == 1
    assert stored_rows[0].normalized_data["_plan_provenance"]["source_id"] == src1.id
    assert stored_rows[0].normalized_data["_plan_provenance"]["source_node_id"] == "n1"

    # Plan Health recorded identically to a manual run (merge -> dedupe -> sink).
    health_query = select(PlanHealthRecord).where(PlanHealthRecord.plan_id == plan.id)
    health_rows = (await db_session.execute(health_query)).scalars().all()
    assert {r.node_id for r in health_rows} == {"merge1", "dedupe1", "sink1"}
    assert all(r.success for r in health_rows)


# ── dedupe across successive deliveries ─────────────────────────────────────


@pytest.mark.asyncio
async def test_dedupe_across_successive_deliveries(db_session):
    """Two separate deliveries carrying the SAME content_hash — e.g. two
    different sources in the same Plan both observing the identical item,
    or (as modeled here via two distinct source rows so the per-source
    uq_source_content constraint on each source's OWN storage isn't hit by
    this test's stub) two deliveries whose items collide once tagged into
    the shared segment. The second delivery's duplicate is skipped by the
    SAME store-level dedup scope issue 04 already gives — uq_source_content
    on (source_id=plan.id, content_hash) at the SHARED store sink — nothing
    new to build here, this test verifies it holds across incremental runs
    specifically, one delivery at a time (not a single combined branch)."""
    src1 = await _make_source(db_session, name="S1")
    src2 = await _make_source(db_session, name="S2")
    plan = await _make_plan_via_service(db_session, _two_source_graph(src1.id, src2.id))

    task1 = await _make_task(db_session, src1.id)
    await _store_records_for_task(
        db_session, task1.id, src1.id, [{"title": "x", "content_hash": "hash-dup"}]
    )
    result1 = (
        await trigger_incremental_shared_segments(db_session, source_id=src1.id, task_id=task1.id)
    )[0]
    assert result1.shared_segment.stored == 1
    assert result1.shared_segment.skipped == 0

    # A second, later delivery — from src2 this time — carrying the SAME
    # content_hash (the two sources observed the identical item). Its own
    # per-source storage is unaffected (different source_id, no collision
    # there); the SHARED segment's store is where this must dedupe.
    task2 = await _make_task(db_session, src2.id)
    await _store_records_for_task(
        db_session, task2.id, src2.id, [{"title": "x", "content_hash": "hash-dup"}]
    )
    result2 = (
        await trigger_incremental_shared_segments(db_session, source_id=src2.id, task_id=task2.id)
    )[0]
    assert result2.success is True
    assert result2.shared_segment.stored == 0
    assert result2.shared_segment.skipped == 1

    stored_query = select(CollectedRecord).where(CollectedRecord.source_id == plan.id)
    stored_rows = (await db_session.execute(stored_query)).scalars().all()
    assert len(stored_rows) == 1  # the duplicate never landed a second row


# ── no-plan sources: zero new behavior ──────────────────────────────────────


@pytest.mark.asyncio
async def test_source_with_no_plan_triggers_nothing(db_session):
    lone_source = await _make_source(db_session, name="Lone")
    task = await _make_task(db_session, lone_source.id)
    await _store_records_for_task(
        db_session, task.id, lone_source.id, [{"title": "x", "content_hash": "hash-1"}]
    )

    results = await trigger_incremental_shared_segments(
        db_session, source_id=lone_source.id, task_id=task.id
    )
    assert results == []

    health_rows = (await db_session.execute(select(PlanHealthRecord))).scalars().all()
    assert health_rows == []


@pytest.mark.asyncio
async def test_source_in_draft_plan_triggers_nothing(db_session):
    """A source wired into a Plan that still has an unmaterialized draft
    source node elsewhere must not trigger — draft Plans never enter the
    control loop (PRD story 9), and plan_source_index only rows
    materialized source nodes anyway, but the membership query additionally
    filters on Plan.draft/runnable as defense in depth."""
    src1 = await _make_source(db_session, name="S1")
    graph = {
        "ir_version": PLAN_IR_VERSION,
        "name": "Half-drafted",
        "nodes": [
            _source_node("n1", src1.id),
            {
                "id": "n2", "kind": "source", "type": "rss_source", "draft": True,
                "outputs": [{"name": "records", "type": "records"}],
            },
            _merge_node(),
            _sink_node(),
        ],
        "edges": [
            _edge("e1", "n1", "records", "merge1", "in1"),
            _edge("e2", "n2", "records", "merge1", "in2"),
            _edge("e3", "merge1", "records", "sink1", "records"),
        ],
    }
    plan = await _make_plan_via_service(db_session, graph)
    assert plan.draft is True

    task = await _make_task(db_session, src1.id)
    await _store_records_for_task(
        db_session, task.id, src1.id, [{"title": "x", "content_hash": "hash-1"}]
    )
    results = await trigger_incremental_shared_segments(
        db_session, source_id=src1.id, task_id=task.id
    )
    assert results == []


# ── different-cadence independence ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_two_sources_different_cadences_trigger_independently(db_session):
    """src1 delivers alone; only src1's branch runs through the shared
    segment this pass. src2's later, separate delivery runs independently —
    no whole-plan lockstep, no waiting for the other source (PRD story 11/12,
    issue acceptance criterion)."""
    src1 = await _make_source(db_session, name="Fast")
    src2 = await _make_source(db_session, name="Slow")
    plan = await _make_plan_via_service(db_session, _two_source_graph(src1.id, src2.id))

    # src1 delivers 3 times before src2 ever delivers once.
    for i in range(3):
        task = await _make_task(db_session, src1.id)
        await _store_records_for_task(
            db_session, task.id, src1.id, [{"title": f"f{i}", "content_hash": f"fast-{i}"}]
        )
        results = await trigger_incremental_shared_segments(
            db_session, source_id=src1.id, task_id=task.id
        )
        assert len(results) == 1
        assert results[0].shared_segment.items_in == 1  # never waits for src2

    task2 = await _make_task(db_session, src2.id)
    await _store_records_for_task(
        db_session, task2.id, src2.id, [{"title": "slow-0", "content_hash": "slow-0"}]
    )
    results2 = await trigger_incremental_shared_segments(
        db_session, source_id=src2.id, task_id=task2.id
    )
    assert len(results2) == 1
    assert results2[0].source_node_id == "n2"
    assert results2[0].shared_segment.items_in == 1

    stored_query = select(CollectedRecord).where(CollectedRecord.source_id == plan.id)
    stored_rows = (await db_session.execute(stored_query)).scalars().all()
    assert len(stored_rows) == 4  # 3 from src1 + 1 from src2, all independent passes


# ── shared-segment failure isolation ────────────────────────────────────────


@pytest.mark.asyncio
async def test_shared_segment_failure_isolated_from_source_state(db_session):
    """HARD TEST (mirrors test_executor_v2.py's Two-Tier Attribution test,
    for the incremental path): a dedupe blow-up on an incremental trigger
    records Plan Health and returns success=False, but never raises out of
    trigger_incremental_shared_segments, and the triggering source's own
    SourceMeasurement/control-state are untouched."""
    src1 = await _make_source(db_session, name="S1")
    src2 = await _make_source(db_session, name="S2")
    plan = await _make_plan_via_service(db_session, _two_source_graph(src1.id, src2.id))

    db_session.add(
        SourceMeasurement(
            source_id=src1.id, run_id="prior-run",
            measured_at=datetime(2026, 7, 1, tzinfo=UTC),
            accepted=5, duplicates=1, rejected=0, error_rate=0.0, duplicate_rate=0.2,
            error_kinds={}, cursor_advanced=True, source_ts_quality="missing", raw={"seed": True},
        )
    )
    await db_session.flush()

    before = await db_session.get(SourceMeasurement, (
        (await db_session.execute(select(SourceMeasurement.id))).scalar_one()
    ))
    before_snapshot = {"accepted": before.accepted, "raw": before.raw}

    task = await _make_task(db_session, src1.id)
    await _store_records_for_task(
        db_session, task.id, src1.id, [{"title": "x", "content_hash": "hash-1"}]
    )

    with patch(
        "backend.plan_ir.executor.dedupe_items",
        side_effect=RuntimeError("dedupe blew up"),
    ):
        results = await trigger_incremental_shared_segments(
            db_session, source_id=src1.id, task_id=task.id
        )

    assert len(results) == 1
    result = results[0]
    assert result.success is False
    assert "dedupe blew up" in result.error
    assert result.shared_segment is not None
    assert result.shared_segment.failed_node_id == "dedupe1"

    health_query = select(PlanHealthRecord).where(PlanHealthRecord.plan_id == plan.id)
    health_rows = (await db_session.execute(health_query)).scalars().all()
    by_node = {r.node_id: r for r in health_rows}
    assert by_node["merge1"].success is True
    assert by_node["dedupe1"].success is False
    assert "sink1" not in by_node

    after = await db_session.get(SourceMeasurement, before.id)
    assert after.accepted == before_snapshot["accepted"]
    assert after.raw == before_snapshot["raw"]


@pytest.mark.asyncio
async def test_trigger_service_survives_deleted_plan_between_index_read_and_run(db_session):
    """A Plan can vanish (deleted) between the membership index read and the
    per-Plan run without the whole trigger loop raising — belt-and-braces
    isolation in trigger_incremental_shared_segments itself, not just inside
    run_plan_shared_segment_incremental."""
    src1 = await _make_source(db_session, name="S1")
    plan = await _make_plan_via_service(db_session, _two_source_graph(src1.id, src1.id))

    # Simulate the race: delete the Plan row directly (bypassing plan_service
    # so plan_source_index rows are deliberately left stale for this test).
    await db_session.delete(plan)
    await db_session.flush()

    task = await _make_task(db_session, src1.id)
    await _store_records_for_task(
        db_session, task.id, src1.id, [{"title": "x", "content_hash": "hash-1"}]
    )
    results = await trigger_incremental_shared_segments(
        db_session, source_id=src1.id, task_id=task.id
    )
    assert results == []  # plan.id no longer resolves; skipped, not raised


# ── run_plan_shared_segment_incremental direct-invoke ───────────────────────


@pytest.mark.asyncio
async def test_run_plan_shared_segment_incremental_skips_draft_plan_silently(db_session):
    """Calling the executor entrypoint directly against a draft Plan (e.g. a
    race with an in-flight edit) returns success=True with no shared_segment
    rather than raising — this is not a shared-segment failure."""
    src1 = await _make_source(db_session, name="S1")
    plan = Plan(
        name="Draft", graph=_two_source_graph(src1.id, src1.id), version=1,
        draft=True, runnable=False,
    )
    db_session.add(plan)
    await db_session.flush()

    task = await _make_task(db_session, src1.id)
    result = await run_plan_shared_segment_incremental(
        db_session, plan, source_id=src1.id, source_node_id="n1", task_id=task.id,
    )
    assert result.success is True
    assert result.shared_segment is None
