"""DualSink — legacy authoritative + ODP shadow forwarded exactly once.

The double-send trap: storer.store_records forwards to ODP on its own when
ODP_INGEST_URL is set. If DualSink's legacy leg also forwarded, ODP would get
the batch twice. These tests pin that the legacy leg runs with
forward_to_odp=False and ODP receives exactly one send, plus that an ODP failure
never disturbs the legacy write.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.pipeline.sinks import DualSink, LegacyDbSink, RunContext


def _ctx(**over):
    base = dict(task_id="t1", source_id="s1", provider="rss")
    base.update(over)
    return RunContext(**base)


def _session_cm():
    sess = AsyncMock()
    sess.commit = AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=sess)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_dual_sink_legacy_authoritative_odp_shadow_once():
    items = [{"title": "A", "url": "https://x/a"}]
    rec = MagicMock()
    store_mock = AsyncMock(return_value=([rec], 0))
    fwd_mock = AsyncMock(return_value=(1, 0, 0))

    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.pipeline.odp_client.forward_triples", new=fwd_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        result = await DualSink().write_batch(_ctx(), items)

    # Legacy is authoritative: its records flow through for AI/notify.
    assert result.records == [rec]
    assert result.accepted == 1
    # No double-send: the legacy leg ran with forward_to_odp=False...
    assert store_mock.call_args.kwargs["forward_to_odp"] is False
    # ...and ODP got exactly one send, via OdpSink.
    fwd_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_dual_sink_swallows_odp_failure():
    items = [{"title": "A", "url": "https://x/a"}]
    rec = MagicMock()
    store_mock = AsyncMock(return_value=([rec], 0))
    boom = AsyncMock(side_effect=RuntimeError("odp down"))

    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.pipeline.odp_client.forward_triples", new=boom),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        result = await DualSink().write_batch(_ctx(), items)

    # ODP down must not break the legacy write.
    assert result.records == [rec]
    assert result.accepted == 1
    assert any("odp" in e.lower() for e in result.errors)


@pytest.mark.asyncio
async def test_dual_sink_required_reraises_on_odp_failure():
    # require_odp=True (odp_dual_required / odp_primary): an ODP failure must be
    # surfaced, not swallowed — even though the legacy write already happened.
    items = [{"title": "A", "url": "https://x/a"}]
    rec = MagicMock()
    store_mock = AsyncMock(return_value=([rec], 0))
    boom = AsyncMock(side_effect=RuntimeError("odp down"))

    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.pipeline.odp_client.forward_triples", new=boom),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        with pytest.raises(RuntimeError, match="odp down"):
            await DualSink(require_odp=True).write_batch(_ctx(), items)

    # Legacy still ran (and would not double-send).
    assert store_mock.call_args.kwargs["forward_to_odp"] is False


@pytest.mark.asyncio
async def test_legacy_sink_forward_flag_passthrough():
    store_mock = AsyncMock(return_value=([], 0))
    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        await LegacyDbSink(forward_to_odp=False).write_batch(_ctx(), [{"title": "A"}])
    assert store_mock.call_args.kwargs["forward_to_odp"] is False


@pytest.mark.asyncio
async def test_legacy_sink_forward_flag_defaults_false():
    # P1-1 strangler collapse: the legacy write_strategy's sink must NOT
    # forward to ODP by default — that was the bare-env-var backdoor that let
    # an unmigrated source leak into ODP just because ODP_INGEST_URL happened
    # to be set somewhere in the deployment, bypassing write_strategy entirely.
    store_mock = AsyncMock(return_value=([], 0))
    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        await LegacyDbSink().write_batch(_ctx(), [{"title": "A"}])
    assert store_mock.call_args.kwargs["forward_to_odp"] is False
