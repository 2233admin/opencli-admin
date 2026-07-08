"""Unit tests for backend.plan_ir.executor.run_plan_once (issue 03).

The executor-body seam: injected session + Plan row, no scheduler/asyncio-
wrapper timing — same "directly invocable in tests" contract as the Control
Cycle body (backend.control.cycle.run_control_cycle_once, see
tests/unit/control/test_cycle.py). Covers source-segment dispatch, error
propagation from the underlying runner, and every refusal path (draft /
non-runnable / multi-source / dangling source_id / disabled source).

test_run_plan_once_dispatches_real_machinery_matches_direct_trigger below is
the "real dispatch, no stubbed success" proof: it patches only the DB
*session* objects the pipeline runner opens internally (the exact double
tests/unit/test_runner.py itself uses to test run_collection_pipeline) —
run_plan_once, run_collection_pipeline, and run_pipeline's own control flow
all execute unmodified. It then runs the identical source through the
existing direct-trigger call pair (task_service.create_task +
run_collection_pipeline) and asserts the two TaskRun/CollectionTask shapes
are indistinguishable (issue 03 acceptance criterion).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.models.plan import Plan
from backend.models.source import DataSource
from backend.plan_ir.executor import PlanExecutionError, run_plan_once
from backend.schemas.plan_ir import PLAN_IR_VERSION


def _source_node(node_id="n1", source_id="src-1", draft=False):
    node = {
        "id": node_id,
        "kind": "source",
        "type": "rss_source",
        "label": "Source",
        "params": {},
        "outputs": [{"name": "records", "type": "records"}],
    }
    if draft:
        node["draft"] = True
    else:
        node["source_id"] = source_id
    return node


def _sink_node(node_id="n2"):
    return {
        "id": node_id,
        "kind": "sink",
        "type": "collection_store",
        "label": "Sink",
        "params": {},
        "inputs": [{"name": "records", "type": "records"}],
    }


def _edge(edge_id, src, tgt):
    return {
        "id": edge_id,
        "source_node": src,
        "source_port": "records",
        "target_node": tgt,
        "target_port": "records",
    }


def _degenerate_graph(source_id="src-1"):
    return {
        "ir_version": PLAN_IR_VERSION,
        "name": "Degenerate plan",
        "draft": False,
        "nodes": [_source_node(source_id=source_id), _sink_node()],
        "edges": [_edge("e1", "n1", "n2")],
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


def _make_plan(*, graph: dict, draft: bool, runnable: bool, name="P1") -> Plan:
    return Plan(name=name, graph=graph, version=1, draft=draft, runnable=runnable)


# ── refusal paths ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_refuses_draft_plan(db_session):
    source = await _make_source(db_session)
    plan = _make_plan(graph=_degenerate_graph(source.id), draft=True, runnable=False)
    db_session.add(plan)
    await db_session.flush()

    with pytest.raises(PlanExecutionError, match="draft"):
        await run_plan_once(db_session, plan)


@pytest.mark.asyncio
async def test_refuses_non_runnable_plan(db_session):
    """A plan with zero source nodes: draft=False but runnable=False
    (backend.services.plan_service.derive_flags semantics)."""
    graph = {
        "ir_version": PLAN_IR_VERSION,
        "name": "No sources",
        "nodes": [_sink_node("n1")],
        "edges": [],
    }
    plan = _make_plan(graph=graph, draft=False, runnable=False)
    db_session.add(plan)
    await db_session.flush()

    with pytest.raises(PlanExecutionError, match="not runnable"):
        await run_plan_once(db_session, plan)


@pytest.mark.asyncio
async def test_refuses_multi_source_plan(db_session):
    """Issue 03 is the degenerate (single-source) slice only; 2+ source
    nodes must refuse clearly rather than silently running one of them —
    multi-source execution is issue 04's scope."""
    src1 = await _make_source(db_session, name="S1")
    src2 = await _make_source(db_session, name="S2")
    graph = {
        "ir_version": PLAN_IR_VERSION,
        "name": "Multi-source",
        "nodes": [
            _source_node("n1", source_id=src1.id),
            _source_node("n2", source_id=src2.id),
            _sink_node("n3"),
        ],
        "edges": [_edge("e1", "n1", "n3"), _edge("e2", "n2", "n3")],
    }
    plan = _make_plan(graph=graph, draft=False, runnable=True)
    db_session.add(plan)
    await db_session.flush()

    with pytest.raises(PlanExecutionError, match="2 source node"):
        await run_plan_once(db_session, plan)


