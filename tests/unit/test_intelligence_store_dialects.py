import pytest
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.schema import CreateTable

import backend.database as database_module
from backend.models.intelligence import (
    IntelligenceArtifact,
    IntelligenceArtifactReference,
    IntelligenceCommandRecord,
    IntelligenceOutbox,
    IntelligenceSession,
    IntelligenceTransition,
)
from backend.workflow.intelligence_store import (
    IntelligenceStoreError,
    _is_transient_transaction_error,
    _session_cas_statement,
    run_intelligence_transaction,
)
from backend.workflow.native_intelligence_state import IntelligenceState


def test_intelligence_tables_and_cas_compile_for_sqlite_and_postgresql():
    tables = (
        IntelligenceSession.__table__,
        IntelligenceArtifact.__table__,
        IntelligenceArtifactReference.__table__,
        IntelligenceTransition.__table__,
        IntelligenceCommandRecord.__table__,
        IntelligenceOutbox.__table__,
    )
    statement = _session_cas_statement(
        "session-1",
        4,
        IntelligenceState.REPORTING,
        {
            "state": IntelligenceState.REPORTED,
            "version": 5,
            "transition_sequence": 5,
            "workflow_projection": {"status": "completed"},
        },
    )

    for dialect in (sqlite.dialect(), postgresql.dialect()):
        ddl = "\n".join(
            str(CreateTable(table).compile(dialect=dialect)) for table in tables
        )
        sql = str(statement.compile(dialect=dialect))
        assert "intelligence_sessions" in ddl
        assert "intelligence_artifact_references" in ddl
        assert "FOREIGN KEY(session_id, source_artifact_id)" in ddl
        assert "seed BIGINT" in ddl
        assert "UPDATE intelligence_sessions" in sql
        assert "intelligence_sessions.version" in sql


@pytest.mark.parametrize(
    ("attribute", "sqlstate"),
    (
        ("sqlstate", "40001"),
        ("sqlstate", "40P01"),
        ("pgcode", "40001"),
        ("pgcode", "40P01"),
    ),
)
def test_postgresql_transaction_sqlstates_are_transient(attribute, sqlstate):
    original = RuntimeError("postgres transaction aborted")
    setattr(original, attribute, sqlstate)
    error = OperationalError("UPDATE intelligence_sessions", {}, original)

    assert _is_transient_transaction_error(error) is True


def test_nontransient_postgresql_operational_error_is_not_retried():
    original = RuntimeError("connection refused")
    original.sqlstate = "08006"
    error = OperationalError("UPDATE intelligence_sessions", {}, original)

    assert _is_transient_transaction_error(error) is False


@pytest.mark.asyncio
async def test_nontransient_operational_error_survives_cleanup_failure(
    db_session,
    monkeypatch,
):
    assert db_session.bind is not None
    sessions = async_sessionmaker(
        db_session.bind,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    attempts = 0
    cleanup_attempts = 0

    async def fail_cleanup(_session):
        nonlocal cleanup_attempts
        cleanup_attempts += 1
        raise RuntimeError("rollback cleanup failed")

    monkeypatch.setattr(database_module, "rollback_session", fail_cleanup)

    async def fail_nontransient(_store):
        nonlocal attempts
        attempts += 1
        raise OperationalError(
            "UPDATE intelligence_sessions",
            {},
            RuntimeError("connection refused"),
        )

    with pytest.raises(OperationalError, match="connection refused"):
        await run_intelligence_transaction(sessions, fail_nontransient)

    assert attempts == 1
    assert cleanup_attempts == 1


@pytest.mark.asyncio
async def test_transient_retry_and_exhaustion_survive_cleanup_failure(
    db_session,
    monkeypatch,
):
    assert db_session.bind is not None
    sessions = async_sessionmaker(
        db_session.bind,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    cleanup_attempts = 0

    async def fail_cleanup(_session):
        nonlocal cleanup_attempts
        cleanup_attempts += 1
        raise RuntimeError("rollback cleanup failed")

    monkeypatch.setattr(database_module, "rollback_session", fail_cleanup)
    attempts = 0

    async def fail_once(_store):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OperationalError(
                "UPDATE intelligence_sessions",
                {},
                RuntimeError("database is locked"),
            )
        return "committed"

    assert await run_intelligence_transaction(sessions, fail_once) == "committed"
    assert attempts == 2
    assert cleanup_attempts == 1

    attempts = 0
    with pytest.raises(
        IntelligenceStoreError,
        match="intelligence_transaction_retry_exhausted",
    ):
        await run_intelligence_transaction(
            sessions,
            lambda _store: _raise_transient_lock(),
        )
    assert cleanup_attempts == 4


@pytest.mark.asyncio
async def test_domain_error_survives_cleanup_failure(db_session, monkeypatch):
    assert db_session.bind is not None
    sessions = async_sessionmaker(
        db_session.bind,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async def fail_cleanup(_session):
        raise RuntimeError("rollback cleanup failed")

    monkeypatch.setattr(database_module, "rollback_session", fail_cleanup)

    async def fail_domain(_store):
        raise IntelligenceStoreError("primary domain failure")

    with pytest.raises(IntelligenceStoreError, match="primary domain failure"):
        await run_intelligence_transaction(sessions, fail_domain)


async def _raise_transient_lock():
    raise OperationalError(
        "UPDATE intelligence_sessions",
        {},
        RuntimeError("database is locked"),
    )
