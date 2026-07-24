"""Safe PostgreSQL test-database isolation for live conformance tests."""

from __future__ import annotations

import os
import re
import uuid
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

POSTGRES_TEST_URL_ENV = "TEST_DATABASE_URL_PG"
REQUIRE_POSTGRES_ENV = "REQUIRE_POSTGRES_CONFORMANCE"

_TEST_MARKERS = {"ci", "temp", "test", "testing", "tmp"}
_PRODUCTION_MARKERS = {"live", "prod", "production", "staging"}
_SYSTEM_DATABASES = {"postgres", "template0", "template1"}


class PostgresConformanceConfigurationError(ValueError):
    """Raised when a live PostgreSQL selector is absent or unsafe."""


def resolve_postgres_test_url(
    environ: Mapping[str, str] | None = None,
) -> URL | None:
    """Return a normalized, explicitly test-only PostgreSQL URL.

    The configured database is an administrative test database used only to
    create and remove unique sibling databases. Tests never create application
    tables in the configured database itself.
    """

    values = os.environ if environ is None else environ
    raw_url = values.get(POSTGRES_TEST_URL_ENV, "").strip()
    required = values.get(REQUIRE_POSTGRES_ENV, "").strip().lower() in {
        "1",
        "on",
        "true",
        "yes",
    }
    if not raw_url:
        if required:
            raise PostgresConformanceConfigurationError(
                f"{POSTGRES_TEST_URL_ENV} is required when "
                f"{REQUIRE_POSTGRES_ENV}=1"
            )
        return None

    try:
        url = make_url(raw_url)
    except Exception as exc:
        raise PostgresConformanceConfigurationError(
            f"{POSTGRES_TEST_URL_ENV} is not a valid SQLAlchemy URL"
        ) from exc
    if url.get_backend_name() != "postgresql":
        raise PostgresConformanceConfigurationError(
            f"{POSTGRES_TEST_URL_ENV} must use PostgreSQL"
        )

    database = (url.database or "").lower()
    tokens = {token for token in re.split(r"[^a-z0-9]+", database) if token}
    if not database or database in _SYSTEM_DATABASES:
        raise PostgresConformanceConfigurationError(
            f"{POSTGRES_TEST_URL_ENV} must name an explicit test database"
        )
    if tokens & _PRODUCTION_MARKERS:
        raise PostgresConformanceConfigurationError(
            f"{POSTGRES_TEST_URL_ENV} database name contains a production marker"
        )
    if not tokens & _TEST_MARKERS:
        raise PostgresConformanceConfigurationError(
            f"{POSTGRES_TEST_URL_ENV} database name must contain a standalone "
            "test marker (test, testing, ci, tmp, or temp)"
        )

    return url.set(drivername="postgresql+asyncpg")


def _temporary_database_name(purpose: str) -> str:
    safe_purpose = re.sub(r"[^a-z0-9]+", "_", purpose.lower()).strip("_")[:20]
    return f"opencli_test_{safe_purpose or 'conformance'}_{uuid.uuid4().hex[:12]}"


@asynccontextmanager
async def temporary_postgres_database(purpose: str) -> AsyncIterator[str]:
    """Yield a unique disposable PostgreSQL database URL.

    Missing local configuration produces an explicit skip. Invalid or missing
    required CI configuration fails instead of silently weakening the gate.
    """

    admin_url = resolve_postgres_test_url()
    if admin_url is None:
        pytest.skip(
            f"{POSTGRES_TEST_URL_ENV} is not configured; "
            "live PostgreSQL conformance is skipped locally"
        )

    database_name = _temporary_database_name(purpose)
    database_url = admin_url.set(database=database_name)
    admin_engine = create_async_engine(
        admin_url,
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )
    created = False
    try:
        async with admin_engine.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{database_name}"'))
        created = True
        yield database_url.render_as_string(hide_password=False)
    finally:
        if created:
            async with admin_engine.connect() as connection:
                await connection.execute(
                    text(
                        """
                        SELECT pg_terminate_backend(pid)
                        FROM pg_stat_activity
                        WHERE datname = :database_name
                          AND pid <> pg_backend_pid()
                        """
                    ),
                    {"database_name": database_name},
                )
                await connection.execute(
                    text(f'DROP DATABASE IF EXISTS "{database_name}"')
                )
        await admin_engine.dispose()
