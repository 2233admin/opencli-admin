"""Per-domain concurrency cap: domain extraction + in-process slot limiting."""

import asyncio
from types import SimpleNamespace

import pytest

from backend.pipeline import domain_limiter


@pytest.fixture(autouse=True)
def _clear_registry():
    domain_limiter._semaphores.clear()
    yield
    domain_limiter._semaphores.clear()


def _src(**config):
    return SimpleNamespace(channel_config=config)


def test_domain_of_rss_strips_scheme_port_case():
    assert domain_limiter.domain_of(_src(feed_url="https://Ex.com:8080/feed")) == "ex.com"


def test_domain_of_api_base_url():
    assert domain_limiter.domain_of(_src(base_url="https://api.site.io/v1")) == "api.site.io"


def test_domain_of_bare_site_host():
    assert domain_limiter.domain_of(_src(site="news.ycombinator.com")) == "news.ycombinator.com"


def test_domain_of_none_when_no_url():
    assert domain_limiter.domain_of(_src(binary="echo")) is None


async def _peak_concurrency(source, n, hold=0.02):
    state = {"cur": 0, "peak": 0}

    async def worker():
        async with domain_limiter.domain_slot(source):
            state["cur"] += 1
            state["peak"] = max(state["peak"], state["cur"])
            await asyncio.sleep(hold)
            state["cur"] -= 1

    await asyncio.gather(*[worker() for _ in range(n)])
    return state["peak"]


@pytest.mark.asyncio
async def test_domain_slot_caps_same_domain(monkeypatch):
    monkeypatch.setenv("PER_DOMAIN_CONCURRENCY", "2")
    peak = await _peak_concurrency(_src(feed_url="https://ex.com/feed"), n=6)
    assert peak <= 2


@pytest.mark.asyncio
async def test_no_domain_is_not_limited(monkeypatch):
    monkeypatch.setenv("PER_DOMAIN_CONCURRENCY", "1")
    # cli source → no derivable domain → runs are not serialized.
    peak = await _peak_concurrency(_src(binary="echo"), n=4)
    assert peak >= 2


@pytest.mark.asyncio
async def test_different_domains_dont_block_each_other(monkeypatch):
    monkeypatch.setenv("PER_DOMAIN_CONCURRENCY", "1")
    a = _src(feed_url="https://a.com/feed")
    b = _src(feed_url="https://b.com/feed")
    state = {"cur": 0, "peak": 0}

    async def worker(source):
        async with domain_limiter.domain_slot(source):
            state["cur"] += 1
            state["peak"] = max(state["peak"], state["cur"])
            await asyncio.sleep(0.02)
            state["cur"] -= 1

    await asyncio.gather(worker(a), worker(b))
    # Different domains each get their own slot → they overlap despite limit=1.
    assert state["peak"] == 2
