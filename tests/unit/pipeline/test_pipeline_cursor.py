"""Incremental cursor commit: the pipeline advances the persisted cursor ONLY
after the write sink accepts the batch — never during fetch, never on sink failure."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.channels.base import ChannelResult
from backend.pipeline.sinks import SinkResult


async def _seed(db_session):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask

    source = DataSource(
        name="Cursor Source", channel_type="rss", channel_config={"feed_url": "https://x/f"}
    )
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()
    return source, task


def _ok_sink():
    sink = MagicMock()
    sink.write_batch = AsyncMock(return_value=SinkResult(accepted=1, records=[MagicMock()]))
    return sink


@pytest.mark.asyncio
async def test_cursor_committed_after_durable_write(db_session):
    from backend.pipeline.pipeline import run_pipeline

    source, task = await _seed(db_session)
    save_mock = AsyncMock()
    cr = ChannelResult.ok(
        [{"title": "x"}], __cursor_pending__={"etag": "v2"}, __cursor_source_id__=source.id
    )

    with (
        patch("backend.pipeline.collector.collect", return_value=cr),
        patch("backend.pipeline.cursor_store.DBCursorStore") as DB,
    ):
        DB.return_value.save = save_mock
        result = await run_pipeline(
            task.id, source, enable_ai=False, enable_notifications=False, sink=_ok_sink()
        )

    assert result.success is True
    save_mock.assert_awaited_once_with(source.id, {"etag": "v2"})


@pytest.mark.asyncio
async def test_cursor_not_committed_when_absent(db_session):
    from backend.pipeline.pipeline import run_pipeline

    source, task = await _seed(db_session)
    save_mock = AsyncMock()
    cr = ChannelResult.ok([{"title": "x"}])  # non-incremental: no cursor_pending

    with (
        patch("backend.pipeline.collector.collect", return_value=cr),
        patch("backend.pipeline.cursor_store.DBCursorStore") as DB,
    ):
        DB.return_value.save = save_mock
        await run_pipeline(
            task.id, source, enable_ai=False, enable_notifications=False, sink=_ok_sink()
        )

    save_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_cursor_not_committed_when_sink_fails(db_session):
    from backend.pipeline.pipeline import run_pipeline

    source, task = await _seed(db_session)
    save_mock = AsyncMock()
    failing = MagicMock()
    failing.write_batch = AsyncMock(side_effect=RuntimeError("sink boom"))
    cr = ChannelResult.ok(
        [{"title": "x"}], __cursor_pending__={"etag": "v2"}, __cursor_source_id__=source.id
    )

    with (
        patch("backend.pipeline.collector.collect", return_value=cr),
        patch("backend.pipeline.cursor_store.DBCursorStore") as DB,
    ):
        DB.return_value.save = save_mock
        result = await run_pipeline(
            task.id, source, enable_ai=False, enable_notifications=False, sink=failing
        )

    # Sink raised → cursor must NOT advance past unwritten data.
    assert result.success is False
    save_mock.assert_not_awaited()
