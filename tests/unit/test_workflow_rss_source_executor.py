from types import SimpleNamespace

import pytest

from backend.channels.base import ChannelResult


@pytest.mark.asyncio
async def test_rss_source_executor_reuses_channel_and_preserves_feed_metadata(monkeypatch):
    from backend.workflow.rss_source_executor import execute_workflow_rss_source

    async def fake_collect(self, config, parameters):
        assert config == {
            "feed_url": "https://feeds.example.test/finance.xml",
            "max_entries": 12,
            "timeout": 9,
        }
        assert parameters == {}
        return ChannelResult.ok(
            [
                {
                    "id": "finance-1",
                    "title": "Policy rate update",
                    "link": "https://feeds.example.test/items/finance-1",
                    "summary": "A central-bank policy update.",
                }
            ],
            feed_title="Finance Policy",
            total_entries=37,
        )

    monkeypatch.setattr(
        "backend.workflow.rss_source_executor.RSSChannel.collect",
        fake_collect,
    )

    result = await execute_workflow_rss_source(
        {
            "provider": "rss",
            "channelType": "rss",
            "adapterConfig": {"channel": "rss"},
            "params": {
                "feedUrl": "https://feeds.example.test/finance.xml",
                "maxEntries": 12,
                "timeout": 9,
            },
        },
        allowed_domains=["example.test"],
        max_items=50,
    )

    assert result is not None
    assert result.url == "https://feeds.example.test/finance.xml"
    assert result.feed_title == "Finance Policy"
    assert result.total_entries == 37
    assert result.items[0]["id"] == "finance-1"


@pytest.mark.asyncio
async def test_rss_source_executor_blocks_hosts_outside_allowed_domains():
    from backend.workflow.rss_source_executor import (
        WorkflowRSSSourceExecutionError,
        execute_workflow_rss_source,
    )

    with pytest.raises(WorkflowRSSSourceExecutionError) as exc_info:
        await execute_workflow_rss_source(
            {
                "provider": "rss",
                "channelType": "rss",
                "adapterConfig": {
                    "feed_url": "https://feeds.example.test/finance.xml",
                },
                "params": {},
            },
            allowed_domains=["federalreserve.gov"],
            max_items=20,
        )

    assert exc_info.value.code == "source_domain_not_allowed"
    assert exc_info.value.status == "blocked"


@pytest.mark.asyncio
async def test_rss_source_executor_retries_a_transient_fetch_failure(monkeypatch):
    from backend.workflow.rss_source_executor import execute_workflow_rss_source

    attempts = 0

    async def fake_collect(self, config, parameters):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return ChannelResult.fail(
                "Temporary connection failure",
                error_type="ConnectError",
            )
        return ChannelResult.ok(
            [{"id": "recovered-1", "title": "Recovered feed"}],
            feed_title="Recovered",
            total_entries=1,
        )

    async def no_wait(_delay):
        return None

    monkeypatch.setattr(
        "backend.workflow.rss_source_executor.RSSChannel.collect",
        fake_collect,
    )
    monkeypatch.setattr(
        "backend.workflow.rss_source_executor.asyncio.sleep",
        no_wait,
    )

    result = await execute_workflow_rss_source(
        {
            "provider": "rss",
            "channelType": "rss",
            "adapterConfig": {"feed_url": "https://feeds.example.test/finance.xml"},
            "params": {"maxAttempts": 2},
        },
        allowed_domains=["example.test"],
        max_items=20,
    )

    assert attempts == 2
    assert result is not None
    assert result.feed_title == "Recovered"


@pytest.mark.asyncio
async def test_rss_source_executor_resolves_generator_provider_without_leaking_token(
    monkeypatch,
):
    from backend.workflow.rss_source_executor import execute_workflow_rss_source

    provider = SimpleNamespace(
        id="feed-provider-1",
        enabled=True,
        provider_type="rsshub",
        base_url="http://127.0.0.1:1200",
        access_token="super-secret-key",
        config={
            "timeout_seconds": 7,
            "allow_private_network": True,
            "allowed_domains": ["127.0.0.1"],
        },
    )

    async def fake_get_provider(_session, provider_id):
        assert provider_id == provider.id
        return provider

    async def fake_collect(self, config, parameters):
        assert config["feed_url"].endswith("/rsshub/routes/en?key=super-secret-key")
        assert config["allow_private_network"] is True
        assert config["allowed_domains"] == ["127.0.0.1"]
        return ChannelResult.ok([{"id": "route-1", "title": "New route"}])

    monkeypatch.setattr(
        "backend.workflow.rss_source_executor.feed_provider_service.get_feed_provider",
        fake_get_provider,
    )
    monkeypatch.setattr(
        "backend.workflow.rss_source_executor.RSSChannel.collect",
        fake_collect,
    )

    result = await execute_workflow_rss_source(
        {
            "provider": "rss",
            "channelType": "rss",
            "params": {
                "feedUrl": "http://127.0.0.1:1200/rsshub/routes/en",
                "providerId": provider.id,
                "generatorType": "rsshub",
                "generatorSelection": {
                    "route": "/rsshub/routes/en",
                    "parameters": {},
                },
            },
        },
        allowed_domains=["127.0.0.1"],
        max_items=20,
        session=object(),
    )

    assert result is not None
    assert result.url == "http://127.0.0.1:1200/rsshub/routes/en"
    assert "super-secret-key" not in result.url


@pytest.mark.asyncio
async def test_rss_source_executor_classifies_generator_rate_limit(monkeypatch):
    from backend.workflow.rss_source_executor import (
        WorkflowRSSSourceExecutionError,
        execute_workflow_rss_source,
    )

    provider = SimpleNamespace(
        id="feed-provider-1",
        enabled=True,
        provider_type="rss_bridge",
        base_url="https://bridge.example.test",
        access_token=None,
        config={},
    )

    async def fake_get_provider(_session, _provider_id):
        return provider

    async def fake_collect(self, config, parameters):
        return ChannelResult.fail("HTTP 429 fetching feed", error_type="HTTPStatusError")

    async def no_wait(_delay):
        return None

    monkeypatch.setattr(
        "backend.workflow.rss_source_executor.feed_provider_service.get_feed_provider",
        fake_get_provider,
    )
    monkeypatch.setattr(
        "backend.workflow.rss_source_executor.RSSChannel.collect",
        fake_collect,
    )
    monkeypatch.setattr("backend.workflow.rss_source_executor.asyncio.sleep", no_wait)

    with pytest.raises(WorkflowRSSSourceExecutionError) as exc_info:
        await execute_workflow_rss_source(
            {
                "provider": "rss",
                "channelType": "rss",
                "params": {
                    "providerId": provider.id,
                    "generatorType": "rss_bridge",
                    "generatorSelection": {"bridge": "BearBlog", "parameters": {}},
                },
            },
            allowed_domains=["example.test"],
            max_items=20,
            session=object(),
        )

    assert exc_info.value.code == "upstream_rate_limited"
