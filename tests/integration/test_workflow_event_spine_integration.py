from contextlib import AsyncExitStack

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.database import Base, commit_session, get_db, rollback_session
from backend.main import app
from backend.models.workflow_run import WorkflowRun, WorkflowRunEvent
from backend.workflow.event_mirror import list_workflow_event_mirror_records
from backend.workflow.opencli_hda_tracer import (
    _RUNS,
    _load_workflow_run,
    _store_workflow_run,
)
from tests.fixtures.workflow_conformance import (
    workflow_conformance_project,
    workflow_conformance_source_outputs,
)
from tests.integration.test_workflow_opencli_hda_trace_api import (
    _multi_source_opencli_hda_project,
)
from tests.integration.test_workflow_webhook_ingress_api import _webhook_project
from tests.postgres_conformance import temporary_postgres_database

WORKFLOW_RUN_ID_MAX_LENGTH = 36


def _bounded_run_id(scenario: str, backend_name: str) -> str:
    backend_token = "pg" if backend_name == "postgresql" else backend_name
    run_id = f"run-spine-{scenario}-{backend_token}"
    assert len(run_id) <= WORKFLOW_RUN_ID_MAX_LENGTH
    return run_id


@pytest.fixture(
    params=(
        pytest.param("sqlite", id="sqlite"),
        pytest.param(
            "postgresql",
            id="postgresql",
            marks=pytest.mark.postgres_conformance,
        ),
    )
)
async def event_spine_api(request, tmp_path):
    async with AsyncExitStack() as resources:
        if request.param == "sqlite":
            database_path = (tmp_path / "workflow-event-spine-api.db").as_posix()
            engine = create_async_engine(
                f"sqlite+aiosqlite:///{database_path}",
                connect_args={"check_same_thread": False, "timeout": 30},
            )

            @event.listens_for(engine.sync_engine, "connect")
            def _sqlite_pragmas(dbapi_connection, _):
                dbapi_connection.execute("PRAGMA foreign_keys=ON")
                dbapi_connection.execute("PRAGMA journal_mode=WAL")
        else:
            database_url = await resources.enter_async_context(
                temporary_postgres_database("workflow_event_api")
            )
            engine = create_async_engine(database_url)

        resources.push_async_callback(engine.dispose)
        sessions = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with sessions() as db_session:

            async def override_get_db():
                yield db_session

            prior_override = app.dependency_overrides.get(get_db)
            app.dependency_overrides[get_db] = override_get_db
            try:
                async with AsyncClient(
                    transport=ASGITransport(app=app),
                    base_url="http://test",
                ) as client:
                    yield request.param, client, db_session
            finally:
                if prior_override is None:
                    app.dependency_overrides.pop(get_db, None)
                else:
                    app.dependency_overrides[get_db] = prior_override


