"""Unit tests for backend.control.collectors.odp_metrics (C2).

All external boundaries are mocked here — no live Redis/Postgres/odp-ingest
is available in this environment:
  * Redis: backend.control.collectors.odp_metrics._collect_stream_state
    imports redis.asyncio lazily inside the function, so we monkeypatch
    ``redis.asyncio.from_url`` to return a fake async client.
  * ODP Postgres: backend.control.collectors.odp_engine.get_odp_engine is
    monkeypatched to return a fake AsyncEngine-shaped object (async context
    manager .connect() -> fake connection with .execute()).
  * odp-ingest health: httpx.AsyncClient.get is monkeypatched.

Covers: normal aggregation (all sections up), Redis-down -> degraded (not
raised), Postgres-down -> degraded (not raised), and that lag vs pending are
reported as distinct fields (not collapsed into one number).
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

import pytest

from backend.control.collectors import odp_metrics

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeRedis:
    """Stands in for redis.asyncio's client — only the methods odp_metrics
    actually calls are implemented."""

    def __init__(self, *, groups=None, pending_summary=None, pending_range=None, raise_on=None):
        self._groups = groups if groups is not None else []
        self._pending_summary = pending_summary
        self._pending_range = pending_range if pending_range is not None else []
        self._raise_on = raise_on or set()
        self.closed = False

    async def xinfo_groups(self, stream):
        if "xinfo_groups" in self._raise_on:
            raise ConnectionError("redis down")
        return self._groups

    async def xpending(self, stream, group):
        if "xpending" in self._raise_on:
            raise ConnectionError("redis down")
        return self._pending_summary

    async def xpending_range(self, stream, group, min, max, count):
        if "xpending_range" in self._raise_on:
            raise ConnectionError("redis down")
        return self._pending_range

    async def aclose(self):
        self.closed = True


class FakeConnectFailRedis(FakeRedis):
    """A redis client whose every call fails — simulates "cannot connect at
    all" rather than "connected but XINFO GROUPS errored"."""

    def __init__(self):
        super().__init__(raise_on={"xinfo_groups", "xpending", "xpending_range"})

    async def xinfo_groups(self, stream):
        raise ConnectionError("connection refused")

    async def xpending(self, stream, group):
        raise ConnectionError("connection refused")


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class FakeConnection:
    def __init__(self, total: int, last_24h: int, *, raise_on_execute: bool = False):
        self._total = total
        self._last_24h = last_24h
        self._raise_on_execute = raise_on_execute
        self._call_count = 0

    async def execute(self, stmt):
        if self._raise_on_execute:
            raise RuntimeError("relation \"odp_dlq\" does not exist")
        self._call_count += 1
        if self._call_count == 1:
            return FakeResult(self._total)
        return FakeResult(self._last_24h)


class FakeEngine:
    def __init__(self, conn: FakeConnection):
        self._conn = conn

    def connect(self):
        @asynccontextmanager
        async def _cm():
            yield self._conn

        return _cm()


class FakeHttpResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


class FakeHttpClient:
    def __init__(self, *, status_code: int = 200, raise_exc: Exception | None = None):
        self._status_code = status_code
        self._raise_exc = raise_exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        if self._raise_exc:
            raise self._raise_exc
        return FakeHttpResponse(self._status_code)


# ---------------------------------------------------------------------------
# Env fixture: point all three sections at "configured" by default
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def odp_env(monkeypatch):
    monkeypatch.setenv("ODP_REDIS_URL", "redis://fake-redis:6379/0")
    monkeypatch.setenv("ODP_BUS_GROUP", "odp-store")
    monkeypatch.setenv("ODP_DATABASE_URL", "postgresql://user:pass@fake-pg:5432/odp")
    monkeypatch.setenv("ODP_INGEST_URL", "http://fake-ingest:8040")
    yield
    keys = ("ODP_REDIS_URL", "ODP_BUS_GROUP", "ODP_DATABASE_URL", "ODP_INGEST_URL", "REDIS_URL")
    for key in keys:
        os.environ.pop(key, None)


def _patch_redis(monkeypatch, fake_client):
    import redis.asyncio as aioredis

    monkeypatch.setattr(aioredis, "from_url", lambda *a, **k: fake_client)


