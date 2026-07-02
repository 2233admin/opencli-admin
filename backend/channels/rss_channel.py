"""RSS channel using feedparser."""

from typing import Any

import feedparser
import httpx

from backend.channels.base import (
    AbstractChannel,
    Capabilities,
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


@register_channel
class RSSChannel(AbstractChannel):
    """Collect entries from RSS/Atom feeds."""

    channel_type = "rss"
    capabilities = Capabilities(
        incremental=True, paginated=False, auth_kind="none", default_rate="60/min"
    )

    async def collect(
        self, config: dict[str, Any], parameters: dict[str, Any]
    ) -> ChannelResult:
        feed_url: str = config.get("feed_url", "")
        max_entries: int = config.get("max_entries", 50)
        timeout: int = config.get("timeout", 30)

        try:
            # guarded_async_client validates feed_url AND pins the connection
            # to the IP(s) that validation resolved (DNS-rebinding TOCTOU
            # closure — AUDIT B3 follow-up; see backend.security.url_guard's
            # module docstring). TLS/SNI/cert verification are unaffected.
            client, feed_url = await guarded_async_client(
                feed_url, timeout=timeout, follow_redirects=False
            )
        except SSRFValidationError as exc:
            return ChannelResult.fail(
                f"RSS feed URL rejected: {exc}", error_type="SSRFValidationError"
            )

        try:
            # follow_redirects=False: a validated public URL could otherwise
            # 30x-redirect to a private/loopback/fleet address, bypassing the
            # check above (SSRF via redirect). RSS feeds don't legitimately
            # need cross-host redirect chains for this use case.
            async with client as opened_client:
                response = await opened_client.get(
                    feed_url,
                    headers={"User-Agent": "opencli-admin/1.0 (+https://github.com)"},
                )
                response.raise_for_status()
                content = response.text
        except httpx.TimeoutException as exc:
            return ChannelResult.fail(
                f"RSS feed request timed out: {feed_url}", error_type=type(exc).__name__
            )
        except httpx.HTTPStatusError as exc:
            return ChannelResult.fail(
                f"HTTP {exc.response.status_code} fetching feed", error_type=type(exc).__name__
            )
        except Exception as exc:
            return ChannelResult.fail(
                f"Failed to fetch RSS feed: {exc}", error_type=type(exc).__name__
            )

        parsed = feedparser.parse(content)
        if parsed.bozo and not parsed.entries:
            return ChannelResult.fail(
                f"Failed to parse feed: {getattr(parsed, 'bozo_exception', 'unknown error')}"
            )

        entries = parsed.entries[:max_entries]
        items = [self._entry_to_dict(entry) for entry in entries]

        return ChannelResult.ok(
            items,
            feed_title=parsed.feed.get("title", ""),
            total_entries=len(parsed.entries),
        )

    def _entry_to_dict(self, entry: Any) -> dict[str, Any]:
        return {
            "title": entry.get("title", ""),
            "link": entry.get("link", ""),
            "summary": entry.get("summary", ""),
            "author": entry.get("author", ""),
            "published": entry.get("published", ""),
            "tags": [t.get("term", "") for t in entry.get("tags", [])],
            "id": entry.get("id", entry.get("link", "")),
        }

    async def fetch(self, ctx: FetchContext) -> FetchResult:
        """Incremental RSS fetch: a conditional GET keyed on the cursor's etag /
        last_modified. A 304 means nothing new — return no items and keep the
        cursor unchanged. A 200 reparses and advances the cursor to the response's
        ETag / Last-Modified. RSS isn't paginated, so ``has_more`` is always False.

        Uses the runner-provided rate-limited client (``ctx.http``) when present,
        falling back to a one-shot client so ``fetch()`` also works standalone.
        """
        config = ctx.config
        feed_url: str = config.get("feed_url", "")
        max_entries: int = config.get("max_entries", 50)
        timeout: int = config.get("timeout", 30)
        cursor = ctx.cursor or {}

        headers = {"User-Agent": "opencli-admin/1.0 (+https://github.com)"}
        if cursor.get("etag"):
            headers["If-None-Match"] = cursor["etag"]
        if cursor.get("last_modified"):
            headers["If-Modified-Since"] = cursor["last_modified"]

        # follow_redirects=False on the one-shot path — see collect()'s comment;
        # ctx.http is the runner-shared client (its redirect policy/connection
        # pinning is the runner's concern, out of this file's boundary — it
        # only gets the plain call-time validate_public_url here).
        if ctx.http is not None:
            try:
                feed_url = await avalidate_public_url(feed_url)
            except SSRFValidationError as exc:
                raise ChannelFetchError(
                    f"RSS feed URL rejected: {exc}", error_type="SSRFValidationError"
                ) from exc
            response = await ctx.http.get(feed_url, headers=headers, timeout=timeout)
        else:
            try:
                # guarded_async_client pins the connection to the validated
                # IP(s) — DNS-rebinding TOCTOU closure (AUDIT B3 follow-up).
                client, feed_url = await guarded_async_client(
                    feed_url, timeout=timeout, follow_redirects=False
                )
            except SSRFValidationError as exc:
                raise ChannelFetchError(
                    f"RSS feed URL rejected: {exc}", error_type="SSRFValidationError"
                ) from exc
            async with client as opened_client:
                response = await opened_client.get(feed_url, headers=headers)

        if response.status_code == 304:
            # Not Modified — no new entries; preserve the cursor as-is.
            return FetchResult(items=[], next_cursor=(cursor or None), has_more=False)
        response.raise_for_status()

        parsed = feedparser.parse(response.text)
        if parsed.bozo and not parsed.entries:
            raise ChannelFetchError(
                f"Failed to parse feed: {getattr(parsed, 'bozo_exception', 'unknown error')}"
            )
        items = [self._entry_to_dict(entry) for entry in parsed.entries[:max_entries]]

        next_cursor = dict(cursor)
        if etag := response.headers.get("ETag"):
            next_cursor["etag"] = etag
        if last_modified := response.headers.get("Last-Modified"):
            next_cursor["last_modified"] = last_modified

        return FetchResult(items=items, next_cursor=(next_cursor or None), has_more=False)

    def identity(self, item: dict[str, Any]) -> str | None:
        # RSS entry id (falls back to link in _entry_to_dict): a stable dedup key,
        # so editing two chars of a title is the same item, not a new one.
        return item.get("id") or None

    async def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        if not config.get("feed_url"):
            errors.append("'feed_url' is required for rss channel")
        return errors
