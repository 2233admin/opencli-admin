"""session_affinity is generalized: the pipeline's browser-binding pre-step gates
on capabilities.session_affinity, not a hardcoded channel list."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.channels.base import ChannelResult
from backend.channels.opencli_channel import OpenCLIChannel
from backend.channels.skill_channel import SkillChannel
from backend.pipeline.sinks import SinkResult


def _session_cm():
    sess = AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=sess)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _ok_sink():
    sink = MagicMock()
    sink.write_batch = AsyncMock(return_value=SinkResult(records=[]))
    return sink


def test_opencli_and_skill_declare_session_affinity():
    assert OpenCLIChannel().capabilities.session_affinity is True
    assert SkillChannel().capabilities.session_affinity is True


@pytest.mark.asyncio
async def test_pipeline_binds_for_session_affinity_channel(db_session):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask
    from backend.pipeline.pipeline import run_pipeline

    source = DataSource(name="O", channel_type="opencli", channel_config={"site": "x.com"})
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    binding = MagicMock()
    binding.browser_endpoint = "ws://chrome:9222"
    captured = {}

    async def fake_collect(src, params):
        captured["params"] = params
        return ChannelResult.ok([{"title": "x"}])

    with (
        patch("backend.pipeline.collector.collect", new=fake_collect),
        patch(
            "backend.services.browser_service.get_binding_by_site",
            new=AsyncMock(return_value=binding),
        ),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        await run_pipeline(
            task.id, source, enable_ai=False, enable_notifications=False, sink=_ok_sink()
        )

    # The capability-gated pre-step resolved the chrome endpoint into collect params.
    assert captured["params"].get("chrome_endpoint") == "ws://chrome:9222"


@pytest.mark.asyncio
async def test_pipeline_skips_binding_for_non_affinity_channel(db_session):
    from backend.models.source import DataSource
    from backend.models.task import CollectionTask
    from backend.pipeline.pipeline import run_pipeline

    source = DataSource(
        name="R",
        channel_type="rss",
        channel_config={"feed_url": "https://x/f", "site": "x.com"},
    )
    db_session.add(source)
    await db_session.flush()
    task = CollectionTask(source_id=source.id, trigger_type="manual", parameters={})
    db_session.add(task)
    await db_session.flush()

    bind_mock = AsyncMock()
    captured = {}

    async def fake_collect(src, params):
        captured["params"] = params
        return ChannelResult.ok([{"title": "x"}])

    with (
        patch("backend.pipeline.collector.collect", new=fake_collect),
        patch("backend.services.browser_service.get_binding_by_site", new=bind_mock),
        patch("backend.database.AsyncSessionLocal", return_value=_session_cm()),
    ):
        await run_pipeline(
            task.id, source, enable_ai=False, enable_notifications=False, sink=_ok_sink()
        )

    # rss has session_affinity=False → no binding lookup, no chrome_endpoint injected.
    bind_mock.assert_not_called()
    assert "chrome_endpoint" not in captured["params"]
