"""run_channel — the thick channel runner (Phase 1).

The runner owns every cross-cutting concern so a channel implements only the
source-specific ``fetch()``: it loads the cursor, builds a rate-limited + retrying
HTTP client, drives pagination via ``has_more`` / ``next_cursor``, and persists
the cursor after each page (so a crash mid-pagination resumes, not restarts).

This is the mechanism behind the north star: adding a real source is ~100 lines of
fetch + parse, because token refresh, rate limiting, retry/backoff, pagination,
and cursor state all live here, written once, reused by every channel.

Phase 1 status: additive and NOT yet wired into the collect stage of the live
pipeline (``backend/pipeline/collector.py`` still calls ``channel.collect``). It
runs against an in-memory cursor store and accepts an injected client/channel for
tests. The DB-backed cursor store, the migration, the RSS etag override, and the
switch of the collect stage from ``collect()`` to ``run_channel()`` are the next
slice.
"""

import logging
from typing import Any

import httpx

from backend.channels.base import AbstractChannel, AuthContext, FetchContext
from backend.channels.registry import get_channel
from backend.pipeline.cursor_store import CursorStore, InMemoryCursorStore
from backend.pipeline.http_client import RateLimitedClient, TokenBucket, parse_rate

log = logging.getLogger(__name__)

#: Hard guard on pagination so a misbehaving source can't loop forever.
MAX_PAGES = 50


async def run_channel(
    source: Any,
    params: dict[str, Any],
    *,
    cursor_store: CursorStore | None = None,
    channel: AbstractChannel | None = None,
    http: Any = None,
) -> list[dict[str, Any]]:
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
    auth = AuthContext(kind=cap.auth_kind)  # Phase 2 resolves real credentials here

    owns_http = http is None
    client = http or RateLimitedClient(
        httpx.AsyncClient(timeout=30),
        TokenBucket(parse_rate(cap.default_rate)),
        log=log,
    )

    items: list[dict[str, Any]] = []
    pages = 0
    try:
        while True:
            ctx = FetchContext(
                config=source.channel_config,
                params=params,
                cursor=cursor,
                auth=auth,
                http=client,
                log=log,
            )
            result = await chan.fetch(ctx)
            items.extend(result.items)

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

    return items
