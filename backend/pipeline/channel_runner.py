"""run_channel — the thick channel runner (Phase 1).

The runner owns every cross-cutting concern so a channel implements only the
source-specific ``fetch()``: it loads the cursor, builds a rate-limited + retrying
HTTP client, drives pagination via ``has_more`` / ``next_cursor``, and persists
the cursor after each page (so a crash mid-pagination resumes, not restarts).

This is the mechanism behind the north star: adding a real source is ~100 lines of
fetch + parse, because token refresh, rate limiting, retry/backoff, pagination,
and cursor state all live here, written once, reused by every channel.

Every collector.collect() call is now routed through here (not just incremental
channels): a channel that hasn't migrated fetch() gets the default adapter that
bridges to collect(), so it degrades to one page / no cursor / no rate limiting —
identical to calling collect() directly. Channels migrate by overriding fetch()
and reading ctx.cursor / ctx.http / ctx.auth / ctx.source_id.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from backend.channels.base import AbstractChannel, FetchContext
from backend.channels.registry import get_channel
from backend.pipeline.cursor_store import CursorStore, InMemoryCursorStore
from backend.pipeline.http_client import RateLimitedClient, TokenBucket, parse_rate

log = logging.getLogger(__name__)

#: Hard guard on pagination so a misbehaving source can't loop forever.
MAX_PAGES = 50


@dataclass
class RunResult:
    """Everything a run_channel() call produced: the items plus the last page's
    non-item metadata (e.g. opencli's node_url, skill's awaiting_confirm) so
    collector.collect() can forward it onto ChannelResult.metadata unchanged."""

    items: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


async def run_channel(
    source: Any,
    params: dict[str, Any],
    *,
    cursor_store: CursorStore | None = None,
    channel: AbstractChannel | None = None,
    http: Any = None,
) -> RunResult:
    """Collect all items for ``source`` through its channel's ``fetch()``, applying
    the runner's cross-cutting concerns.

    ``source`` needs ``id``, ``channel_type``, ``channel_config``. ``channel`` and
    ``http`` are injectable for tests; in production they default to the registry
    channel and a rate-limited client built from the channel's declared rate.
    """
    chan = channel or get_channel(source.channel_type)
    cap = chan.capabilities
    store = cursor_store or InMemoryCursorStore()

    cursor = await store.load(source.id) if cap.incremental else None
    # Phase 2: resolve real (decrypted) credentials into the AuthContext the channel
    # sees. auth_kind="none" short-circuits without a DB hit.
    from backend.auth.manager import AuthManager

    auth = await AuthManager().resolve_context(source.id, cap.auth_kind)

    owns_http = http is None
    client = http or RateLimitedClient(
        httpx.AsyncClient(timeout=30),
        TokenBucket(parse_rate(cap.default_rate)),
        log=log,
    )

    items: list[dict[str, Any]] = []
    metadata: dict[str, Any] = {}
    pages = 0
    try:
        while True:
            ctx = FetchContext(
                config=source.channel_config,
                params=params,
                cursor=cursor,
                source_id=source.id,
                auth=auth,
                http=client,
                log=log,
            )
            result = await chan.fetch(ctx)
            items.extend(result.items)
            metadata.update(result.metadata)

            # Persist the cursor after each page: a crash mid-pagination resumes
            # from here instead of re-fetching everything.
            if cap.incremental and result.next_cursor is not None:
                cursor = result.next_cursor
                await store.save(source.id, cursor)

            pages += 1
            if not (cap.paginated and result.has_more):
                break
            if pages >= MAX_PAGES:
                log.warning("run_channel hit MAX_PAGES=%s for source %s", MAX_PAGES, source.id)
                break
    finally:
        if owns_http and isinstance(client, RateLimitedClient):
            await client.aclose()

    return RunResult(items=items, metadata=metadata)
