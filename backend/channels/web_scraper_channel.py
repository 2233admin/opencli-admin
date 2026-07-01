"""Web scraper channel using httpx + BeautifulSoup."""

import logging
from typing import Any

import httpx
from bs4 import BeautifulSoup

from backend.channels.base import (
    AbstractChannel,
    ChannelFetchError,
    ChannelResult,
    FetchContext,
    FetchResult,
)
from backend.channels.registry import register_channel

logger = logging.getLogger(__name__)


@register_channel
class WebScraperChannel(AbstractChannel):
    """Collect data by scraping web pages with CSS selectors."""

    channel_type = "web_scraper"

    async def collect(
        self, config: dict[str, Any], parameters: dict[str, Any]
    ) -> ChannelResult:
        """Thin wrapper around fetch() — see api_channel.collect() for the
        pattern this mirrors. A bare FetchContext (no ctx.http) reproduces
        this method's original one-shot-client behaviour exactly."""
        ctx = FetchContext(config=config, params=parameters)
        try:
            result = await self.fetch(ctx)
        except ChannelFetchError as exc:
            cause = exc.__cause__
            return ChannelResult.fail(str(exc), error_type=type(cause).__name__ if cause else None)
        return ChannelResult.ok(result.items, **result.metadata)

    async def fetch(self, ctx: FetchContext) -> FetchResult:
        """Thick-contract fetch: goes through the runner's rate-limited/
        retrying client (ctx.http) when present, falling back to a one-shot
        client otherwise. Headers can't be baked into the shared client's
        constructor (it's reused across sources), so the shared-client path
        sends them per-request instead — the owns-client path keeps the
        original constructor-time headers to match existing collect() mocks."""
        config = ctx.config
        url: str = config.get("url", "")
        selectors: dict[str, str] = config.get("selectors", {})
        headers: dict[str, str] = config.get("headers", {})
        timeout: int = config.get("timeout", 30)
        list_selector: str = config.get("list_selector", "")

        merged_headers = {
            "User-Agent": "Mozilla/5.0 (compatible; opencli-admin/1.0)",
            **headers,
        }

        if ctx.http is not None:
            response = await self._get(ctx.http, url, timeout, headers=merged_headers)
        else:
            async with httpx.AsyncClient(
                headers=merged_headers, follow_redirects=True, timeout=timeout
            ) as client:
                response = await self._get(client, url, timeout)

        soup = BeautifulSoup(response.text, "lxml")

        if list_selector:
            containers = soup.select(list_selector)
            items = [
                self._extract_fields(container, selectors) for container in containers
            ]
        else:
            items = [self._extract_fields(soup, selectors)]

        return FetchResult(items=items, metadata={"url": url, "status_code": response.status_code})

    @staticmethod
    async def _get(
        client: Any, url: str, timeout: int, headers: dict[str, str] | None = None
    ) -> httpx.Response:
        """One GET, wrapped into ChannelFetchError. ``headers`` is only passed
        per-request on the shared-client path (see fetch()'s docstring)."""
        try:
            response = (
                await client.get(url, headers=headers, timeout=timeout)
                if headers is not None
                else await client.get(url)
            )
            response.raise_for_status()
            return response
        except httpx.TimeoutException as exc:
            raise ChannelFetchError(f"Request to {url} timed out after {timeout}s") from exc
        except httpx.HTTPStatusError as exc:
            raise ChannelFetchError(f"HTTP {exc.response.status_code} from {url}") from exc
        except Exception as exc:
            raise ChannelFetchError(f"Request failed: {exc}") from exc

    def _extract_fields(self, node: Any, selectors: dict[str, str]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for field_name, selector in selectors.items():
            el = node.select_one(selector)
            if el is not None:
                result[field_name] = el.get_text(strip=True)
        return result

    async def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        if not config.get("url"):
            errors.append("'url' is required for web_scraper channel")
        if not config.get("selectors"):
            errors.append("'selectors' is required for web_scraper channel")
        return errors

    async def health_check(
        self, config: dict[str, Any] | None = None, source_id: str | None = None
    ) -> bool:
        """Two-tier: the parser backend (lxml — this channel's "driver") must
        be usable at all, then, when a source's config is available, the
        target URL must actually be reachable. Short timeout: liveness, not
        a full scrape."""
        try:
            BeautifulSoup("<html></html>", "lxml")
        except Exception as exc:
            logger.warning("web_scraper health_check: lxml parser unavailable: %s", exc)
            return False

        if config is None:
            return True  # no source context to probe (e.g. called standalone)
        url: str = config.get("url", "")
        if not url:
            return False

        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=5) as client:
                response = await client.head(url)
                if response.status_code in (404, 405):
                    response = await client.get(url)
                response.raise_for_status()
            return True
        except Exception as exc:
            logger.warning("web_scraper health_check: %s unreachable: %s", url, exc)
            return False