def _patch_engine(monkeypatch, fake_engine):
    monkeypatch.setattr(
        "backend.control.collectors.odp_engine.get_odp_engine",
        lambda database_url: fake_engine,
    )


def _patch_httpx(monkeypatch, fake_client):
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: fake_client)


# ---------------------------------------------------------------------------
# Normal aggregation: everything up
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_normal_aggregation_all_sections_available(monkeypatch):
    fake_redis = FakeRedis(
        groups=[{"name": "odp-store", "lag": 42}],
        pending_summary={"pending": 7, "min": "1-0", "max": "2-0", "consumers": []},
        pending_range=[
            {
                "message_id": "1-0",
                "consumer": "c1",
                "time_since_delivered": 1500,
                "times_delivered": 1,
            }
        ],
    )
    _patch_redis(monkeypatch, fake_redis)
    _patch_engine(monkeypatch, FakeEngine(FakeConnection(total=3, last_24h=1)))
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=200))

    snapshot = await odp_metrics.collect()

    assert snapshot.stream.available is True
    assert snapshot.stream.name == "odp.ingest.raw"
    assert snapshot.stream.group == "odp-store"
    assert snapshot.stream.lag == 42
    assert snapshot.stream.pending == 7
    assert snapshot.stream.oldest_pending_idle_ms == 1500

    assert snapshot.dlq.available is True
    assert snapshot.dlq.total == 3
    assert snapshot.dlq.last_24h == 1

    assert snapshot.ingest.available is True
    assert snapshot.ingest.healthy is True

    assert fake_redis.closed is True


@pytest.mark.asyncio
async def test_lag_and_pending_reported_distinctly(monkeypatch):
    """A stream can have backlog (lag) with nobody having read any of it yet
    (pending == 0) — these must never collapse into a single number."""
    fake_redis = FakeRedis(
        groups=[{"name": "odp-store", "lag": 100}],
        pending_summary={"pending": 0, "min": None, "max": None, "consumers": []},
        pending_range=[],
    )
    _patch_redis(monkeypatch, fake_redis)
    _patch_engine(monkeypatch, FakeEngine(FakeConnection(total=0, last_24h=0)))
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=200))

    snapshot = await odp_metrics.collect()

    assert snapshot.stream.lag == 100
    assert snapshot.stream.pending == 0
    assert snapshot.stream.lag != snapshot.stream.pending
    # zero pending -> no xpending_range call is made -> idle stays None
    assert snapshot.stream.oldest_pending_idle_ms is None


# ---------------------------------------------------------------------------
# Redis down -> degraded, not raised
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_redis_unreachable_degrades_stream_section_only(monkeypatch):
    _patch_redis(monkeypatch, FakeConnectFailRedis())
    _patch_engine(monkeypatch, FakeEngine(FakeConnection(total=2, last_24h=0)))
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=200))

    snapshot = await odp_metrics.collect()

    # Redis being down must not raise, and must not take down DLQ/ingest.
    assert snapshot.stream.available is False
    assert snapshot.stream.lag is None
    assert snapshot.stream.pending is None
    assert snapshot.stream.error is not None
    assert snapshot.dlq.available is True
    assert snapshot.ingest.available is True


@pytest.mark.asyncio
async def test_redis_url_not_configured_degrades_without_raising(monkeypatch):
    monkeypatch.delenv("ODP_REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    _patch_engine(monkeypatch, FakeEngine(FakeConnection(total=0, last_24h=0)))
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=200))

    snapshot = await odp_metrics.collect()

    assert snapshot.stream.available is False
    assert "ODP_REDIS_URL" in (snapshot.stream.error or "")


# ---------------------------------------------------------------------------
# Postgres down -> degraded, not raised
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_postgres_unreachable_degrades_dlq_section_only(monkeypatch):
    fake_redis = FakeRedis(groups=[{"name": "odp-store", "lag": 0}], pending_summary={"pending": 0})
    _patch_redis(monkeypatch, fake_redis)

    def _boom(database_url):
        raise ConnectionError("could not connect to server")

    monkeypatch.setattr("backend.control.collectors.odp_engine.get_odp_engine", _boom)
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=200))

    snapshot = await odp_metrics.collect()

    assert snapshot.dlq.available is False
    assert snapshot.dlq.total is None
    assert snapshot.dlq.last_24h is None
    assert snapshot.dlq.error is not None
    # other sections remain unaffected
    assert snapshot.stream.available is True
    assert snapshot.ingest.available is True


