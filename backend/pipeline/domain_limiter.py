"""Process-global per-domain concurrency cap.

Bounds how many collection runs touch the same host at once, so the fleet stays
polite to a site even when many sources target it. Applied at the task layer
(``runner.run_collection_pipeline``) so it covers every channel type, including
the browser-driven ones (opencli/skill) that don't go through ``run_channel``.

In-process only: it limits concurrency within ONE worker. Strict cross-worker
limiting (a Celery fleet) would need a Redis-backed limiter behind ``domain_slot``
— the same call site, a different implementation.
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse

# Channel configs name their target with different keys; first hit wins.
_URL_KEYS = ("feed_url", "base_url", "url", "site", "endpoint")

# (loop id, domain) -> semaphore. Keyed by loop so a semaphore is never reused
# across event loops (production runs one loop and shares correctly; tests get a
# fresh loop each and never touch a stale entry).
_semaphores: dict[tuple[int, str], asyncio.Semaphore] = {}


def _limit() -> int:
    try:
        return max(1, int(os.environ.get("PER_DOMAIN_CONCURRENCY", "3")))
    except ValueError:
        return 3


def domain_of(source: Any) -> str | None:
    """Best-effort host for a source's target, for per-domain limiting.

    Reads the channel_config's first URL-ish field and extracts the host (auth
    and port stripped, lowercased). Returns None when no host can be derived
    (e.g. the cli channel) — meaning 'do not limit'.
    """
    config = getattr(source, "channel_config", None) or {}
    for key in _URL_KEYS:
        val = config.get(key)
        if not isinstance(val, str) or not val:
            continue
        netloc = urlparse(val if "://" in val else f"//{val}").netloc
        host = netloc.split("@")[-1].split(":")[0].lower()
        if host:
            return host
    return None


def _semaphore(domain: str) -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    key = (id(loop), domain)
    sem = _semaphores.get(key)
    if sem is None:
        sem = asyncio.Semaphore(_limit())
        _semaphores[key] = sem
    return sem


@asynccontextmanager
async def domain_slot(source: Any):
    """Hold a per-domain slot for the duration of a run. No-op when the source
    has no derivable domain."""
    domain = domain_of(source)
    if domain is None:
        yield
        return
    async with _semaphore(domain):
        yield
