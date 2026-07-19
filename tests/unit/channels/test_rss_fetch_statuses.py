"""HTTP status classification tests for the RSS fetch contract."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from backend.channels.base import ChannelFetchError, FetchContext
from backend.channels.rss_channel import RSSChannel


@pytest.fixture(autouse=True)
def _fake_dns():
    """Keep placeholder feed hosts independent from live DNS."""
    with patch(
        "socket.getaddrinfo",
        return_value=[(None, None, None, "", ("93.184.216.34", 0))],
    ):
        yield


class _Http:
    """Minimal stand-in for the runner's rate-limited client."""

    def __init__(self, response):
        self._response = response

    async def get(self, _url, **_kwargs):
        return self._response


class _StatusErrorResp:
    """Response whose status check raises a real httpx status error."""

    def __init__(self, status_code):
        self.status_code = status_code
        self.headers = {}
        self._exception = httpx.HTTPStatusError(
            message=f"HTTP {status_code}",
            request=MagicMock(),
            response=MagicMock(status_code=status_code, text=f"error {status_code}"),
        )

    def raise_for_status(self):
        raise self._exception


def _fetch_context(status_code: int) -> FetchContext:
    return FetchContext(
        config={"feed_url": "https://x/feed"},
        params={},
        cursor=None,
        http=_Http(_StatusErrorResp(status_code)),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [502, 503, 504, 520, 522, 524])
async def test_fetch_gateway_status_classified_retryable(status):
    """Gateway responses carry the retryable status classification."""
    with pytest.raises(ChannelFetchError) as exc_info:
        await RSSChannel().fetch(_fetch_context(status))

    assert exc_info.value.error_type == "RetryableHTTPStatus"


@pytest.mark.asyncio
async def test_fetch_client_404_classified_permanent():
    """A genuine 4xx response stays permanent."""
    with pytest.raises(ChannelFetchError) as exc_info:
        await RSSChannel().fetch(_fetch_context(404))

    assert exc_info.value.error_type == "PermanentHTTPStatus"
