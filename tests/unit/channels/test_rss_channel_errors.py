"""Request and parse failure tests for the RSS channel."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from backend.channels.rss_channel import RSSChannel


@pytest.fixture
def channel():
    return RSSChannel()


class _HttpClient:
    def __init__(self, *, response=None, error=None):
        self.response = response
        self.error = error

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, *_args, **_kwargs):
        if self.error is not None:
            raise self.error
        return self.response


@pytest.mark.asyncio
async def test_collect_timeout_returns_fail(channel):
    """TimeoutException produces a failed ChannelResult."""
    context = _HttpClient(error=httpx.TimeoutException("timeout"))
    with patch("httpx.AsyncClient", return_value=context):
        result = await channel.collect({"feed_url": "https://example.com/rss"}, {})

    assert result.success is False
    assert "timed out" in result.error.lower()


@pytest.mark.asyncio
async def test_collect_http_404_returns_fail(channel):
    """HTTP 404 produces a failed ChannelResult."""
    response = MagicMock(status_code=404)
    response.raise_for_status = MagicMock(
        side_effect=httpx.HTTPStatusError(
            message="Not Found",
            request=MagicMock(),
            response=MagicMock(status_code=404),
        )
    )
    with patch(
        "httpx.AsyncClient",
        return_value=_HttpClient(response=response),
    ):
        result = await channel.collect({"feed_url": "https://example.com/rss"}, {})

    assert result.success is False
    assert "404" in result.error


@pytest.mark.asyncio
async def test_collect_generic_exception_returns_fail(channel):
    """Other request exceptions produce a failed ChannelResult."""
    context = _HttpClient(error=ConnectionError("network down"))
    with patch("httpx.AsyncClient", return_value=context):
        result = await channel.collect({"feed_url": "https://example.com/rss"}, {})

    assert result.success is False
    assert "Failed to fetch" in result.error


@pytest.mark.asyncio
async def test_collect_bozo_feed_no_entries_returns_fail(channel):
    """A broken feed with no entries returns a failed ChannelResult."""
    response = MagicMock(text="NOT VALID XML AT ALL !!!")
    response.raise_for_status = MagicMock()
    parsed = MagicMock(bozo=True, entries=[])

    with (
        patch(
            "httpx.AsyncClient",
            return_value=_HttpClient(response=response),
        ),
        patch("feedparser.parse", return_value=parsed),
    ):
        result = await channel.collect({"feed_url": "https://example.com/rss"}, {})

    assert result.success is False
    assert result.error is not None
