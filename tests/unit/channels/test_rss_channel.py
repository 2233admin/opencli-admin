"""Core unit tests for the RSS channel."""

import threading
from unittest.mock import MagicMock, patch

import pytest

from backend.channels.rss_channel import RSSChannel

VALID_RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Item 1</title>
      <link>https://ex.com/1</link>
      <description>Desc 1</description>
    </item>
    <item>
      <title>Item 2</title>
      <link>https://ex.com/2</link>
    </item>
  </channel>
</rss>"""


@pytest.fixture
def channel():
    return RSSChannel()


class _HttpClient:
    def __init__(self, text: str):
        self.response = MagicMock(text=text)
        self.response.raise_for_status = MagicMock()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, *_args, **_kwargs):
        return self.response


@pytest.mark.asyncio
async def test_channel_type(channel):
    assert channel.channel_type == "rss"


@pytest.mark.asyncio
async def test_validate_config_missing_feed_url(channel):
    errors = await channel.validate_config({})
    assert any("feed_url" in error for error in errors)


@pytest.mark.asyncio
async def test_validate_config_valid(channel):
    errors = await channel.validate_config({"feed_url": "https://example.com/rss"})
    assert errors == []


@pytest.mark.asyncio
async def test_collect_success_returns_items(channel):
    """Successful RSS fetch returns parsed items."""
    with patch("httpx.AsyncClient", return_value=_HttpClient(VALID_RSS_XML)):
        result = await channel.collect({"feed_url": "https://example.com/rss"}, {})

    assert result.success is True
    assert len(result.items) == 2
    assert result.items[0]["title"] == "Item 1"
    assert result.items[0]["link"] == "https://ex.com/1"


@pytest.mark.asyncio
async def test_collect_max_entries_limits_results(channel):
    """max_entries trims parsed entries."""
    with patch("httpx.AsyncClient", return_value=_HttpClient(VALID_RSS_XML)):
        result = await channel.collect(
            {"feed_url": "https://example.com/rss", "max_entries": 1},
            {},
        )

    assert result.success is True
    assert len(result.items) == 1


@pytest.mark.asyncio
async def test_collect_metadata_includes_feed_title(channel):
    """ChannelResult metadata contains the feed title."""
    with patch("httpx.AsyncClient", return_value=_HttpClient(VALID_RSS_XML)):
        result = await channel.collect({"feed_url": "https://example.com/rss"}, {})

    assert result.success is True
    assert result.metadata.get("feed_title") == "Test Feed"


@pytest.mark.asyncio
async def test_collect_parses_feed_off_event_loop_thread(channel):
    """feedparser.parse runs via asyncio.to_thread instead of on the event loop."""
    import feedparser

    seen_threads: list[int] = []
    real_parse = feedparser.parse

    def spy_parse(content):
        seen_threads.append(threading.get_ident())
        return real_parse(content)

    with (
        patch("httpx.AsyncClient", return_value=_HttpClient(VALID_RSS_XML)),
        patch("feedparser.parse", side_effect=spy_parse),
    ):
        result = await channel.collect({"feed_url": "https://example.com/rss"}, {})

    assert result.success is True
    assert len(seen_threads) == 1
    assert seen_threads[0] != threading.get_ident()