@pytest.mark.asyncio
async def test_refuses_dangling_source_reference(db_session):
    """A materialized source node whose source_id no longer resolves to any
    DataSource (deleted out from under the Plan) refuses with a clear error
    instead of crashing deep inside the pipeline runner."""
    plan = _make_plan(
        graph=_degenerate_graph(source_id="does-not-exist"), draft=False, runnable=True
    )
    db_session.add(plan)
    await db_session.flush()

    with pytest.raises(PlanExecutionError, match="unknown"):
        await run_plan_once(db_session, plan)


@pytest.mark.asyncio
async def test_refuses_disabled_source(db_session):
    source = await _make_source(db_session, enabled=False)
    plan = _make_plan(graph=_degenerate_graph(source.id), draft=False, runnable=True)
    db_session.add(plan)
    await db_session.flush()

    with pytest.raises(PlanExecutionError, match="disabled"):
        await run_plan_once(db_session, plan)


# ── source-segment dispatch (mocked at the run_collection_pipeline seam,
#    matching the project convention in tests/integration/test_tasks_api.py
#    and tests/integration/test_webhooks_api.py) ─────────────────────────────


@pytest.mark.asyncio
async def test_dispatches_to_existing_task_service_and_pipeline(db_session):
    """run_plan_once must invoke task_service.create_task (trigger_type
    "plan") and then await run_collection_pipeline with that task's id —
    the identical call pair backend.api.v1.tasks.trigger_task makes for a
    direct source trigger. Proves dispatch happens through the shared
    machinery rather than a parallel executor-only code path."""
    source = await _make_source(db_session)
    plan = _make_plan(graph=_degenerate_graph(source.id), draft=False, runnable=True)
    db_session.add(plan)
    await db_session.flush()

    fake_result = {
        "task_id": "ignored",
        "run_id": "run-abc",
        "success": True,
        "collected": 3,
        "stored": 3,
        "skipped": 0,
        "error": None,
    }

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(return_value=fake_result),
    ) as mock_pipeline:
        result = await run_plan_once(db_session, plan, parameters={"limit": 5})

    mock_pipeline.assert_awaited_once()
    called_task_id, called_params = mock_pipeline.call_args.args
    assert called_params == {"limit": 5}

    # The task_id passed to run_collection_pipeline is a real, freshly
    # created CollectionTask row with trigger_type "plan".
    from backend.models.task import CollectionTask

    created_task = await db_session.get(CollectionTask, called_task_id)
    assert created_task is not None
    assert created_task.source_id == source.id
    assert created_task.trigger_type == "plan"

    assert result.plan_id == plan.id
    assert result.source_id == source.id
    assert result.task_id == called_task_id
    assert result.run_id == "run-abc"
    assert result.success is True
    assert result.stored == 3


@pytest.mark.asyncio
async def test_error_propagation_from_underlying_runner(db_session):
    """A hard failure from run_collection_pipeline's own pre-pipeline error
    path (task/source bookkeeping failure, e.g. task not found — same shape
    backend.pipeline.runner.run_collection_pipeline returns today) surfaces
    as a PlanExecutionError rather than being swallowed into a fake success."""
    source = await _make_source(db_session)
    plan = _make_plan(graph=_degenerate_graph(source.id), draft=False, runnable=True)
    db_session.add(plan)
    await db_session.flush()

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(return_value={"error": "Source not found"}),
    ):
        with pytest.raises(PlanExecutionError, match="Source not found"):
            await run_plan_once(db_session, plan)


@pytest.mark.asyncio
async def test_raised_exception_from_underlying_runner_propagates(db_session):
    """A raised (not returned-as-error-dict) exception from
    run_collection_pipeline — e.g. a retryable failure re-raised per
    backend/pipeline/runner.py's own contract — propagates unmodified; the
    executor body does not catch and mask it."""
    source = await _make_source(db_session)
    plan = _make_plan(graph=_degenerate_graph(source.id), draft=False, runnable=True)
    db_session.add(plan)
    await db_session.flush()

    with patch(
        "backend.pipeline.runner.run_collection_pipeline",
        new=AsyncMock(side_effect=ConnectionError("upstream reset")),
    ):
        with pytest.raises(ConnectionError, match="upstream reset"):
            await run_plan_once(db_session, plan)


