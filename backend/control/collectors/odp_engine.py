"""Dedicated, isolated async engine for the ODP Postgres database.

This app's own SQLAlchemy engine (backend/database.py) points at
``DATABASE_URL`` — a *different* database than ODP's. odp-rs/crates/
odp-store writes ``odp_records``/``odp_dlq`` into whatever ``ODP_DATABASE_URL``
points at (falling back to ``DATABASE_URL`` only on the Rust side, per
odp-store/src/main.rs — that fallback is odp-store's own default-to-same-
Postgres-instance convenience, not something this module should imitate,
since C2's brief is explicit: "You must create a dedicated read-only async
engine for it to query odp_dlq").

This module intentionally does NOT import backend.database.Base/engine and
does NOT run migrations — it is a read-only query engine for one table
(``odp_dlq``) that already exists (or doesn't; see collectors/odp_metrics.py
for how an absent table degrades the DLQ section instead of raising).

The engine is created lazily and cached per URL (so repeated collect() calls
in the same process reuse one connection pool instead of opening a fresh one
every request), but is deliberately NOT a module-level singleton keyed on
nothing — tests construct engines against sqlite/other URLs and must not leak
into each other or into a real Postgres pool.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

_engine_cache: dict[str, AsyncEngine] = {}


def _normalize_asyncpg_url(url: str) -> str:
    """odp-rs/ODP_DATABASE_URL is a plain ``postgresql://...`` URL (sqlx style,
    see .env.example) — not a SQLAlchemy driver URL. Rewrite it to the
    asyncpg dialect so create_async_engine can use it, without mutating any
    other part of the URL."""
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    return url


def get_odp_engine(database_url: str) -> AsyncEngine:
    """Return a cached read-only async engine for ``database_url``.

    Deliberately separate from backend.database.engine — this is a distinct
    physical database (ODP's Postgres, not the app's own DATABASE_URL), and
    must never share a pool, a Base/metadata registry, or a migration path
    with it.
    """
    normalized = _normalize_asyncpg_url(database_url)
    engine = _engine_cache.get(normalized)
    if engine is None:
        engine = create_async_engine(
            normalized,
            pool_size=2,
            max_overflow=2,
            pool_pre_ping=True,
            # This engine only ever runs short read-only SELECTs against
            # odp_dlq from collectors/odp_metrics.py — no ORM models, no
            # migrations, no writes.
        )
        _engine_cache[normalized] = engine
    return engine


async def dispose_all() -> None:
    """Dispose every cached engine. Primarily for tests that create engines
    against throwaway URLs and want a clean teardown."""
    for engine in _engine_cache.values():
        await engine.dispose()
    _engine_cache.clear()
