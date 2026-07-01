"""Unit tests for pipeline collector."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from backend.channels.base import AbstractChannel, ChannelFetchError, ChannelResult
from backend.pipeline.collector import collect


class _FakeDBCursor:
    """DBCursorStore stand-in: no source has a persisted cursor here."""

    async def load(self, source_id):
        return None

    async def save(self, source_id, cursor):  # pragma: no cover - not exercised here
        pass


class _StubChannel(AbstractChannel):
    """collect()-only channel: exercises the default fetch() adapter every
    channel that hasn't migrated to a custom fetch() gets."""

    channel_type = "stub"

    def __init__(self, result):
        self._result = result

    async def collect(self, config, parameters):
        return self._result

    async def validate_config(self, config):
        return []


@pytest.mark.asyncio
async def test_collect_dispatches_to_channel():
    source = SimpleNamespace(
        id="src-1", channel_type="rss", channel_config={"feed_url": "https://ex.com/feed"}
    )
    channel = _StubChannel(ChannelResult.ok([{"title": "Test"}]))

    with (
        patch("backend.pipeline.collector.get_channel", return_value=channel),
        patch("backend.pipeline.cursor_store.DBCursorStore", _FakeDBCursor),
    ):
        result = await collect(source, {"extra": "param"})

    assert result.success is True
    assert result.count == 1
    assert result.items == [{"title": "Test"}]


@pytest.mark.asyncio
async def test_collect_propagates_failure():
    """A failing collect() surfaces as ChannelFetchError (the default fetch()
    adapter's contract, Phase 0) — pipeline.py's step1 catches this the same way
    it already catches any other collect-stage exception."""
    source = SimpleNamespace(id="src-2", channel_type="api", channel_config={})
    channel = _StubChannel(ChannelResult.fail("timeout"))

    with (
        patch("backend.pipeline.collector.get_channel", return_value=channel),
        patch("backend.pipeline.cursor_store.DBCursorStore", _FakeDBCursor),
    ):
        with pytest.raises(ChannelFetchError, match="timeout"):
            await collect(source, {})


@pytest.mark.asyncio
async def test_collect_non_incremental_channel_skips_cursor_db_load():
    """Only incremental channels can ever have a persisted cursor — collect()
    must not even instantiate DBCursorStore for the other channel types (api,
    cli, opencli, skill, web_scraper)."""
    source = SimpleNamespace(id="src-3", channel_type="stub", channel_config={})
    channel = _StubChannel(ChannelResult.ok([{"id": 1}]))

    with (
        patch("backend.pipeline.collector.get_channel", return_value=channel),
        patch("backend.pipeline.cursor_store.DBCursorStore") as mock_db_cursor,
    ):
        result = await collect(source, {})

    assert result.success is True
    mock_db_cursor.assert_not_called()


@pytest.mark.asyncio
async def test_collect_channel_metadata_named_cursor_pending_survives():
    """The runner's own cursor-bookkeeping keys are reserved-prefixed
    (__cursor_pending__/__cursor_source_id__) precisely so a channel that
    emits a plain 'cursor_pending' key for its own purposes isn't silently
    clobbered by dict-spread collision."""
    source = SimpleNamespace(id="src-4", channel_type="stub", channel_config={})
    channel = _StubChannel(ChannelResult.ok([{"id": 1}], cursor_pending="not-the-runners"))

    with patch("backend.pipeline.collector.get_channel", return_value=channel):
        result = await collect(source, {})

    assert result.metadata["cursor_pending"] == "not-the-runners"
    assert result.metadata["__cursor_pending__"] is None
