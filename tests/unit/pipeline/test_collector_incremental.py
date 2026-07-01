"""Incremental channels collect through run_channel; the cursor is staged and
returned in metadata for the pipeline to commit post-write (not during fetch)."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

import backend.channels.rss_channel  # noqa: F401 — register the rss channel
from backend.pipeline import collector
from backend.pipeline.channel_runner import RunResult


class _FakeDBCursor:
    """DBCursorStore stand-in: returns a seed cursor; save is a no-op here because
    the pipeline (not the collector) owns the durable commit."""

    def __init__(self, start=None):
        self._start = start

    async def load(self, source_id):
        return self._start

    async def save(self, source_id, cursor):  # pragma: no cover - not used by collector
        pass


@pytest.mark.asyncio
async def test_incremental_channel_routes_through_run_channel():
    source = SimpleNamespace(
        id="src-1", channel_type="rss", channel_config={"feed_url": "https://x/f"}
    )

    async def fake_run_channel(src, params, *, cursor_store, channel, http=None):
        # The runner advances the staged cursor during fetch.
        await cursor_store.save(src.id, {"etag": "v2"})
        return RunResult(items=[{"id": "a"}, {"id": "b"}])

    with (
        patch("backend.pipeline.channel_runner.run_channel", new=fake_run_channel),
        patch("backend.pipeline.cursor_store.DBCursorStore", _FakeDBCursor),
    ):
        result = await collector.collect(source, {})

    assert [i["id"] for i in result.items] == ["a", "b"]
    # Staged for the pipeline to commit AFTER the write — not yet persisted.
    assert result.metadata["__cursor_pending__"] == {"etag": "v2"}
    assert result.metadata["__cursor_source_id__"] == "src-1"


@pytest.mark.asyncio
async def test_incremental_seeds_runner_with_persisted_cursor():
    source = SimpleNamespace(
        id="src-1", channel_type="rss", channel_config={"feed_url": "https://x/f"}
    )
    seen = {}

    async def fake_run_channel(src, params, *, cursor_store, channel, http=None):
        seen["start"] = await cursor_store.load(src.id)  # what the runner starts from
        await cursor_store.save(src.id, {"etag": "v2"})
        return RunResult(items=[])

    with (
        patch("backend.pipeline.channel_runner.run_channel", new=fake_run_channel),
        patch(
            "backend.pipeline.cursor_store.DBCursorStore",
            lambda: _FakeDBCursor(start={"etag": "v1"}),
        ),
    ):
        await collector.collect(source, {})

    # The persisted cursor seeded the conditional fetch.
    assert seen["start"] == {"etag": "v1"}