@pytest.mark.asyncio
async def test_public_run_id_boundaries_validate_before_persistence(event_spine_api):
    _, client, db_session = event_spine_api

    async def row_counts() -> tuple[int, int]:
        runs = await db_session.scalar(select(func.count()).select_from(WorkflowRun))
        events = await db_session.scalar(select(func.count()).select_from(WorkflowRunEvent))
        return int(runs or 0), int(events or 0)

    start_payload = {
        "project": workflow_conformance_project(),
        "traceId": "trace-public-run-id-boundary",
        "sourceOutputs": workflow_conformance_source_outputs(),
    }
    hda_trace_payload = {
        "project": _multi_source_opencli_hda_project(),
        "packageNodeId": "multi-source-opencli",
        "traceId": "trace-public-hda-run-id-boundary",
    }
    webhook_payload = {
        "workflowProject": _webhook_project(),
        "traceId": "trace-public-webhook-run-id-boundary",
        "input": {"payload": {"event": "created"}},
    }

    assert await row_counts() == (0, 0)
    for endpoint, payload in (
        ("/api/v1/workflows/runs", start_payload),
        ("/api/v1/workflows/opencli-hda/trace", hda_trace_payload),
        (
            "/api/v1/workflows/wf-webhook-ingress/webhooks/incoming-webhook",
            webhook_payload,
        ),
    ):
        for invalid_run_id, error_type in (
            ("", "string_too_short"),
            ("x" * 37, "string_too_long"),
            ("../control", "string_pattern_mismatch"),
            ("path/segment", "string_pattern_mismatch"),
            (r"path\segment", "string_pattern_mismatch"),
            ("path%2Fsegment", "string_pattern_mismatch"),
            ("white space", "string_pattern_mismatch"),
            ("运行", "string_pattern_mismatch"),
        ):
            response = await client.post(
                endpoint,
                json={**payload, "runId": invalid_run_id},
            )

            assert response.status_code == 422
            error = response.json()["detail"][0]
            assert error["loc"] == ["body", "runId"]
            assert error["type"] == error_type
            assert await row_counts() == (0, 0)

    valid_run_id = "r" * WORKFLOW_RUN_ID_MAX_LENGTH
    started = await client.post(
        "/api/v1/workflows/runs",
        json={**start_payload, "runId": valid_run_id},
    )
    assert started.status_code == 202
    assert started.json()["data"]["runId"] == valid_run_id
    assert await db_session.get(WorkflowRun, valid_run_id) is not None
    persisted_counts = await row_counts()
    assert persisted_counts[0] == 1
    assert persisted_counts[1] > 0

    traced = await client.post(
        "/api/v1/workflows/opencli-hda/trace",
        json={**hda_trace_payload, "runId": valid_run_id},
    )
    assert traced.status_code == 200
    assert traced.json()["data"]["runId"] == valid_run_id
    assert await row_counts() == persisted_counts

    valid_webhook_run_id = "w" * WORKFLOW_RUN_ID_MAX_LENGTH
    webhook_run = await client.post(
        "/api/v1/workflows/wf-webhook-ingress/webhooks/incoming-webhook",
        json={**webhook_payload, "runId": valid_webhook_run_id},
    )
    assert webhook_run.status_code == 202
    assert webhook_run.json()["data"]["runId"] == valid_webhook_run_id
    assert await db_session.get(WorkflowRun, valid_webhook_run_id) is not None
    webhook_counts = await row_counts()
    assert webhook_counts[0] == persisted_counts[0] + 1
    assert webhook_counts[1] > persisted_counts[1]

    fetched_webhook_run = await client.get(
        f"/api/v1/workflows/runs/{valid_webhook_run_id}"
    )
    assert fetched_webhook_run.status_code == 200
    assert fetched_webhook_run.json()["data"]["runId"] == valid_webhook_run_id


