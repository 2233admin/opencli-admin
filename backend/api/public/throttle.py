"""IP-based in-memory rate limiter for backend/api/public/* (PR-E, GOAL-5.md).

架构决策 #1: "限流用 IP-based 轻量中间件(内存 token bucket,不引入 Redis 依赖)".
This is a classic single-process in-memory token bucket, one bucket per
``request.client.host``. No Redis, no cross-process coordination — fine for
a single admin-backend process; if opencli-admin is ever scaled to multiple
worker processes behind this router, the limiter would need to move to a
shared store, but that is out of scope for this PR.

Default: 60 requests/minute/IP (1 token/sec refill, burst capacity 60). This
is a conservative placeholder per GOAL-5.md's 停止条件 ("限流阈值...没有明显
不合理不用为这个停"), not a tuned production value.

``TokenBucketLimiter`` itself is deliberately pure and clock-injectable (see
``allow()``'s ``now`` parameter) so it can be unit-tested with a fake clock
without real ``time.sleep`` — see tests/unit/test_throttle.py.
"""

import math
import threading
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request

# Conservative default: 60 requests/minute/IP == 1 token/sec steady-state,
# with a burst capacity equal to the full per-minute allowance.
DEFAULT_CAPACITY = 60
DEFAULT_REFILL_PER_SECOND = DEFAULT_CAPACITY / 60.0


@dataclass
class _Bucket:
    tokens: float
    last_refill: float


class TokenBucketLimiter:
    """Pure, unit-testable in-memory token-bucket rate limiter.

    Keyed by an arbitrary string (an IP address in production, but the class
    itself has no notion of "request" or "IP" — see ``rate_limit_dependency``
    below for the FastAPI adapter). Every call takes an explicit ``now``
    (defaulting to the real monotonic clock) instead of reading wall-clock
    time implicitly, so tests can drive it deterministically with a fake
    clock instead of sleeping in real time.
    """

    def __init__(self, capacity: int = DEFAULT_CAPACITY, refill_rate: float = DEFAULT_REFILL_PER_SECOND) -> None:
        """
        Args:
            capacity: max tokens a bucket can hold == max instantaneous burst.
            refill_rate: tokens added per second == steady-state requests/sec.
        """
        self.capacity = capacity
        self.refill_rate = refill_rate
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> tuple[bool, float]:
        """Attempt to consume one token for ``key``.

        Returns ``(allowed, retry_after_seconds)``. ``retry_after_seconds``
        is ``0.0`` when allowed, otherwise the number of seconds until at
        least one token will next be available.
        """
        if now is None:
            now = time.monotonic()

        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = _Bucket(tokens=float(self.capacity), last_refill=now)
                self._buckets[key] = bucket

            elapsed = max(0.0, now - bucket.last_refill)
            bucket.tokens = min(self.capacity, bucket.tokens + elapsed * self.refill_rate)
            bucket.last_refill = now

            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return True, 0.0

            deficit = 1.0 - bucket.tokens
            retry_after = deficit / self.refill_rate if self.refill_rate > 0 else float("inf")
            return False, retry_after

    def reset(self) -> None:
        """Clear all per-key state. Test-only escape hatch — production
        callers never need this; a key's bucket otherwise lives for the
        process lifetime."""
        with self._lock:
            self._buckets.clear()


# Module-level singleton shared by every route on backend.api.public.router's
# public_router (see that module — the dependency is attached once, at the
# router level, not per-endpoint). Tests reconfigure/reset this instance
# directly (see tests/integration/test_public_api.py) rather than
# constructing a second limiter, since the dependency below is bound to this
# specific object.
limiter = TokenBucketLimiter()


async def rate_limit_dependency(request: Request) -> None:
    """FastAPI dependency: 429 + Retry-After once an IP exceeds the limiter.

    Keyed by ``request.client.host``. Falls back to a constant key when the
    ASGI server doesn't report a client (e.g. some test transports) rather
    than raising — worst case that degrades to one shared bucket instead of
    per-IP isolation, which is acceptable for this in-memory, best-effort
    limiter.
    """
    client_host = request.client.host if request.client else "unknown"
    allowed, retry_after = limiter.allow(client_host)
    if not allowed:
        # retry_after is float("inf") only in the degenerate case of a
        # limiter configured with refill_rate <= 0 (never refills again —
        # not how the production default is configured, but guard against
        # math.ceil(inf) raising OverflowError regardless).
        retry_after_seconds = 3600 if math.isinf(retry_after) else max(1, math.ceil(retry_after))
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded ({limiter.capacity} req/min per IP). Try again later.",
            headers={"Retry-After": str(retry_after_seconds)},
        )
