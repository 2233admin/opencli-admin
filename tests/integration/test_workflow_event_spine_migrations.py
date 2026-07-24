import asyncio
import os
import subprocess
import sys
from contextlib import AsyncExitStack
from pathlib import Path

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.models.workflow_run import WorkflowRun, WorkflowRunEvent
from backend.workflow.workflow_run_events import reconcile_workflow_run_event_counters
from tests.postgres_conformance import temporary_postgres_database


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
async def event_spine_migration_database(request, tmp_path):
    async with AsyncExitStack() as resources:
        if request.param == "sqlite":
            database_path = tmp_path / "event-spine-migration.db"
            database_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
        else:
            database_url = await resources.enter_async_context(
                temporary_postgres_database("workflow_event_migration")
            )
        yield database_url


def _run_alembic(
    database_url: str,
    *args: str,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=Path(__file__).parents[2],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


async def _alembic(
    database_url: str,
    *args: str,
) -> subprocess.CompletedProcess[str]:
    return await asyncio.to_thread(_run_alembic, database_url, *args)


async def _schema_shape(database_url: str) -> tuple[set[str], dict[str, bool]]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:

            def read_shape(sync_connection):
                schema = inspect(sync_connection)
                columns = {
                    str(column["name"])
                    for column in schema.get_columns("workflow_runs")
                }
                indexes = {
                    str(index["name"]): bool(index.get("unique"))
                    for index in schema.get_indexes("workflow_run_events")
                }
                return columns, indexes

            return await connection.run_sync(read_shape)
    finally:
        await engine.dispose()


async def _insert_legacy_rows(
    database_url: str,
    *,
    run_id: str,
    next_event_sequence: int,
    events: list[dict],
) -> None:
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                WorkflowRun.__table__.insert().values(
                    id=run_id,
                    workflow_id=f"workflow-{run_id}",
                    trace_id=f"trace-{run_id}",
                    status="running",
                    valid=True,
                    package_node_id=None,
                    request={},
                    projection={},
                    next_event_sequence=next_event_sequence,
                )
            )
            await connection.execute(
                WorkflowRunEvent.__table__.insert(),
                [
                    {
                        "id": event["id"],
                        "run_id": run_id,
                        "workflow_id": f"workflow-{run_id}",
                        "trace_id": f"trace-{run_id}",
                        "event_id": event["event_id"],
                        "node_id": "node-1",
                        "sequence": event["sequence"],
                        "event_type": "partial",
                        "payload": {},
                    }
                    for event in events
                ],
            )
    finally:
        await engine.dispose()


async def _next_event_sequence(database_url: str, run_id: str) -> int | None:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            return await connection.scalar(
                select(WorkflowRun.next_event_sequence).where(WorkflowRun.id == run_id)
            )
    finally:
        await engine.dispose()


def test_workflow_event_spine_expand_renders_postgresql_offline_sql():
    result = _run_alembic(
        "postgresql+asyncpg://opencli:opencli@localhost/opencli_test",
        "upgrade",
        "z5f6g7h8i9j0:v1b2c3d4e5f7",
        "--sql",
    )

    assert result.returncode == 0, result.stderr
    assert "ALTER TABLE workflow_runs ADD COLUMN next_event_sequence" in result.stdout
    assert "MAX(workflow_run_events.sequence) + 1" in result.stdout


@pytest.mark.asyncio
async def test_workflow_event_spine_expand_contract_downgrade_reupgrade(
    event_spine_migration_database,
):
    database_url = event_spine_migration_database

    upgraded = await _alembic(database_url, "upgrade", "head")
    assert upgraded.returncode == 0, upgraded.stderr
    columns, indexes = await _schema_shape(database_url)
    assert "next_event_sequence" in columns
    assert indexes["ix_workflow_run_events_event_id"] is True
    assert indexes["ux_workflow_run_events_run_id_sequence"] is True

    contract_downgrade = await _alembic(
        database_url,
        "downgrade",
        "v1b2c3d4e5f7",
    )
    assert contract_downgrade.returncode == 0, contract_downgrade.stderr
    _, indexes = await _schema_shape(database_url)
    assert indexes["ix_workflow_run_events_event_id"] is False
    assert "ux_workflow_run_events_run_id_sequence" not in indexes

    expanded_only_downgrade = await _alembic(
        database_url,
        "downgrade",
        "z5f6g7h8i9j0",
    )
    assert expanded_only_downgrade.returncode == 0, expanded_only_downgrade.stderr
    columns, _ = await _schema_shape(database_url)
    assert "next_event_sequence" not in columns

    reupgraded = await _alembic(database_url, "upgrade", "head")
    assert reupgraded.returncode == 0, reupgraded.stderr


@pytest.mark.asyncio
async def test_workflow_event_spine_contract_aborts_on_duplicate_legacy_sequence(
    event_spine_migration_database,
):
    database_url = event_spine_migration_database
    expanded = await _alembic(database_url, "upgrade", "v1b2c3d4e5f7")
    assert expanded.returncode == 0, expanded.stderr
    await _insert_legacy_rows(
        database_url,
        run_id="run-duplicate",
        next_event_sequence=2,
        events=[
            {"id": "row-1", "event_id": "event-1", "sequence": 1},
            {"id": "row-2", "event_id": "event-2", "sequence": 1},
        ],
    )

    contracted = await _alembic(database_url, "upgrade", "head")
    assert contracted.returncode != 0
    assert "duplicate run sequence" in contracted.stderr


@pytest.mark.asyncio
async def test_workflow_event_spine_contract_aborts_on_duplicate_id_and_counter_drift(
    event_spine_migration_database,
):
    database_url = event_spine_migration_database
    expanded = await _alembic(database_url, "upgrade", "v1b2c3d4e5f7")
    assert expanded.returncode == 0, expanded.stderr
    await _insert_legacy_rows(
        database_url,
        run_id="run-id-drift",
        next_event_sequence=9,
        events=[
            {"id": "row-1", "event_id": "duplicate-event-id", "sequence": 1},
            {"id": "row-2", "event_id": "duplicate-event-id", "sequence": 2},
        ],
    )

    contracted = await _alembic(database_url, "upgrade", "head")
    assert contracted.returncode != 0
    assert "duplicate event_id" in contracted.stderr
    assert "counter drift" in contracted.stderr


@pytest.mark.asyncio
async def test_stopped_writer_reconciliation_catches_legacy_append_before_contract(
    event_spine_migration_database,
):
    database_url = event_spine_migration_database
    expanded = await _alembic(database_url, "upgrade", "v1b2c3d4e5f7")
    assert expanded.returncode == 0, expanded.stderr
    await _insert_legacy_rows(
        database_url,
        run_id="run-legacy",
        next_event_sequence=1,
        events=[{"id": "legacy-row", "event_id": "legacy-event", "sequence": 1}],
    )

    engine = create_async_engine(database_url)
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with sessions() as session:
            reconciled = await reconcile_workflow_run_event_counters(session)
            await session.commit()
        assert reconciled >= 1
    finally:
        await engine.dispose()

    contracted = await _alembic(database_url, "upgrade", "head")
    assert contracted.returncode == 0, contracted.stderr
    assert await _next_event_sequence(database_url, "run-legacy") == 2