@pytest.mark.asyncio
async def test_continuation_preserves_rows_and_mirrors_only_each_unseen_suffix(
    event_spine_api,
    monkeypatch,
):
    backend_name, client, db_session = event_spine_api
    stream = f"test.workflow-event-spine.continuation.{backend_name}"
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_BACKEND", "memory")
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_STREAM", stream)
    run_id = _bounded_run_id("continuation", backend_name)
    started = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(),
            "runId": run_id,
            "traceId": "trace-event-spine-continuation",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )
    assert started.status_code == 202
    initial_count = started.json()["data"]["eventCount"]
    assert run_id not in _RUNS
    assert (
        await list_workflow_event_mirror_records(
            run_id,
            backend="memory",
            stream=stream,
        )
        == []
    )
    await commit_session(db_session)
    assert run_id in _RUNS
    initial_row_ids = (
        await db_session.scalars(
            select(WorkflowRunEvent.id)
            .where(WorkflowRunEvent.run_id == run_id)
            .order_by(WorkflowRunEvent.sequence)
        )
    ).all()

    continuation_body = {
        "sourceOutputs": {
            "source-jin10": [
                {
                    "id": "macro-late",
                    "title": "Late macro update",
                    "url": "https://www.jin10.com/flash/macro-late",
                    "important": True,
                    "score": 0.95,
                }
            ]
        }
    }
    continued = await client.post(
        f"/api/v1/workflows/runs/{run_id}/source-outputs",
        json=continuation_body,
    )
    await commit_session(db_session)
    repeated = await client.post(
        f"/api/v1/workflows/runs/{run_id}/source-outputs",
        json=continuation_body,
    )
    await commit_session(db_session)

    assert continued.status_code == 202
    assert repeated.status_code == 202
    continued_count = continued.json()["data"]["eventCount"]
    repeated_count = repeated.json()["data"]["eventCount"]
    persisted = (
        await db_session.scalars(
            select(WorkflowRunEvent)
            .where(WorkflowRunEvent.run_id == run_id)
            .order_by(WorkflowRunEvent.sequence)
        )
    ).all()
    mirror = await list_workflow_event_mirror_records(
        run_id,
        backend="memory",
        stream=stream,
    )

    assert continued_count > initial_count
    assert repeated_count > continued_count
    assert [row.id for row in persisted[:initial_count]] == initial_row_ids
    assert [row.sequence for row in persisted] == list(range(1, repeated_count + 1))
    assert len(mirror) == repeated_count
    assert len({record.event_id for record in mirror}) == repeated_count

    _RUNS.pop(run_id, None)
    replayed_response = await client.get(f"/api/v1/workflows/runs/{run_id}/events")
    projection_response = await client.get(f"/api/v1/workflows/runs/{run_id}")
    assert replayed_response.status_code == 200
    assert projection_response.status_code == 200
    replayed = replayed_response.json()["data"]
    assert [event["sequence"] for event in replayed] == list(
        range(1, repeated_count + 1)
    )
    assert projection_response.json()["data"]["eventCount"] == repeated_count

    stored = await _load_workflow_run(run_id, session=db_session)
    assert stored is not None
    assert stored.projection.eventCount == repeated_count
    await _store_workflow_run(
        run_id,
        request=stored.request,
        projection=stored.projection,
        events=stored.events,
        session=db_session,
    )
    assert len(
        await list_workflow_event_mirror_records(
            run_id,
            backend="memory",
            stream=stream,
        )
    ) == repeated_count
    await commit_session(db_session)
    assert len(
        await list_workflow_event_mirror_records(
            run_id,
            backend="memory",
            stream=stream,
        )
    ) == repeated_count
    _RUNS.pop(run_id, None)


@pytest.mark.asyncio
async def test_rollback_leaves_no_workflow_cache_or_mirror_ghost(
    event_spine_api,
    monkeypatch,
):
    backend_name, client, db_session = event_spine_api
    stream = f"test.workflow-event-spine.rollback.{backend_name}"
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_BACKEND", "memory")
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_STREAM", stream)
    run_id = f"run-event-spine-rollback-{backend_name}"
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(),
            "runId": run_id,
            "traceId": "trace-event-spine-rollback",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )
    assert response.status_code == 202
    assert run_id not in _RUNS
    assert await list_workflow_event_mirror_records(
        run_id,
        backend="memory",
        stream=stream,
    ) == []

    await rollback_session(db_session)

    assert run_id not in _RUNS
    assert await db_session.get(WorkflowRun, run_id) is None
    assert await list_workflow_event_mirror_records(
        run_id,
        backend="memory",
        stream=stream,
    ) == []


@pytest.mark.asyncio
async def test_commit_failure_clears_workflow_publication_queue(
    event_spine_api,
    monkeypatch,
):
    backend_name, client, db_session = event_spine_api
    stream = f"test.workflow-event-spine.commit-failure.{backend_name}"
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_BACKEND", "memory")
    monkeypatch.setenv("WORKFLOW_EVENT_MIRROR_STREAM", stream)
    run_id = _bounded_run_id("commit-failure", backend_name)
    response = await client.post(
        "/api/v1/workflows/runs",
        json={
            "project": workflow_conformance_project(),
            "runId": run_id,
            "traceId": "trace-event-spine-commit-failure",
            "sourceOutputs": workflow_conformance_source_outputs(),
        },
    )
    assert response.status_code == 202

    async def fail_commit() -> None:
        raise RuntimeError("injected commit failure")

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="injected commit failure"):
        await commit_session(db_session)

    assert run_id not in _RUNS
    assert await db_session.get(WorkflowRun, run_id) is None
    assert await list_workflow_event_mirror_records(
        run_id,
        backend="memory",
        stream=stream,
    ) == []
