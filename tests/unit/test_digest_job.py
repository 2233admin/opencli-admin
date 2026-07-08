"""Tests for backend/worker/digest_job.py's standalone entrypoint (PR-G).

Mirrors tests/unit/test_scheduler.py's mocking style (patch
backend.database.AsyncSessionLocal with an async context manager double)
rather than hitting a real DB, since this module's job is just "resolve a
date, open a session, delegate to digest_service, commit" — the actual
digest-building logic is covered end-to-end in tests/unit/test_digest_service.py.
"""

from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_run_once_defaults_to_today_utc():
    from backend.worker import digest_job

    mock_digest = MagicMock()
    mock_digest.record_ids = ["r1", "r2"]

    mock_session = AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=mock_session)
    cm.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("backend.database.AsyncSessionLocal", return_value=cm),
        patch(
            "backend.services.digest_service.build_digest_for_date",
            new=AsyncMock(return_value=mock_digest),
        ) as mock_build,
    ):
        result = await digest_job.run_once()

    mock_build.assert_called_once()
    called_date = mock_build.call_args.args[1]
    assert isinstance(called_date, date)
    assert called_date == datetime.now(timezone.utc).date()
    assert result["record_count"] == 2
    mock_session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_run_once_uses_explicit_date():
    from backend.worker import digest_job

    mock_digest = MagicMock()
    mock_digest.record_ids = []

    mock_session = AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=mock_session)
    cm.__aexit__ = AsyncMock(return_value=False)

    target = date(2026, 1, 15)

    with (
        patch("backend.database.AsyncSessionLocal", return_value=cm),
        patch(
            "backend.services.digest_service.build_digest_for_date",
            new=AsyncMock(return_value=mock_digest),
        ) as mock_build,
    ):
        result = await digest_job.run_once(target)

    mock_build.assert_called_once_with(mock_session, target)
    assert result == {"date": "2026-01-15", "record_count": 0}


def test_main_parses_date_argument():
    from backend.worker import digest_job

    with patch("backend.worker.digest_job.asyncio.run") as mock_run:
        exit_code = digest_job.main(["2026-02-20"])

    assert exit_code == 0
    mock_run.assert_called_once()


def test_main_no_argument_defaults_to_none_date():
    from backend.worker import digest_job

    captured = {}

    async def fake_run_once(target_date=None):
        captured["target_date"] = target_date
        return {}

    with (
        patch("backend.worker.digest_job.run_once", side_effect=fake_run_once),
    ):
        digest_job.main([])

    assert captured["target_date"] is None


def test_celery_task_run_daily_digest_delegates_to_run_once():
    """backend.worker.tasks.run_daily_digest (the Celery-Beat-fired task)
    delegates to backend.worker.digest_job.run_once — verifies the wiring
    without needing an actual Celery worker/broker.

    Plain (non-async) test: run_daily_digest manages its own event loop
    internally (backend.worker.tasks._run_async), same as the pre-existing
    run_collection/run_scheduled_collection tasks — calling it from inside
    an already-running pytest-asyncio loop would raise "Cannot run the
    event loop while another loop is running"."""
    from backend.worker import tasks

    with patch(
        "backend.worker.digest_job.run_once",
        new=AsyncMock(return_value={"date": "2026-01-01", "record_count": 0}),
    ) as mock_run_once:
        result = tasks.run_daily_digest.run("2026-01-01")

    mock_run_once.assert_called_once()
    assert result == {"date": "2026-01-01", "record_count": 0}