@pytest.mark.asyncio
async def test_odp_dlq_table_missing_degrades_without_raising(monkeypatch):
    """A fresh odp-store that never ran migrate() has no odp_dlq table —
    this must degrade the DLQ section, not raise out of collect()."""
    fake_redis = FakeRedis(groups=[], pending_summary=None)
    _patch_redis(monkeypatch, fake_redis)
    _patch_engine(
        monkeypatch, FakeEngine(FakeConnection(total=0, last_24h=0, raise_on_execute=True))
    )
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=200))

    snapshot = await odp_metrics.collect()

    assert snapshot.dlq.available is False
    assert "odp_dlq" in (snapshot.dlq.error or "")


@pytest.mark.asyncio
async def test_odp_database_url_not_configured_degrades_without_raising(monkeypatch):
    monkeypatch.delenv("ODP_DATABASE_URL", raising=False)
    fake_redis = FakeRedis(groups=[], pending_summary=None)
    _patch_redis(monkeypatch, fake_redis)
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=200))

    snapshot = await odp_metrics.collect()

    assert snapshot.dlq.available is False
    assert "ODP_DATABASE_URL" in (snapshot.dlq.error or "")


# ---------------------------------------------------------------------------
# odp-ingest health down -> degraded, not raised
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ingest_unreachable_degrades_ingest_section_only(monkeypatch):
    fake_redis = FakeRedis(groups=[], pending_summary=None)
    _patch_redis(monkeypatch, fake_redis)
    _patch_engine(monkeypatch, FakeEngine(FakeConnection(total=0, last_24h=0)))
    _patch_httpx(monkeypatch, FakeHttpClient(raise_exc=ConnectionError("connection refused")))

    snapshot = await odp_metrics.collect()

    assert snapshot.ingest.available is False
    assert snapshot.ingest.healthy is None
    assert snapshot.ingest.error is not None
    assert snapshot.stream.available is True
    assert snapshot.dlq.available is True


@pytest.mark.asyncio
async def test_ingest_url_not_configured_degrades_without_raising(monkeypatch):
    monkeypatch.delenv("ODP_INGEST_URL", raising=False)
    fake_redis = FakeRedis(groups=[], pending_summary=None)
    _patch_redis(monkeypatch, fake_redis)
    _patch_engine(monkeypatch, FakeEngine(FakeConnection(total=0, last_24h=0)))

    snapshot = await odp_metrics.collect()

    assert snapshot.ingest.available is False
    assert "ODP_INGEST_URL" in (snapshot.ingest.error or "")


@pytest.mark.asyncio
async def test_ingest_reports_unhealthy_on_5xx_without_raising(monkeypatch):
    fake_redis = FakeRedis(groups=[], pending_summary=None)
    _patch_redis(monkeypatch, fake_redis)
    _patch_engine(monkeypatch, FakeEngine(FakeConnection(total=0, last_24h=0)))
    _patch_httpx(monkeypatch, FakeHttpClient(status_code=503))

    snapshot = await odp_metrics.collect()

    assert snapshot.ingest.available is True
    assert snapshot.ingest.healthy is False


# ---------------------------------------------------------------------------
# All three down at once -> still returns a snapshot, never raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_everything_down_returns_fully_degraded_snapshot(monkeypatch):
    _patch_redis(monkeypatch, FakeConnectFailRedis())
    monkeypatch.setattr(
        "backend.control.collectors.odp_engine.get_odp_engine",
        lambda database_url: (_ for _ in ()).throw(ConnectionError("db down")),
    )
    _patch_httpx(monkeypatch, FakeHttpClient(raise_exc=ConnectionError("ingest down")))

    snapshot = await odp_metrics.collect()

    assert snapshot.stream.available is False
    assert snapshot.dlq.available is False
    assert snapshot.ingest.available is False
