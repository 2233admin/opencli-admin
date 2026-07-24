import pytest

from tests.postgres_conformance import (
    PostgresConformanceConfigurationError,
    resolve_postgres_test_url,
    temporary_postgres_database,
)


def test_postgres_selector_accepts_and_normalizes_explicit_test_database():
    url = resolve_postgres_test_url(
        {
            "TEST_DATABASE_URL_PG": (
                "postgresql://opencli:secret@localhost:5432/opencli_admin_test"
            )
        }
    )

    assert url is not None
    assert url.drivername == "postgresql+asyncpg"
    assert url.database == "opencli_admin_test"


@pytest.mark.parametrize(
    "database_url",
    [
        "sqlite+aiosqlite:///opencli_test.db",
        "postgresql+asyncpg://opencli:secret@localhost/postgres",
        "postgresql+asyncpg://opencli:secret@localhost/opencli_admin",
        "postgresql+asyncpg://opencli:secret@localhost/opencli_prod_test",
    ],
)
def test_postgres_selector_rejects_unsafe_database_urls(database_url):
    with pytest.raises(PostgresConformanceConfigurationError):
        resolve_postgres_test_url({"TEST_DATABASE_URL_PG": database_url})


def test_postgres_selector_is_optional_locally_but_required_in_ci():
    assert resolve_postgres_test_url({}) is None

    with pytest.raises(
        PostgresConformanceConfigurationError,
        match="TEST_DATABASE_URL_PG is required",
    ):
        resolve_postgres_test_url({"REQUIRE_POSTGRES_CONFORMANCE": "1"})


@pytest.mark.asyncio
async def test_required_postgres_context_fails_instead_of_skipping(monkeypatch):
    monkeypatch.delenv("TEST_DATABASE_URL_PG", raising=False)
    monkeypatch.setenv("REQUIRE_POSTGRES_CONFORMANCE", "1")

    with pytest.raises(
        PostgresConformanceConfigurationError,
        match="TEST_DATABASE_URL_PG is required",
    ):
        async with temporary_postgres_database("required"):
            raise AssertionError("unreachable")
