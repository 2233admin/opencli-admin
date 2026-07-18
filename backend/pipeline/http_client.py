"""Runner HTTP infrastructure (Phase 1).

A shared async client with a token-bucket rate limiter and retry/backoff baked
in, so a channel just does ``await ctx.http.get(...)`` and gets 429 handling,
Retry-After, and exponential backoff + jitter for free. This is exactly the kind
of cross-cutting concern the runner owns ONCE for every channel — never
reimplemented per source.
"""

import asyncio
import logging
import random
import time
from typing import Any

import httpx

#: HTTP statuses the client retries (rate limit + transient server errors).
#: AUDIT C13: 504/520/522/524 (gateway timeout + Cloudflare's own gateway-error
#: codes) belong alongside 502/503 — a slow/misbehaving upstream through a
#: proxy surfaces as any of these, not just 502/503, and none of them are
#: reasons to give up permanently.
RETRY_STATUS = frozenset({429, 500, 502, 503, 504, 520, 522, 524})


def parse_rate(rate: str) -> float:
    """Parse a rate string like ``"60/min"`` into tokens per second.

    Supports ``/sec`` ``/second`` ``/min`` ``/minute`` ``/hour``. Falls back to
    1.0/s on anything unparseable so a bad config never crashes the runner.
    """
    try:
        count_str, _, unit = str(rate).partition("/")
        count = float(count_str)
    except (ValueError, AttributeError):
        return 1.0
    per = {
        "sec": 1.0, "second": 1.0,
        "min": 60.0, "minute": 60.0,
        "hour": 3600.0,
    }.get(unit.strip().lower(), 60.0)
    return count / per if per else count


class TokenBucket:
    """Async token bucket. ``rate`` is tokens/second; ``capacity`` is the burst
    size (defaults to ~one second of rate). ``acquire`` blocks only when the
    bucket is empty, so steady traffic under the rate never waits."""

    def __init__(self, rate: float, capacity: float | None = None) -> None:
        self.rate = max(rate, 1e-6)
        self.capacity = capacity if capacity is not None else max(1.0, rate)
        self._tokens = self.capacity
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self, tokens: float = 1.0) -> None:
        async with self._lock:
            now = time.monotonic()
            self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
            self._updated = now
            if self._tokens < tokens:
                await asyncio.sleep((tokens - self._tokens) / self.rate)
                self._tokens = 0.0
                self._updated = time.monotonic()
            else:
                self._tokens -= tokens


class RateLimitedClient:
    """Wraps an ``httpx.AsyncClient``: every request first waits on the token
    bucket, then retries on 429/5xx with exponential backoff + jitter, honoring a
    numeric ``Retry-After``. A channel sees a plain get/post; the cross-cutting
    policy lives here, once."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        bucket: TokenBucket,
        *,
        max_retries: int = 5,
        log: logging.Logger | None = None,
    ) -> None:
        self._client = client
        self._bucket = bucket
        self._max = max_retries
        self._log = log

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        attempt = 0
        while True:
            await self._bucket.acquire()
            resp = await self._client.request(method, url, **kwargs)
            if resp.status_code not in RETRY_STATUS or attempt >= self._max:
                return resp
            delay = self._retry_after(resp)
            if delay is None:
                delay = min(60.0, 2.0 ** attempt) + random.uniform(0.0, 0.5)
            attempt += 1
            if self._log:
                self._log.warning(
                    "retry %s %s after %.1fs (status %s, attempt %s/%s)",
                    method, url, delay, resp.status_code, attempt, self._max,
                )
            await asyncio.sleep(delay)

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("POST", url, **kwargs)

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _retry_after(resp: httpx.Response) -> float | None:
        value = resp.headers.get("retry-after")
        if not value:
            return None
        try:
            return float(value)  # delta-seconds form
        except ValueError:
            return None  # HTTP-date form: ignore, fall back to exponential backoff
