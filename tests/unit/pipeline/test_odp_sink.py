"""OdpSink — forward-only destination: normalizes, posts, owns no local rows."""

from unittest.mock import AsyncMock, patch

import pytest

from backend.pipeline.sinks import OdpSink, RunContext


def _ctx(**over):
    base = dict(task_id="t1", source_id="s1", provider="rss")
    base.update(over)
    return RunContext(**base)


@pytest.mark.asyncio
async def test_odp_sink_forwards_and_counts():
    items = [{"title": "A", "url": "https://x/a"}]
    fwd = AsyncMock(return_value=(1, 0, 0))
    with patch("backend.pipeline.odp_client.forward_triples", new=fwd):
        result = await OdpSink().write_batch(_ctx(), items)

    assert (result.accepted, result.duplicates, result.rejected) == (1, 0, 0)
    assert result.normalized == 1
    # forward-only: no local rows, so AI/notify no-op downstream.
    assert result.records == []
    fwd.assert_awaited_once()
    kwargs = fwd.call_args.kwargs
    assert kwargs["channel_type"] == "rss"  # ctx.provider -> channel_type
    assert kwargs["source_id"] == "s1"
    assert len(kwargs["triples"]) == 1


@pytest.mark.asyncio
async def test_odp_sink_empty_items_noop():
    fwd = AsyncMock(return_value=(0, 0, 0))
    with patch("backend.pipeline.odp_client.forward_triples", new=fwd):
        result = await OdpSink().write_batch(_ctx(), [])

    assert (result.accepted, result.duplicates, result.rejected) == (0, 0, 0)
    assert result.records == []
    fwd.assert_not_awaited()


@pytest.mark.asyncio
async def test_odp_sink_propagates_failure():
    # Standalone OdpSink does not swallow — odp_primary/odp_only must see failures.
    # (DualSink wraps and swallows for shadow mode; see test_dual_sink.)
    boom = AsyncMock(side_effect=RuntimeError("odp down"))
    with patch("backend.pipeline.odp_client.forward_triples", new=boom):
        with pytest.raises(RuntimeError, match="odp down"):
            await OdpSink().write_batch(_ctx(), [{"title": "A"}])
