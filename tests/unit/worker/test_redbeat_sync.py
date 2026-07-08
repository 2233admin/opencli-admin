"""Unit tests for backend/worker/redbeat_sync.py.

No real redis in this environment (no fixture, no local server) — these mock
the redbeat library boundary, same approach the rest of this codebase uses
for other external I/O (httpx clients, AsyncSessionLocal).
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from backend.worker import redbeat_sync


def _schedule(**over):
    base = dict(
        id="sched-1", enabled=True, cron_expression="*/5 * * * *",
        source_id="src-1", parameters={"limit": 10},
    )
    base.update(over)
    return SimpleNamespace(**base)


def test_sync_entry_saves_enabled_schedule():
    mock_entry_cls = MagicMock()
    mock_instance = mock_entry_cls.return_value

    with patch("redbeat.RedBeatSchedulerEntry", mock_entry_cls):
        redbeat_sync.sync_entry(_schedule())

    assert mock_entry_cls.call_args.kwargs["name"] == "schedule-sched-1"
    assert mock_entry_cls.call_args.kwargs["task"] == "run_scheduled_collection"
    assert mock_entry_cls.call_args.kwargs["kwargs"] == {
        "schedule_id": "sched-1", "source_id": "src-1", "parameters": {"limit": 10},
    }
    mock_instance.save.assert_called_once()


def test_sync_entry_disabled_schedule_removes_instead():
    with patch.object(redbeat_sync, "remove_entry") as mock_remove:
        redbeat_sync.sync_entry(_schedule(enabled=False))
    mock_remove.assert_called_once_with("sched-1")


def test_remove_entry_deletes_existing():
    mock_entry_cls = MagicMock()
    mock_entry_cls.generate_key.return_value = "redbeat:schedule-sched-1"
    found_entry = MagicMock()
    mock_entry_cls.from_key.return_value = found_entry

    with patch("redbeat.RedBeatSchedulerEntry", mock_entry_cls):
        redbeat_sync.remove_entry("sched-1")

    mock_entry_cls.from_key.assert_called_once()
    found_entry.delete.assert_called_once()


def test_remove_entry_missing_is_not_an_error():
    """A schedule that was created disabled (never saved to redbeat) has no
    entry — from_key raising KeyError must not propagate."""
    mock_entry_cls = MagicMock()
    mock_entry_cls.generate_key.return_value = "redbeat:schedule-ghost"
    mock_entry_cls.from_key.side_effect = KeyError("redbeat:schedule-ghost")

    with patch("redbeat.RedBeatSchedulerEntry", mock_entry_cls):
        redbeat_sync.remove_entry("ghost")  # must not raise


@pytest.mark.asyncio
async def test_populate_all_syncs_enabled_and_removes_the_rest(db_session):
    """Covers all 3 reconciliation cases in one pass: enabled schedule on an
    enabled source (synced), schedule disabled directly in the DB (removed —
    populate_all must still see it to clean up a stale redbeat entry, not
    just skip it), and an enabled schedule whose source got disabled
    (removed too, even though the schedule row itself is still enabled)."""
    from backend.models.schedule import CronSchedule
    from backend.models.source import DataSource

    source = DataSource(
        name="Populate Source", channel_type="rss",
        channel_config={"feed_url": "https://ex.com/feed.xml"},
    )
    disabled_source = DataSource(
        name="Disabled Source", channel_type="rss",
        channel_config={"feed_url": "https://ex.com/feed2.xml"}, enabled=False,
    )
    db_session.add_all([source, disabled_source])
    await db_session.flush()

    s1 = CronSchedule(source_id=source.id, name="A", cron_expression="0 * * * *", enabled=True)
    s2 = CronSchedule(
        source_id=source.id, name="B-disabled", cron_expression="0 0 * * *", enabled=False
    )
    s3 = CronSchedule(
        source_id=disabled_source.id, name="C-source-disabled",
        cron_expression="*/5 * * * *", enabled=True,
    )
    db_session.add_all([s1, s2, s3])
    await db_session.commit()

    synced_ids, removed_ids = [], []

    with (
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm(db_session)),
        patch.object(redbeat_sync, "sync_entry", side_effect=lambda s: synced_ids.append(s.id)),
        patch.object(redbeat_sync, "remove_entry", side_effect=lambda sid: removed_ids.append(sid)),
    ):
        await redbeat_sync.populate_all()

    assert synced_ids == [s1.id]
    assert set(removed_ids) == {s2.id, s3.id}


def _session_cm(session):
    from unittest.mock import AsyncMock
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm
