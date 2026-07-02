"""Unit tests for the fleet-auth bind guard and host resolution (ADR-0005)."""

import pytest

from backend.security.fleet_auth import (
    enforce_bind_guard,
    is_localhost_host,
    resolve_uvicorn_host,
)


# ── is_localhost_host ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "host",
    ["127.0.0.1", "127.0.1.1", "localhost", "LOCALHOST", "::1", "[::1]", " 127.0.0.1 "],
)
def test_localhost_hosts(host):
    assert is_localhost_host(host) is True


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.5", "100.80.105.128", "1270.0.0.1"])
def test_non_localhost_hosts(host):
    assert is_localhost_host(host) is False


# ── resolve_uvicorn_host ───────────────────────────────────────────────────────


def test_resolve_defaults_to_localhost_without_flag():
    """pytest / programmatic runs have no --host flag -> uvicorn's default."""
    assert resolve_uvicorn_host(["uvicorn", "backend.main:app"]) == "127.0.0.1"


def test_resolve_space_separated_flag():
    argv = ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
    assert resolve_uvicorn_host(argv) == "0.0.0.0"


def test_resolve_equals_form():
    argv = ["uvicorn", "backend.main:app", "--host=192.168.1.5"]
    assert resolve_uvicorn_host(argv) == "192.168.1.5"


def test_resolve_last_flag_wins():
    argv = ["uvicorn", "app", "--host", "127.0.0.1", "--host", "0.0.0.0"]
    assert resolve_uvicorn_host(argv) == "0.0.0.0"


def test_resolve_uses_sys_argv_by_default():
    # Under pytest, sys.argv has no --host flag -> localhost default.
    assert resolve_uvicorn_host() == "127.0.0.1"


# ── enforce_bind_guard ─────────────────────────────────────────────────────────


def test_localhost_bind_without_token_is_allowed():
    enforce_bind_guard("127.0.0.1", "")  # dev posture — must not raise


def test_non_localhost_bind_without_token_refuses():
    with pytest.raises(RuntimeError, match="API_AUTH_TOKEN"):
        enforce_bind_guard("0.0.0.0", "")


def test_non_localhost_bind_with_token_is_allowed():
    enforce_bind_guard("0.0.0.0", "some-token")  # must not raise


def test_whitespace_token_counts_as_unset():
    with pytest.raises(RuntimeError):
        enforce_bind_guard("0.0.0.0", "   ")


@pytest.mark.parametrize("host", ["localhost", "::1", "127.0.0.1"])
def test_all_loopback_spellings_allowed_without_token(host):
    enforce_bind_guard(host, "")