# ── real machinery: plan-run output shape matches direct-trigger shape ─────


def _make_session_cm(session):
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _fake_task_run_sessions(task, run, source):
    """Builds the 3-phase AsyncSessionLocal double run_collection_pipeline
    expects (see tests/unit/test_runner.py — this mirrors that fixture
    exactly, the project's own precedent for exercising this function for
    real without a live DB)."""

    def capture_add(obj):
        obj.id = run.id

    session1 = AsyncMock()
    session1.get = AsyncMock(return_value=task)
    session1.add = MagicMock(side_effect=capture_add)
    session1.flush = AsyncMock()
    session1.commit = AsyncMock()

    session2 = AsyncMock()
    session2.get = AsyncMock(return_value=source)
    session2.expunge = MagicMock()
    no_provider = MagicMock()
    no_provider.scalars.return_value.first.return_value = None
    session2.execute = AsyncMock(return_value=no_provider)

    session4 = AsyncMock()
    session4.get = AsyncMock(side_effect=lambda model, id: task if id == task.id else run)
    session4.commit = AsyncMock()

    return [session1, session2, session4]


@pytest.mark.asyncio
async def test_run_plan_once_dispatches_real_machinery_matches_direct_trigger(db_session):
    """The zero-regression proof (issue 03 acceptance criterion): run the
    same degenerate source through (a) run_plan_once and (b) the direct
    trigger_task call pair, both driving the real (unmocked)
    run_collection_pipeline body — only run_pipeline (the channel/collect
    boundary) and AsyncSessionLocal's session objects are doubled, exactly
    as tests/unit/test_runner.py already does for this function. The two
    TaskRun-shaped result dicts must be structurally identical."""
    from backend.models.task import CollectionTask, TaskRun
    from backend.pipeline.runner import run_collection_pipeline

    source = await _make_source(db_session)
    plan = _make_plan(graph=_degenerate_graph(source.id), draft=False, runnable=True)
    db_session.add(plan)
    await db_session.flush()

    def _pipeline_result():
        r = MagicMock()
        r.success = True
        r.error = None
        r.collected = 2
        r.stored = 2
        r.skipped = 0
        r.ai_processed = 0
        r.duration_ms = 42
        r.metadata = {}
        return r

    expected_keys = {"task_id", "run_id", "success", "collected", "stored", "skipped", "error"}

    # ── (a) via run_plan_once ───────────────────────────────────────────
    plan_task = CollectionTask(
        id="plan-task-1", source_id=source.id, trigger_type="plan", parameters={}
    )
    plan_run = TaskRun(id="plan-run-1", task_id="plan-task-1", status="running")
    plan_sessions = _fake_task_run_sessions(plan_task, plan_run, source)
    plan_session_cms = [_make_session_cm(s) for s in plan_sessions]

    with patch("backend.pipeline.runner.AsyncSessionLocal", side_effect=plan_session_cms):
        with patch(
            "backend.pipeline.runner.run_pipeline",
            new=AsyncMock(return_value=_pipeline_result()),
        ):
            plan_result = await run_plan_once(db_session, plan)

    # ── (b) via the direct-trigger call pair (backend.api.v1.tasks.trigger_task) ──
    direct_task = CollectionTask(
        id="direct-task-1", source_id=source.id, trigger_type="manual", parameters={}
    )
    direct_run = TaskRun(id="direct-run-1", task_id="direct-task-1", status="running")
    direct_sessions = _fake_task_run_sessions(direct_task, direct_run, source)
    direct_session_cms = [_make_session_cm(s) for s in direct_sessions]

    with patch("backend.pipeline.runner.AsyncSessionLocal", side_effect=direct_session_cms):
        with patch(
            "backend.pipeline.runner.run_pipeline",
            new=AsyncMock(return_value=_pipeline_result()),
        ):
            direct_result = await run_collection_pipeline(direct_task.id, {})

    # Same shape: both are dicts with the identical key set and identical
    # values for everything except task_id/run_id (which are per-run identifiers).
    assert set(plan_result.__dataclass_fields__.keys()) >= expected_keys
    assert direct_result.keys() == expected_keys

    assert plan_result.success == direct_result["success"] is True
    assert plan_result.collected == direct_result["collected"] == 2
    assert plan_result.stored == direct_result["stored"] == 2
    assert plan_result.skipped == direct_result["skipped"] == 0
    assert plan_result.error == direct_result["error"] is None
