"""Unit tests for backend.pipeline.events (AUDIT C24: emit_many batches a
whole step trace into one session + bulk insert + one commit, instead of one
session+INSERT+commit per event)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.pipeline import events


@pytest.mark.asyncio
async def test_emit_many_one_session_one_commit_for_n_events():
    """N events must cost exactly one session + one commit, not N."""
    mock_session = AsyncMock()
    mock_session.add_all = MagicMock()
    mock_session.commit = AsyncMock()
    session_cm = AsyncMock()
    session_cm.__aenter__ = AsyncMock(return_value=mock_session)
    session_cm.__aexit__ = AsyncMock(return_value=False)

    session_ctor_calls: list[int] = []

    def fake_session_local():
        session_ctor_calls.append(1)
        return session_cm

    payloads = [
        {"step": "skill_perceive", "message": "start"},
        {"step": "skill_step", "message": "step 1", "detail": {"i": 1}},
        {
            "step": "skill_step",
            "message": "step 2",
            "level": "warning",
            "detail": {"i": 2},
            "elapsed_ms": 10,
        },
        {"step": "skill_done", "message": "done"},
    ]

    with patch("backend.database.AsyncSessionLocal", side_effect=fake_session_local):
        await events.emit_many("run-1", payloads)

    # one session opened regardless of how many events were in the batch.
    assert len(session_ctor_calls) == 1
    # one bulk insert call, not one add() per event.
    mock_session.add_all.assert_called_once()
    inserted = mock_session.add_all.call_args.args[0]
    assert len(inserted) == 4
    # one commit, not one per event.
    assert mock_session.commit.await_count == 1

    # field mapping: shared run_id, defaults applied, explicit values kept.
    assert all(row.run_id == "run-1" for row in inserted)
    assert inserted[0].level == "info"  # default when not specified
    assert inserted[2].level == "warning"
    assert inserted[2].elapsed_ms == 10
    assert inserted[1].detail == {"i": 1}
    assert inserted[3].step == "skill_done"


@pytest.mark.asyncio
async def test_emit_many_empty_list_is_noop_no_session_opened():
    session_ctor_calls: list[int] = []

    def fake_session_local():
        session_ctor_calls.append(1)
        raise AssertionError("should not open a session for an empty batch")

    with patch("backend.database.AsyncSessionLocal", side_effect=fake_session_local):
        await events.emit_many("run-1", [])

    assert session_ctor_calls == []


@pytest.mark.asyncio
async def test_emit_many_never_raises_on_db_failure():
    """Best-effort, mirrors emit(): a DB failure must not propagate."""
    with patch("backend.database.AsyncSessionLocal", side_effect=RuntimeError("db down")):
        await events.emit_many("run-1", [{"step": "x", "message": "y"}])  # must not raise
