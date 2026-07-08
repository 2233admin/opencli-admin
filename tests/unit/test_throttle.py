"""Unit tests for backend/api/public/throttle.py's TokenBucketLimiter.

Drives the limiter with an explicit fake clock (no real time.sleep) so the
core rate-limiting logic is exercised deterministically and quickly.
"""

import math

from backend.api.public.throttle import TokenBucketLimiter


def test_allows_requests_up_to_capacity():
    limiter = TokenBucketLimiter(capacity=3, refill_rate=1.0)
    now = 1000.0

    for _ in range(3):
        allowed, retry_after = limiter.allow("1.2.3.4", now=now)
        assert allowed is True
        assert retry_after == 0.0


def test_blocks_once_capacity_is_exhausted():
    limiter = TokenBucketLimiter(capacity=3, refill_rate=1.0)
    now = 1000.0
    for _ in range(3):
        limiter.allow("1.2.3.4", now=now)

    allowed, retry_after = limiter.allow("1.2.3.4", now=now)

    assert allowed is False
    assert retry_after > 0.0


def test_retry_after_reflects_refill_rate():
    limiter = TokenBucketLimiter(capacity=1, refill_rate=0.5)  # 1 token per 2s
    now = 0.0
    allowed, _ = limiter.allow("ip", now=now)
    assert allowed is True

    # Immediately exhausted: next token is 2s away.
    allowed, retry_after = limiter.allow("ip", now=now)
    assert allowed is False
    assert math.isclose(retry_after, 2.0, rel_tol=1e-6)


def test_refills_over_time_with_fake_clock():
    limiter = TokenBucketLimiter(capacity=2, refill_rate=1.0)  # 1 token/sec
    t0 = 500.0
    assert limiter.allow("ip", now=t0)[0] is True
    assert limiter.allow("ip", now=t0)[0] is True
    # Bucket empty at t0.
    assert limiter.allow("ip", now=t0)[0] is False

    # 1 second later exactly one token has regenerated.
    allowed, retry_after = limiter.allow("ip", now=t0 + 1.0)
    assert allowed is True
    assert retry_after == 0.0

    # Immediately exhausted again.
    assert limiter.allow("ip", now=t0 + 1.0)[0] is False


def test_never_refills_beyond_capacity():
    limiter = TokenBucketLimiter(capacity=2, refill_rate=1.0)
    t0 = 0.0
    limiter.allow("ip", now=t0)
    limiter.allow("ip", now=t0)

    # A huge elapsed time should still cap tokens at `capacity`, not overflow.
    far_future = t0 + 10_000
    allowed1, _ = limiter.allow("ip", now=far_future)
    allowed2, _ = limiter.allow("ip", now=far_future)
    allowed3, _ = limiter.allow("ip", now=far_future)

    assert allowed1 is True
    assert allowed2 is True
    assert allowed3 is False  # capacity is 2, not unbounded


def test_buckets_are_independent_per_key():
    limiter = TokenBucketLimiter(capacity=1, refill_rate=0.0)
    now = 0.0

    assert limiter.allow("ip-a", now=now)[0] is True
    assert limiter.allow("ip-a", now=now)[0] is False
    # A different key has its own, untouched bucket.
    assert limiter.allow("ip-b", now=now)[0] is True


def test_reset_clears_all_bucket_state():
    limiter = TokenBucketLimiter(capacity=1, refill_rate=0.0)
    now = 0.0
    assert limiter.allow("ip", now=now)[0] is True
    assert limiter.allow("ip", now=now)[0] is False

    limiter.reset()

    assert limiter.allow("ip", now=now)[0] is True
