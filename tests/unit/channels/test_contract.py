"""Phase 0 contract tests.

The thick channel contract (Capabilities / FetchContext / FetchResult / fetch /
identity) is ADDITIVE: a channel that implements only the legacy collect() — the
shape of all six existing channels — inherits fetch()/identity()/capabilities via
the default adapter, with unchanged runtime behaviour. These tests are the
non-breaking proof for that seam.
"""

from typing import Any

import pytest

from backend.channels.base import (
    AbstractChannel,
    Capabilities,
    ChannelFetchError,
    ChannelResult,
    FetchContext,
    FetchResult,
)
from backend.channels.rss_channel import RSSChannel


class CollectOnlyChannel(AbstractChannel):
    """Implements ONLY collect() + validate_config — exactly like the existing
    channels. It must get the thick contract for free."""

    channel_type = "collect_only"

    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail

    async def collect(
        self, config: dict[str, Any], parameters: dict[str, Any]
    ) -> ChannelResult:
        if self._fail:
            return ChannelResult.fail("boom")
        return ChannelResult.ok([{"title": "a"}, {"title": "b"}], source="x")

    async def validate_config(self, config: dict[str, Any]) -> list[str]:
        return []


def _ctx(**over: Any) -> FetchContext:
    base: dict[str, Any] = {"config": {}, "params": {}}
    base.update(over)
    return FetchContext(**base)


# ── capabilities default ─────────────────────────────────────────────────────

def test_default_capabilities_are_conservative():
    chan = CollectOnlyChannel()
    assert chan.capabilities.incremental is False
    assert chan.capabilities.paginated is False
    assert chan.capabilities.auth_kind == "none"
    assert chan.capabilities.session_affinity is False


# ── default fetch() bridges to collect() ─────────────────────────────────────

@pytest.mark.asyncio
async def test_default_fetch_bridges_to_collect():
    """A collect-only channel gets fetch() for free; items pass through, one-shot."""
    chan = CollectOnlyChannel()
    res = await chan.fetch(_ctx())
    assert isinstance(res, FetchResult)
    assert [i["title"] for i in res.items] == ["a", "b"]
    assert res.next_cursor is None
    assert res.has_more is False


@pytest.mark.asyncio
async def test_default_fetch_raises_on_collect_failure():
    """A failed collect() surfaces as ChannelFetchError so the runner can retry,
    instead of being silently dropped."""
    chan = CollectOnlyChannel(fail=True)
    with pytest.raises(ChannelFetchError):
        await chan.fetch(_ctx())


# ── default identity() ───────────────────────────────────────────────────────

def test_default_identity_is_none():
    chan = CollectOnlyChannel()
    assert chan.identity({"title": "a", "id": "x"}) is None


# ── existing channels inherit the contract unchanged ─────────────────────────

def test_existing_channel_inherits_contract():
    """The six real channels (RSSChannel as the witness) inherit the thick contract;
    in Phase 0 they have not overridden anything, so behaviour is unchanged."""
    chan = RSSChannel()
    assert isinstance(chan.capabilities, Capabilities)
    assert chan.capabilities.paginated is False
    assert chan.identity({"id": "abc"}) is None
    assert hasattr(chan, "fetch")
