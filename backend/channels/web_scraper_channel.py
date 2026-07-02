"""Web scraper channel using httpx + BeautifulSoup."""

import logging
from typing import Any
from urllib.parse import urlparse

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
from backend.security.url_guard import (
    SSRFValidationError,
    avalidate_public_url,
    guarded_async_client,
)

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

        # follow_redirects=False: a validated URL can still 30x-redirect to a
        # private/loopback/fleet address, bypassing the check above. The
        # ctx.http path only gets plain call-time validation (the runner-
        # shared client's connection pinning, if any, is out of this file's
        # boundary); the one-shot path below is pinned via guarded_async_client
        # (DNS-rebinding TOCTOU closure — AUDIT B3 follow-up).
        if ctx.http is not None:
            try:
                url = await avalidate_public_url(url)
            except SSRFValidationError as exc:
                raise ChannelFetchError(
                    f"web_scraper URL rejected: {exc}", error_type="SSRFValidationError"
                ) from exc

            merged_headers = {
                "User-Agent": "Mozilla/5.0 (compatible; opencli-admin/1.0)",
                **headers,
            }
            if config.get("auth", {}).get("type") == "cookie":
                cookie_header = await self._resolve_cookie_header(url)
                if cookie_header:
                    merged_headers["Cookie"] = cookie_header

            response = await self._get(ctx.http, url, timeout, headers=merged_headers)
        else:
            # Validate first (need the normalized url for cookie-domain
            # resolution and to build merged_headers before the client is
            # constructed — existing tests assert headers is a constructor
            # kwarg, matching the pre-pinning httpx.AsyncClient(headers=...)
            # call shape) — then hand the already-validated url straight to
            # guarded_async_client, which re-validates+pins in one step.
            try:
                url = await avalidate_public_url(url)
            except SSRFValidationError as exc:
                raise ChannelFetchError(
                    f"web_scraper URL rejected: {exc}", error_type="SSRFValidationError"
                ) from exc

            merged_headers = {
                "User-Agent": "Mozilla/5.0 (compatible; opencli-admin/1.0)",
                **headers,
            }
            if config.get("auth", {}).get("type") == "cookie":
                cookie_header = await self._resolve_cookie_header(url)
                if cookie_header:
                    merged_headers["Cookie"] = cookie_header

            try:
                client, url = await guarded_async_client(
                    url, headers=merged_headers, follow_redirects=False, timeout=timeout
                )
            except SSRFValidationError as exc:
                raise ChannelFetchError(
                    f"web_scraper URL rejected: {exc}", error_type="SSRFValidationError"
                ) from exc

            async with client as opened_client:
                response = await self._get(opened_client, url, timeout)

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
    async def _resolve_cookie_header(url: str) -> str | None:
        """auth.type == "cookie": borrow a real login session synced from
        CookieCloud (backend.auth.manager.AuthManager.resolve_cookies), keyed
        by url's domain. None (no header) when nothing is synced yet."""
        from backend.auth.manager import AuthManager

        domain = urlparse(url).hostname or ""
        if not domain:
            return None
        cookies = await AuthManager().resolve_cookies(domain)
        if not cookies:
            return None
        return "; ".join(f"{c['name']}={c['value']}" for c in cookies)

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
            from backend.pipeline.error_taxonomy import is_retryable_http_status

            status = exc.response.status_code
            error_type = (
                "RetryableHTTPStatus" if is_retryable_http_status(status) else "PermanentHTTPStatus"
            )
            raise ChannelFetchError(f"HTTP {status} from {url}", error_type=error_type) from exc
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

        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; opencli-admin/1.0)",
            **config.get("headers", {}),
        }

        try:
            # guarded_async_client pins the connection to the validated IP(s)
            # — DNS-rebinding TOCTOU closure (AUDIT B3 follow-up). Same
            # follow_redirects=False SSRF-via-redirect reasoning as fetch().
            client, url = await guarded_async_client(url, follow_redirects=False, timeout=5)
        except SSRFValidationError as exc:
            logger.warning("web_scraper health_check: URL rejected: %s", exc)
            return False

        if config.get("auth", {}).get("type") == "cookie":
            cookie_header = await self._resolve_cookie_header(url)
            if cookie_header:
                headers["Cookie"] = cookie_header

        try:
            async with client as opened_client:
                response = await opened_client.head(url, headers=headers)
                if response.status_code in (404, 405):
                    response = await opened_client.get(url, headers=headers)
                response.raise_for_status()
            return True
        except Exception as exc:
            logger.warning("web_scraper health_check: %s unreachable: %s", url, exc)
            return False
