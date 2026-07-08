"""Unit tests for the fleet-auth bind guard, host resolution, and the
websocket branch of FleetAuthMiddleware (ADR-0005)."""

import pytest

from backend.config import get_settings
from backend.security.fleet_auth import (
    FleetAuthMiddleware,
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


# ── FleetAuthMiddleware — websocket scope (pure ASGI, no FastAPI) ──────────────

TOKEN = "fleet-ws-test-token"


@pytest.fixture
def auth_enabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "api_auth_token", TOKEN)


@pytest.fixture
def auth_disabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "api_auth_token", "")


def _ws_scope(path: str, *, headers: list[tuple[bytes, bytes]] | None = None,
              query_string: bytes = b"") -> dict:
    return {
        "type": "websocket",
        "path": path,
        "headers": headers or [],
        "query_string": query_string,
    }


class _Recorder:
    """Captures ASGI messages passed to `send` and whether the inner app ran."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.app_called = False

    async def receive(self) -> dict:
        return {"type": "websocket.connect"}

    async def send(self, message: dict) -> None:
        self.sent.append(message)


async def _inner_app(scope, receive, send) -> None:
    recorder: _Recorder = scope["_recorder"]
    recorder.app_called = True


def _wrapped(recorder: _Recorder) -> FleetAuthMiddleware:
    async def app(scope, receive, send):
        scope["_recorder"] = recorder
        await _inner_app(scope, receive, send)

    return FleetAuthMiddleware(app)


@pytest.mark.asyncio
async def test_non_api_ws_path_passes_through_even_with_token(auth_enabled):
    recorder = _Recorder()
    scope = _ws_scope("/ws/not-api")
    await _wrapped(recorder)(scope, recorder.receive, recorder.send)
    assert recorder.app_called is True
    assert recorder.sent == []


@pytest.mark.asyncio
async def test_ws_no_token_configured_passes_through(auth_disabled):
    recorder = _Recorder()
    scope = _ws_scope("/api/v1/nodes/ws")
    await _wrapped(recorder)(scope, recorder.receive, recorder.send)
    assert recorder.app_called is True
    assert recorder.sent == []


@pytest.mark.asyncio
async def test_ws_token_set_no_credential_is_rejected_4401(auth_enabled):
    recorder = _Recorder()
    scope = _ws_scope("/api/v1/nodes/ws")
    await _wrapped(recorder)(scope, recorder.receive, recorder.send)
    assert recorder.app_called is False
    assert recorder.sent == [
        {"type": "websocket.close", "code": 4401, "reason": "Invalid or missing API token"}
    ]


@pytest.mark.asyncio
async def test_ws_correct_bearer_header_passes_through(auth_enabled):
    recorder = _Recorder()
    scope = _ws_scope(
        "/api/v1/nodes/ws",
        headers=[(b"authorization", f"Bearer {TOKEN}".encode())],
    )
    await _wrapped(recorder)(scope, recorder.receive, recorder.send)
    assert recorder.app_called is True
    assert recorder.sent == []


@pytest.mark.asyncio
async def test_ws_wrong_bearer_header_is_rejected_4401(auth_enabled):
    recorder = _Recorder()
    scope = _ws_scope(
        "/api/v1/nodes/ws",
        headers=[(b"authorization", b"Bearer wrong-token")],
    )
    await _wrapped(recorder)(scope, recorder.receive, recorder.send)
    assert recorder.app_called is False
    assert recorder.sent[0]["code"] == 4401


@pytest.mark.asyncio
async def test_ws_correct_query_token_passes_through(auth_enabled):
    recorder = _Recorder()
    scope = _ws_scope("/api/v1/nodes/ws", query_string=f"token={TOKEN}".encode())
    await _wrapped(recorder)(scope, recorder.receive, recorder.send)
    assert recorder.app_called is True
    assert recorder.sent == []


@pytest.mark.asyncio
async def test_ws_wrong_query_token_is_rejected_4401(auth_enabled):
    recorder = _Recorder()
    scope = _ws_scope("/api/v1/nodes/ws", query_string=b"token=wrong-token")
    await _wrapped(recorder)(scope, recorder.receive, recorder.send)
    assert recorder.app_called is False
    assert recorder.sent[0]["code"] == 4401
