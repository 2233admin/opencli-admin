"""Phase 1 runner tests: run_channel owns the cross-cutting concerns (pagination,
cursor load/save) so channels stay thin and only implement fetch()."""

from types import SimpleNamespace
from typing import Any

import pytest

from backend.channels.base import (
    AbstractChannel,
    Capabilities,
    ChannelResult,
    FetchResult,
)
from backend.pipeline.channel_runner import MAX_PAGES, run_channel
from backend.pipeline.cursor_store import InMemoryCursorStore


def _source(**over: Any) -> SimpleNamespace:
    base: dict[str, Any] = {"id": "s1", "channel_type": "fake", "channel_config": {}}
    base.update(over)
    return SimpleNamespace(**base)


class PagedChannel(AbstractChannel):
    """Incremental + paginated channel: cursor is {"page": n}; emits 2 items/page."""

    channel_type = "paged"
    capabilities = Capabilities(incremental=True, paginated=True)

    def __init__(self, total_pages: int = 3) -> None:
        self.total = total_pages
        self.cursors_seen: list[dict | None] = []

    async def fetch(self, ctx):
        self.cursors_seen.append(ctx.cursor)
        idx = (ctx.cursor or {}).get("page", 0)
        items = [{"id": f"{idx}-{i}"} for i in range(2)]
        nxt = idx + 1
        return FetchResult(items=items, next_cursor={"page": nxt}, has_more=nxt < self.total)

    async def collect(self, config, parameters):  # pragma: no cover - must not run
        raise AssertionError("runner must call fetch(), not collect()")

    async def validate_config(self, config):
        return []


class CollectOnlyChannel(AbstractChannel):
    """Default caps: fetch() bridges to collect(), one shot, no cursor."""

    channel_type = "co"

    async def collect(self, config, parameters):
        return ChannelResult.ok([{"id": "x"}])

    async def validate_config(self, config):
        return []


class InfiniteChannel(AbstractChannel):
    """Always has_more → exercises the MAX_PAGES guard. 1 item/page."""

    channel_type = "inf"
    capabilities = Capabilities(incremental=True, paginated=True)

    async def fetch(self, ctx):
        idx = (ctx.cursor or {}).get("page", 0)
        return FetchResult(items=[{"id": idx}], next_cursor={"page": idx + 1}, has_more=True)

    async def collect(self, config, parameters):  # pragma: no cover
        raise AssertionError("unused")

    async def validate_config(self, config):
        return []


@pytest.mark.asyncio
async def test_runner_drives_pagination_and_saves_cursor_each_page():
    chan = PagedChannel(total_pages=3)
    store = InMemoryCursorStore()
    items = (await run_channel(_source(), {}, channel=chan, cursor_store=store, http=object())).items

    assert len(items) == 6  # 3 pages x 2 items
    assert [i["id"] for i in items] == ["0-0", "0-1", "1-0", "1-1", "2-0", "2-1"]
    # First fetch sees no cursor, then each saved cursor in turn.
    assert chan.cursors_seen == [None, {"page": 1}, {"page": 2}]
    # Cursor persisted after the last page → next run resumes from page 3.
    assert await store.load("s1") == {"page": 3}


@pytest.mark.asyncio
async def test_runner_resumes_from_stored_cursor():
    chan = PagedChannel(total_pages=3)
    store = InMemoryCursorStore()
    await store.save("s1", {"page": 2})  # pretend a prior run got to page 2
    items = (await run_channel(_source(), {}, channel=chan, cursor_store=store, http=object())).items

    assert chan.cursors_seen[0] == {"page": 2}  # started where it left off
    assert [i["id"] for i in items] == ["2-0", "2-1"]  # only the remaining page


@pytest.mark.asyncio
async def test_collect_only_channel_runs_once_no_cursor():
    chan = CollectOnlyChannel()
    store = InMemoryCursorStore()
    result = await run_channel(_source(), {}, channel=chan, cursor_store=store, http=object())

    assert result.items == [{"id": "x"}]
    assert await store.load("s1") is None  # not incremental → nothing saved


@pytest.mark.asyncio
async def test_max_pages_guard_stops_infinite_pagination():
    items = (await run_channel(
        _source(), {}, channel=InfiniteChannel(), cursor_store=InMemoryCursorStore(), http=object()
    )).items
    assert len(items) == MAX_PAGES


class MetadataChannel(AbstractChannel):
    """collect()-only channel whose ChannelResult carries non-item metadata (the
    opencli/skill shape: node_url, awaiting_confirm, ...)."""

    channel_type = "md"

    async def collect(self, config, parameters):
        return ChannelResult.ok([{"id": "x"}], node_url="http://node:1", awaiting_confirm=True)

    async def validate_config(self, config):
        return []


@pytest.mark.asyncio
async def test_default_fetch_adapter_forwards_collect_metadata():
    """The default fetch() adapter must not drop collect()'s metadata — opencli's
    node_url and skill's awaiting_confirm depend on it reaching PipelineResult."""
    result = await run_channel(
        _source(), {}, channel=MetadataChannel(), cursor_store=InMemoryCursorStore(), http=object()
    )
    assert result.metadata == {"node_url": "http://node:1", "awaiting_confirm": True}
