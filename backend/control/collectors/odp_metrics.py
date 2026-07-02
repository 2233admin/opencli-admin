"""System-level ODP sensor collector (C2).

Gathers a single point-in-time snapshot of the ODP data plane's health:

  * Redis Streams consumer-group state for ``odp.ingest.raw`` — lag (backlog
    not yet delivered to any consumer) and pending (delivered but not yet
    ACKed), kept as two DISTINCT numbers. Stream/group naming mirrors
    odp-rs/crates/odp-bus/src/redis_streams.rs::StreamNames/BusConfig exactly
    (default stream "odp.ingest.raw", default group "odp-store", env vars
    ODP_REDIS_URL/REDIS_URL + ODP_BUS_GROUP) so this reads the same group the
    Rust odp-store consumer actually uses — a typo'd default here would
    silently report on a group nothing consumes from.
  * The ODP Postgres ``odp_dlq`` table (schema: odp-rs/crates/odp-store/src/
    writer.rs::migrate) via a DEDICATED read-only async engine on
    ODP_DATABASE_URL — this app's own DATABASE_URL is a different database
    and must not be reused for this.
  * odp-ingest's own ``/health`` endpoint (ODP_INGEST_URL), as a plain
    timeout-bounded httpx GET.

Every section is collected defensively: a down Redis, a missing/unreachable
ODP Postgres, or an unreachable odp-ingest must degrade that section to
"unavailable" and must NEVER raise out of `collect()` — see
docs/CONTROL_THEORY_ARCHITECTURE.md §0 ("a controller must not be built on a
lying sensor", which cuts both ways: an *honestly absent* reading is fine, a
crash that takes the whole endpoint down is not).

Two things this module explicitly does NOT do, by design (see
docs/CONTROL_THEORY_ARCHITECTURE.md + the C2 task brief):

  * outbox_unpublished — there is no odp_outbox table (commit ef4828d chose
    "simplified reorder": publish-after-commit, no outbox). Reported as
    unavailable, never queried.
  * store_healthy / store_heartbeat_age — odp-store has no heartbeat table
    and no HTTP port (it's pgrep-only liveness today). Reported as
    unavailable/unknown, never fabricated. Adding a heartbeat producer is a
    Rust change and out of scope here.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx

logger = logging.getLogger(__name__)

# Mirrors odp-bus's StreamNames::default() (odp-rs/crates/odp-bus/src/redis_streams.rs).
DEFAULT_INGEST_RAW_STREAM = "odp.ingest.raw"
# Mirrors odp-bus's BusConfig::from_env() default consumer_group.
DEFAULT_BUS_GROUP = "odp-store"

DEFAULT_REDIS_TIMEOUT = 3.0
DEFAULT_PG_TIMEOUT = 5.0
DEFAULT_HEALTH_TIMEOUT = 3.0


def _bus_redis_url() -> str | None:
    """Same precedence odp-bus's BusConfig::from_env() uses: ODP_REDIS_URL,
    falling back to REDIS_URL. Neither set -> no Redis to read from."""
    return os.environ.get("ODP_REDIS_URL") or os.environ.get("REDIS_URL") or None


def _bus_group() -> str:
    return os.environ.get("ODP_BUS_GROUP", DEFAULT_BUS_GROUP)


def _ingest_raw_stream() -> str:
    # Not currently overridable via env on the Rust side (StreamNames has no
    # from_env()) — kept as a function (not a bare constant reference) so a
    # future env override is a one-line change here too.
    return DEFAULT_INGEST_RAW_STREAM


def _odp_database_url() -> str | None:
    return os.environ.get("ODP_DATABASE_URL") or None


def _odp_ingest_url() -> str | None:
    base = os.environ.get("ODP_INGEST_URL", "").strip().rstrip("/")
    return base or None


@dataclass
class StreamState:
    """Redis consumer-group sensor reading for one stream+group.

    ``lag`` and ``pending`` are kept distinct on purpose (see module
    docstring / task brief): lag is the not-yet-delivered backlog (from
    XINFO GROUPS' ``lag`` field), pending is delivered-but-unACKed (from
    XPENDING's summary form). A stream can have high lag and zero pending
    (nobody's reading), or zero lag and high pending (reader crashed after
    delivery, before ACK) — collapsing them would hide exactly the failure
    mode an operator needs to distinguish.
    """

    available: bool
    name: str
    group: str
    lag: int | None = None
    pending: int | None = None
    oldest_pending_idle_ms: int | None = None
    error: str | None = None


@dataclass
class DlqState:
    available: bool
    total: int | None = None
    last_24h: int | None = None
    error: str | None = None


@dataclass
class IngestHealthState:
    available: bool
    healthy: bool | None = None
    error: str | None = None


@dataclass
class OdpMetricsSnapshot:
    """Raw collector output — mapped to the API schema in schemas/odp_state.py."""

    stream: StreamState
    dlq: DlqState
    ingest: IngestHealthState
    collected_at: datetime = field(default_factory=lambda: datetime.now(UTC))


async def _collect_stream_state(*, timeout: float = DEFAULT_REDIS_TIMEOUT) -> StreamState:
    """XINFO GROUPS <stream> for the group's lag, plus XPENDING <stream> <group>
    (summary form) for pending count + oldest idle ms. Any failure (no redis
    configured, connection refused, stream/group not created yet) degrades
    this section to unavailable rather than raising.
    """
    stream = _ingest_raw_stream()
    group = _bus_group()
    redis_url = _bus_redis_url()

    if not redis_url:
        return StreamState(
            available=False,
            name=stream,
            group=group,
            error="ODP_REDIS_URL/REDIS_URL not configured",
        )

    try:
        import redis.asyncio as aioredis
        import redis.exceptions as redis_exceptions
    except ImportError as exc:  # pragma: no cover - redis is a hard dependency in pyproject
        return StreamState(available=False, name=stream, group=group, error=str(exc))

    def _is_missing_stream_or_group(exc: Exception) -> bool:
        """True when ``exc`` means "stream/group doesn't exist yet" (a fresh
        odp-store that never called ensure_consumer_group) — that's a
        legitimate empty reading, not a down Redis. Everything else
        (connection refused, timeout, auth failure) is a real outage and
        must degrade the whole section, not just leave lag/pending as None.
        """
        if isinstance(exc, redis_exceptions.ResponseError):
            msg = str(exc).upper()
            return "NOGROUP" in msg or "NO SUCH KEY" in msg
        return False

    client = aioredis.from_url(redis_url, socket_timeout=timeout, socket_connect_timeout=timeout)
    try:
        lag: int | None = None
        try:
            groups = await client.xinfo_groups(stream)
        except Exception as exc:
            if not _is_missing_stream_or_group(exc):
                raise
            # Stream/group not created yet (e.g. odp-store never started) is
            # not the same as "redis is down" — report it as available=True
            # with lag/pending left None rather than failing the whole
            # section, since XPENDING below may still succeed or also no-op.
            logger.info("odp_metrics: XINFO GROUPS %s: group not found yet: %s", stream, exc)
            groups = []

        for g in groups:
            name = g.get("name") if isinstance(g, dict) else None
            if isinstance(name, bytes):
                name = name.decode()
            if name == group:
                raw_lag = g.get("lag")
                if raw_lag is not None:
                    lag = int(raw_lag)
                break

        pending_count: int | None = None
        oldest_idle_ms: int | None = None
        try:
            summary = await client.xpending(stream, group)
        except Exception as exc:
            if not _is_missing_stream_or_group(exc):
                raise
            logger.info("odp_metrics: XPENDING %s %s: group not found yet: %s", stream, group, exc)
            summary = None

        if summary:
            # redis-py xpending() summary form: dict with "pending",
            # "min", "max", "consumers" (list of {name, pending}). The
            # summary form does not carry idle time — that needs the
            # extended form (min_idle_time / start / end / count), which
            # we issue as a second, cheap, bounded call only when there is
            # at least one pending message worth inspecting.
            raw_pending = summary.get("pending") if isinstance(summary, dict) else None
            if raw_pending is not None:
                pending_count = int(raw_pending)

            if pending_count:
                try:
                    detail = await client.xpending_range(
                        stream, group, min="-", max="+", count=1
                    )
                except Exception as exc:
                    logger.info(
                        "odp_metrics: XPENDING range %s %s failed: %s", stream, group, exc
                    )
                    detail = []
                if detail:
                    entry = detail[0]
                    idle = entry.get("time_since_delivered") if isinstance(entry, dict) else None
                    if idle is not None:
                        oldest_idle_ms = int(idle)

        return StreamState(
            available=True,
            name=stream,
            group=group,
            lag=lag,
            pending=pending_count,
            oldest_pending_idle_ms=oldest_idle_ms,
        )
    except Exception as exc:
        logger.warning("odp_metrics: redis stream state collection failed: %s", exc)
        return StreamState(available=False, name=stream, group=group, error=str(exc))
    finally:
        try:
            await client.aclose()
        except Exception:
            pass


async def _collect_dlq_state(*, timeout: float = DEFAULT_PG_TIMEOUT) -> DlqState:
    """SELECT COUNT(*) FROM odp_dlq (+ a last_24h count), via a dedicated
    read-only engine on ODP_DATABASE_URL. Degrades to unavailable if the URL
    is unset, the DB is unreachable, or the table doesn't exist yet (a fresh
    odp-store that has never run its migrate() has no odp_dlq table)."""
    database_url = _odp_database_url()
    if not database_url:
        return DlqState(available=False, error="ODP_DATABASE_URL not configured")

    from backend.control.collectors.odp_engine import get_odp_engine

    try:
        engine = get_odp_engine(database_url)
    except Exception as exc:
        return DlqState(available=False, error=str(exc))

    import asyncio

    from sqlalchemy import text

    async def _run_queries() -> tuple[int, int]:
        async with engine.connect() as conn:
            total_row = await conn.execute(text("SELECT COUNT(*) FROM odp_dlq"))
            total = total_row.scalar_one()
            last_24h_row = await conn.execute(
                text("SELECT COUNT(*) FROM odp_dlq WHERE failed_at >= NOW() - INTERVAL '24 hours'")
            )
            last_24h = last_24h_row.scalar_one()
        return int(total), int(last_24h)

    try:
        total, last_24h = await asyncio.wait_for(_run_queries(), timeout=timeout)
        return DlqState(available=True, total=total, last_24h=last_24h)
    except Exception as exc:
        # Covers: table absent (odp-store never migrated), connection refused,
        # auth failure, timeout — all "we cannot answer" not "zero".
        logger.warning("odp_metrics: odp_dlq query failed: %s", exc)
        return DlqState(available=False, error=str(exc))


async def _collect_ingest_health(*, timeout: float = DEFAULT_HEALTH_TIMEOUT) -> IngestHealthState:
    """GET <ODP_INGEST_URL>/health. Plain timeout-bounded httpx client, not the
    SSRF-guarded client (backend.security.url_guard.guarded_async_client
    rejects loopback/private/RFC1918 addresses by design — but odp-ingest is
    an internal peer service reached over the LAN/compose network, exactly
    the kind of address that guard exists to block for *user/DB-supplied*
    URLs). ODP_INGEST_URL is operator-configured deployment topology, not
    attacker-influenced input, so the SSRF guard's threat model doesn't apply
    here the way it does to e.g. a webhook URL a user typed in."""
    url = _odp_ingest_url()
    if not url:
        return IngestHealthState(available=False, error="ODP_INGEST_URL not configured")

    endpoint = f"{url}/health"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(endpoint)
        healthy = resp.status_code < 400
        return IngestHealthState(available=True, healthy=healthy)
    except Exception as exc:
        logger.warning("odp_metrics: odp-ingest health check failed: %s", exc)
        return IngestHealthState(available=False, error=str(exc))


async def collect(
    *,
    redis_timeout: float = DEFAULT_REDIS_TIMEOUT,
    pg_timeout: float = DEFAULT_PG_TIMEOUT,
    health_timeout: float = DEFAULT_HEALTH_TIMEOUT,
) -> OdpMetricsSnapshot:
    """Collect the full system-level ODP snapshot. Each section is collected
    independently and defensively — one section being down never prevents the
    others from being reported, and never raises out of this function."""
    stream_state = await _collect_stream_state(timeout=redis_timeout)
    dlq_state = await _collect_dlq_state(timeout=pg_timeout)
    ingest_state = await _collect_ingest_health(timeout=health_timeout)

    return OdpMetricsSnapshot(
        stream=stream_state,
        dlq=dlq_state,
        ingest=ingest_state,
    )
