"""PR1 seam tests: LegacyDbSink wraps the original normalize+store path, and
run_pipeline delegates the write through the injected ItemSink.

The existing test_pipeline.py + test_storer.py staying green is the
behavior-unchanged proof; these tests prove the seam itself exists and is wired.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.pipeline.sinks import LegacyDbSink, RunContext, SinkResult


def _ctx(**over):
    base = dict(task_id="t1", source_id="s1", provider="rss")
    base.update(over)
    return RunContext(**base)


def _session_cm():
    """A patched AsyncSessionLocal() context manager (storer is mocked, so the
    session itself is never exercised — only opened/closed/committed)."""
    sess = AsyncMock()
    sess.commit = AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=sess)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_legacy_sink_normalizes_then_stores():
    items = [{"title": "A", "url": "https://x/a"}, {"title": "B", "url": "https://x/b"}]
    rec1, rec2 = MagicMock(), MagicMock()
    store_mock = AsyncMock(return_value=([rec1, rec2], 1))

    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        result = await LegacyDbSink().write_batch(_ctx(), items)

    assert result.accepted == 2
    assert result.duplicates == 1
    assert result.normalized == 2
    assert result.records == [rec1, rec2]

    # storer was handed the normalized triples and the provider as channel_type.
    args, kwargs = store_mock.call_args
    assert kwargs["channel_type"] == "rss"
    triples = args[3]
    assert len(triples) == 2
    # Each triple is (raw, normalized, content_hash).
    assert triples[0][1]["title"] == "A"


@pytest.mark.asyncio
async def test_legacy_sink_resolves_channel_identity_for_c7():
    """C7: the sink asks the channel for each item's identity() and passes
    it through to store_records — this is what lets an RSS entry with a
    stable id be matched across re-fetches even after its title changes."""
    items = [
        {"title": "A", "url": "https://x/a", "id": "guid-a"},
        {"title": "B", "url": "https://x/b"},  # no "id" key: identity() is None for this one
    ]
    store_mock = AsyncMock(return_value=([], 0))

    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        await LegacyDbSink().write_batch(_ctx(), items)

    _, kwargs = store_mock.call_args
    # RSS's identity() reads item["id"] (real feed fetches populate it via
    # _entry_to_dict's fallback-to-link — out of scope here, this test is
    # at the sink layer with hand-built raw dicts): present for item 1,
    # absent for item 2.
    assert kwargs["identities"] == ["guid-a", None]


@pytest.mark.asyncio
async def test_legacy_sink_falls_back_when_channel_has_no_identity():
    """A channel_type with no identity() override (or unresolvable) passes
    identities=None through — store_records' documented content_hash-only
    fallback, unchanged from before C7."""
    items = [{"title": "A", "url": "https://x/a"}]
    store_mock = AsyncMock(return_value=([], 0))

    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        await LegacyDbSink().write_batch(_ctx(provider="cli"), items)

    _, kwargs = store_mock.call_args
    assert kwargs["identities"] == [None]


@pytest.mark.asyncio
async def test_legacy_sink_unknown_provider_degrades_to_no_identities():
    """An unregistered channel_type (get_channel raises) must not break
    storage — it degrades to identities=None, the unchanged pre-C7 path."""
    items = [{"title": "A", "url": "https://x/a"}]
    store_mock = AsyncMock(return_value=([], 0))

    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        result = await LegacyDbSink().write_batch(_ctx(provider="no-such-channel"), items)

    assert result.accepted == 0  # ran to completion, no exception raised
    _, kwargs = store_mock.call_args
    assert kwargs["identities"] is None


@pytest.mark.asyncio
async def test_legacy_sink_empty_items():
    store_mock = AsyncMock(return_value=([], 0))
    with (
        patch("backend.pipeline.storer.store_records", new=store_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        result = await LegacyDbSink().write_batch(_ctx(), [])

    assert result.accepted == 0
    assert result.duplicates == 0
    assert result.normalized == 0
    assert result.records == []


@pytest.mark.asyncio
async def test_run_pipeline_routes_through_injected_sink(db_session):
    """The seam is wired: run_pipeline delegates the write to the injected sink
    instead of touching normalizer/storer directly."""
    from backend.channels.base import ChannelResult
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask
    from backend.pipeline.pipeline import run_pipeline

    source = DataSource(
        name="Seam Source",
        channel_type="rss",
        channel_config={"feed_url": "https://x/f"},
    )
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    fake_sink = MagicMock()
    fake_sink.write_batch = AsyncMock(
        return_value=SinkResult(
            accepted=3, duplicates=1, normalized=4,
            records=[MagicMock(), MagicMock(), MagicMock()],
        )
    )

    with patch(
        "backend.pipeline.collector.collect",
        return_value=ChannelResult.ok([{"title": "x"}]),
    ):
        result = await run_pipeline(
            task.id, source,
            enable_ai=False, enable_notifications=False,
            sink=fake_sink,
        )

    fake_sink.write_batch.assert_awaited_once()
    # The RunContext carried the run identity into the sink.
    ctx_arg = fake_sink.write_batch.call_args.args[0]
    assert ctx_arg.source_id == source.id
    assert ctx_arg.provider == "rss"

    assert result.success is True
    assert result.stored == 3
    assert result.skipped == 1
