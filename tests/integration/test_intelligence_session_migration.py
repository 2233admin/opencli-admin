import asyncio
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.postgres_conformance import temporary_postgres_database


def _run_alembic(
    database_url: str, *args: str
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


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }


def test_intelligence_migration_upgrade_downgrade_reupgrade(tmp_path):
    database_path = tmp_path / "intelligence-migration.db"
    database_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"

    before = _run_alembic(database_url, "upgrade", "v2c3d4e5f6g7")
    assert before.returncode == 0, before.stderr
    with sqlite3.connect(database_path) as connection:
        assert "intelligence_sessions" not in _tables(connection)

    upgraded = _run_alembic(database_url, "upgrade", "head")
    assert upgraded.returncode == 0, upgraded.stderr
    with sqlite3.connect(database_path) as connection:
        tables = _tables(connection)
        assert {
            "intelligence_sessions",
            "intelligence_artifacts",
            "intelligence_artifact_references",
            "intelligence_transitions",
            "intelligence_command_records",
            "intelligence_outbox",
        } <= tables

    downgraded = _run_alembic(database_url, "downgrade", "v2c3d4e5f6g7")
    assert downgraded.returncode == 0, downgraded.stderr
    with sqlite3.connect(database_path) as connection:
        assert "intelligence_sessions" not in _tables(connection)

    reupgraded = _run_alembic(database_url, "upgrade", "head")
    assert reupgraded.returncode == 0, reupgraded.stderr


def test_intelligence_migration_renders_postgresql_offline_sql(tmp_path):
    result = _run_alembic(
        "postgresql+asyncpg://opencli:opencli@localhost/opencli",
        "upgrade",
        "v2c3d4e5f6g7:head",
        "--sql",
    )
    assert result.returncode == 0, result.stderr
    assert "CREATE TABLE intelligence_sessions" in result.stdout
    assert "CREATE TABLE intelligence_artifact_references" in result.stdout


async def _postgres_tables(database_url: str) -> set[str]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            rows = await connection.scalars(
                text(
                    """
                    SELECT tablename
                    FROM pg_catalog.pg_tables
                    WHERE schemaname = current_schema()
                    """
                )
            )
            return {str(table) for table in rows}
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.postgres_conformance
async def test_intelligence_migration_live_postgresql_upgrade_downgrade_reupgrade():
    async with temporary_postgres_database("intelligence_migration") as database_url:
        before = await asyncio.to_thread(
            _run_alembic,
            database_url,
            "upgrade",
            "v2c3d4e5f6g7",
        )
        assert before.returncode == 0, before.stderr
        assert "intelligence_sessions" not in await _postgres_tables(database_url)

        upgraded = await asyncio.to_thread(
            _run_alembic,
            database_url,
            "upgrade",
            "head",
        )
        assert upgraded.returncode == 0, upgraded.stderr
        assert {
            "intelligence_sessions",
            "intelligence_artifacts",
            "intelligence_artifact_references",
            "intelligence_transitions",
            "intelligence_command_records",
            "intelligence_outbox",
        } <= await _postgres_tables(database_url)

        downgraded = await asyncio.to_thread(
            _run_alembic,
            database_url,
            "downgrade",
            "v2c3d4e5f6g7",
        )
        assert downgraded.returncode == 0, downgraded.stderr
        assert "intelligence_sessions" not in await _postgres_tables(database_url)

        reupgraded = await asyncio.to_thread(
            _run_alembic,
            database_url,
            "upgrade",
            "head",
        )
        assert reupgraded.returncode == 0, reupgraded.stderr
