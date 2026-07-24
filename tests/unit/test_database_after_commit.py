import logging

import pytest

import backend.database as database_module
from backend.database import (
    commit_session,
    get_db,
    queue_after_commit,
    rollback_session,
)
from backend.models.workflow_run import WorkflowRun


def _run(run_id: str) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        workflow_id="workflow-after-commit",
        trace_id=f"trace-{run_id}",
        status="running",
        valid=True,
        request={},
        projection={},
    )


class _FailingRollbackSession:
    def __init__(self, *, commit_error: Exception | None = None) -> None:
        self.info = {}
        self.commit_error = commit_error
        self.rollback_calls = 0
        self.close_calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback):
        return False

    async def commit(self):
        if self.commit_error is not None:
            raise self.commit_error

    async def rollback(self):
        self.rollback_calls += 1
        raise ValueError("rollback cleanup failed")

    async def close(self):
        self.close_calls += 1


@pytest.mark.asyncio
async def test_after_commit_callbacks_are_invisible_until_commit(db_session):
    published: list[str] = []
    db_session.add(_run("run-after-commit"))
    queue_after_commit(db_session, lambda: published.append("published"))
    await db_session.flush()

    assert published == []
    await commit_session(db_session)

    assert published == ["published"]
    assert await db_session.get(WorkflowRun, "run-after-commit") is not None


@pytest.mark.asyncio
async def test_rollback_discards_after_commit_callbacks(db_session):
    published: list[str] = []
    db_session.add(_run("run-after-rollback"))
    queue_after_commit(db_session, lambda: published.append("ghost"))
    await db_session.flush()

    await rollback_session(db_session)

    assert published == []
    assert await db_session.get(WorkflowRun, "run-after-rollback") is None


@pytest.mark.asyncio
async def test_callback_failure_is_logged_without_rolling_back_commit(db_session, caplog):
    published: list[str] = []
    db_session.add(_run("run-callback-failure"))

    def fail_publication() -> None:
        raise RuntimeError("mirror unavailable")

    queue_after_commit(db_session, fail_publication)
    queue_after_commit(db_session, lambda: published.append("cache"))

    with caplog.at_level(logging.ERROR, logger="backend.database"):
        await commit_session(db_session)

    assert published == ["cache"]
    assert await db_session.get(WorkflowRun, "run-callback-failure") is not None
    assert "authoritative transaction is committed" in caplog.text


@pytest.mark.asyncio
async def test_get_db_preserves_handler_error_when_rollback_cleanup_fails(
    monkeypatch,
    caplog,
):
    session = _FailingRollbackSession()
    monkeypatch.setattr(database_module, "AsyncSessionLocal", lambda: session)
    dependency = get_db()
    yielded = await anext(dependency)
    queue_after_commit(yielded, lambda: None)

    with caplog.at_level(logging.ERROR, logger="backend.database"):
        with pytest.raises(RuntimeError, match="handler primary failure"):
            await dependency.athrow(RuntimeError("handler primary failure"))

    assert session.rollback_calls == 1
    assert session.close_calls == 1
    assert session.info == {}
    assert "preserving primary exception" in caplog.text


@pytest.mark.asyncio
async def test_get_db_preserves_commit_error_when_rollback_cleanup_fails(
    monkeypatch,
    caplog,
):
    session = _FailingRollbackSession(
        commit_error=RuntimeError("commit primary failure")
    )
    monkeypatch.setattr(database_module, "AsyncSessionLocal", lambda: session)
    dependency = get_db()
    yielded = await anext(dependency)
    queue_after_commit(yielded, lambda: None)

    with caplog.at_level(logging.ERROR, logger="backend.database"):
        with pytest.raises(RuntimeError, match="commit primary failure"):
            await anext(dependency)

    assert session.rollback_calls >= 1
    assert session.close_calls == 1
    assert session.info == {}
    assert "preserving primary exception" in caplog.text


@pytest.mark.asyncio
async def test_rollback_without_primary_still_raises_cleanup_error():
    session = _FailingRollbackSession()
    queue_after_commit(session, lambda: None)

    with pytest.raises(ValueError, match="rollback cleanup failed"):
        await rollback_session(session)

    assert session.rollback_calls == 1
    assert session.info == {}
