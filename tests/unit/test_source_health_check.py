"""Tests for source connectivity health check."""

from unittest.mock import AsyncMock, patch

import pytest

from backend.channels.base import ChannelResult
from backend.models.source import DataSource


@pytest.mark.asyncio
async def test_test_source_connectivity_success():
    from backend.services.source_service import test_source_connectivity

    source = DataSource(
        name="Healthy Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed"},
    )

    mock_channel = AsyncMock()
    mock_channel.validate_config = AsyncMock(return_value=[])
    mock_channel.health_check = AsyncMock(return_value=True)

    with patch("backend.services.source_service.get_channel", return_value=mock_channel):
        ok, errors = await test_source_connectivity(source)

    assert ok is True
    assert errors == []


@pytest.mark.asyncio
async def test_test_source_connectivity_health_check_fails():
    from backend.services.source_service import test_source_connectivity

    source = DataSource(
        name="Unhealthy Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed"},
    )

    mock_channel = AsyncMock()
    mock_channel.validate_config = AsyncMock(return_value=[])
    mock_channel.health_check = AsyncMock(return_value=False)

    with patch("backend.services.source_service.get_channel", return_value=mock_channel):
        ok, errors = await test_source_connectivity(source)

    assert ok is False
    assert errors == []


@pytest.mark.asyncio
async def test_test_source_connectivity_health_check_exception():
    from backend.services.source_service import test_source_connectivity

    source = DataSource(
        name="Exception Source",
        channel_type="rss",
        channel_config={"feed_url": "https://example.com/feed"},
    )

    mock_channel = AsyncMock()
    mock_channel.validate_config = AsyncMock(return_value=[])
    mock_channel.health_check = AsyncMock(side_effect=Exception("connection refused"))

    with patch("backend.services.source_service.get_channel", return_value=mock_channel):
        ok, errors = await test_source_connectivity(source)

    assert ok is False
    assert "connection refused" in errors[0]


@pytest.mark.asyncio
async def test_rss_channel_health_check_performs_real_feed_probe(monkeypatch):
    from backend.channels.rss_channel import RSSChannel

    collect = AsyncMock(return_value=ChannelResult.ok([{"id": "one"}]))
    monkeypatch.setattr(RSSChannel, "collect", collect)

    connected = await RSSChannel().health_check(
        {"feed_url": "https://example.com/feed.xml", "max_entries": 50}
    )

    assert connected is True
    assert collect.await_args.args == (
        {"feed_url": "https://example.com/feed.xml", "max_entries": 1},
        {},
    )
