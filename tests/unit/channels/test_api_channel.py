"""Unit tests for the API channel."""

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.channels.api_channel import ApiChannel, _resolve_dict_secrets, _resolve_secrets
from backend.channels.base import ChannelFetchError, FetchContext


# ── _resolve_secrets ───────────────────────────────────────────────────────────

def test_resolve_secrets_with_env(monkeypatch):
    monkeypatch.setenv("MY_TOKEN", "secret_value")
    result = _resolve_secrets("Bearer {{secret:MY_TOKEN}}")
    assert result == "Bearer secret_value"


def test_resolve_secrets_missing_env(monkeypatch):
    monkeypatch.delenv("MISSING_VAR", raising=False)
    result = _resolve_secrets("{{secret:MISSING_VAR}}")
    assert result == ""


def test_resolve_secrets_no_template():
    result = _resolve_secrets("plain string")
    assert result == "plain string"


def test_resolve_secrets_multiple_placeholders(monkeypatch):
    monkeypatch.setenv("A", "hello")
    monkeypatch.setenv("B", "world")
    result = _resolve_secrets("{{secret:A}} {{secret:B}}")
    assert result == "hello world"


def test_resolve_dict_secrets_replaces_string_values(monkeypatch):
    monkeypatch.setenv("MY_KEY", "resolved")
    d = {"auth": "{{secret:MY_KEY}}", "count": 42}
    result = _resolve_dict_secrets(d)
    assert result["auth"] == "resolved"
    assert result["count"] == 42


def test_resolve_dict_secrets_non_string_passthrough():
    d = {"num": 99, "flag": True, "lst": [1, 2]}
    result = _resolve_dict_secrets(d)
    assert result == {"num": 99, "flag": True, "lst": [1, 2]}


# ── validate_config ────────────────────────────────────────────────────────────

@pytest.fixture
def channel():
    return ApiChannel()


@pytest.mark.asyncio
async def test_validate_config_missing_base_url(channel):
    errors = await channel.validate_config({"endpoint": "/test"})
    assert any("base_url" in e for e in errors)


@pytest.mark.asyncio
async def test_validate_config_missing_endpoint(channel):
    errors = await channel.validate_config({"base_url": "https://api.example.com"})
    assert any("endpoint" in e for e in errors)


@pytest.mark.asyncio
async def test_validate_config_valid(channel):
    errors = await channel.validate_config({
        "base_url": "https://api.example.com",
        "endpoint": "/data",
    })
    assert errors == []


@pytest.mark.asyncio
async def test_validate_config_missing_both(channel):
    errors = await channel.validate_config({})
    assert len(errors) == 2


# ── _build_auth_headers ────────────────────────────────────────────────────────

def test_build_auth_headers_bearer(channel, monkeypatch):
    monkeypatch.setenv("API_TOKEN", "mytoken")
    headers = channel._build_auth_headers({"type": "bearer", "token_env": "API_TOKEN"})
    assert headers == {"Authorization": "Bearer mytoken"}


def test_build_auth_headers_bearer_inline_token(channel):
    headers = channel._build_auth_headers({"type": "bearer", "token": "directtoken"})
    assert headers == {"Authorization": "Bearer directtoken"}


def test_build_auth_headers_basic(channel):
    headers = channel._build_auth_headers({
        "type": "basic",
        "username": "user",
        "password": "pass",
    })
    expected = base64.b64encode(b"user:pass").decode()
    assert headers == {"Authorization": f"Basic {expected}"}


def test_build_auth_headers_api_key_default_header(channel, monkeypatch):
    monkeypatch.setenv("MY_API_KEY", "k123")
    headers = channel._build_auth_headers({"type": "api_key", "key_env": "MY_API_KEY"})
    assert headers == {"X-API-Key": "k123"}


def test_build_auth_headers_api_key_custom_header(channel, monkeypatch):
    monkeypatch.setenv("MY_API_KEY", "k456")
    headers = channel._build_auth_headers({
        "type": "api_key",
        "key_env": "MY_API_KEY",
        "header": "X-Custom-Auth",
    })
    assert headers == {"X-Custom-Auth": "k456"}


def test_build_auth_headers_no_auth(channel):
    headers = channel._build_auth_headers({})
    assert headers == {}


def test_build_auth_headers_unknown_type(channel):
    headers = channel._build_auth_headers({"type": "unknown"})
    assert headers == {}


# ── helpers ────────────────────────────────────────────────────────────────────

def _make_mock_response(status_code=200, json_data=None):
    response = MagicMock()
    response.status_code = status_code
    response.raise_for_status = MagicMock()
    if json_data is not None:
        response.json = MagicMock(return_value=json_data)
    else:
        response.json = MagicMock(side_effect=ValueError("not json"))
    return response


def _make_mock_client(response):
    mock_client = AsyncMock()
    mock_client.request = AsyncMock(return_value=response)
    mock_client_ctx = AsyncMock()
    mock_client_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_ctx.__aexit__ = AsyncMock(return_value=False)
    return mock_client_ctx, mock_client


# ── collect: success ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collect_get_success(channel):
    """Successful GET returns ChannelResult with items list."""
    response = _make_mock_response(json_data=[{"id": 1}, {"id": 2}])
    mock_client_ctx, _ = _make_mock_client(response)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {"base_url": "https://api.example.com", "endpoint": "/items"}, {}
        )

    assert result.success is True
    assert len(result.items) == 2
    assert result.items[0]["id"] == 1


@pytest.mark.asyncio
async def test_collect_result_path_navigation(channel):
    """result_path 'data.items' navigates two levels of nested dict."""
    json_data = {"data": {"items": [{"x": 1}, {"x": 2}]}}
    response = _make_mock_response(json_data=json_data)
    mock_client_ctx, _ = _make_mock_client(response)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {
                "base_url": "https://api.example.com",
                "endpoint": "/data",
                "result_path": "data.items",
            },
            {},
        )

    assert result.success is True
    assert len(result.items) == 2
    assert result.items[0]["x"] == 1


@pytest.mark.asyncio
async def test_collect_result_path_single_level(channel):
    """result_path with single key extracts nested list."""
    json_data = {"results": [{"name": "a"}, {"name": "b"}]}
    response = _make_mock_response(json_data=json_data)
    mock_client_ctx, _ = _make_mock_client(response)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {
                "base_url": "https://api.example.com",
                "endpoint": "/data",
                "result_path": "results",
            },
            {},
        )

    assert result.success is True
    assert len(result.items) == 2


@pytest.mark.asyncio
async def test_collect_non_list_response_wrapped(channel):
    """A single object response is wrapped in a list."""
    json_data = {"id": 42, "name": "single"}
    response = _make_mock_response(json_data=json_data)
    mock_client_ctx, _ = _make_mock_client(response)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {"base_url": "https://api.example.com", "endpoint": "/item/42"}, {}
        )

    assert result.success is True
    assert len(result.items) == 1
    assert result.items[0]["id"] == 42


@pytest.mark.asyncio
async def test_collect_post_method(channel):
    """POST request passes body as JSON and no query params."""
    json_data = [{"created": True}]
    response = _make_mock_response(json_data=json_data)
    mock_client_ctx, mock_client = _make_mock_client(response)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        await channel.collect(
            {
                "base_url": "https://api.example.com",
                "endpoint": "/create",
                "method": "POST",
                "body": {"key": "value"},
            },
            {},
        )

    call_kwargs = mock_client.request.call_args
    assert call_kwargs.kwargs.get("json") == {"key": "value"}
    assert call_kwargs.kwargs.get("params") is None


@pytest.mark.asyncio
async def test_collect_bearer_auth_header_sent(channel, monkeypatch):
    """Bearer auth config results in Authorization header being sent."""
    monkeypatch.setenv("MY_TOKEN", "test_token_xyz")
    json_data = [{"ok": True}]
    response = _make_mock_response(json_data=json_data)
    mock_client_ctx, mock_client = _make_mock_client(response)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {
                "base_url": "https://api.example.com",
                "endpoint": "/secure",
                "auth": {"type": "bearer", "token_env": "MY_TOKEN"},
            },
            {},
        )

    assert result.success is True
    call_kwargs = mock_client.request.call_args
    headers_arg = call_kwargs.kwargs.get("headers", {})
    assert headers_arg.get("Authorization") == "Bearer test_token_xyz"


# ── collect: error cases ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collect_timeout_returns_fail(channel):
    """TimeoutException yields a failed ChannelResult."""
    import httpx

    mock_client = AsyncMock()
    mock_client.request = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
    mock_client_ctx = AsyncMock()
    mock_client_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {"base_url": "https://api.example.com", "endpoint": "/slow"}, {}
        )

    assert result.success is False
    assert "timed out" in result.error.lower()


@pytest.mark.asyncio
async def test_collect_http_error_returns_fail(channel):
    """HTTP 500 error yields a failed ChannelResult."""
    import httpx

    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    mock_response.raise_for_status = MagicMock(
        side_effect=httpx.HTTPStatusError(
            message="Server Error",
            request=MagicMock(),
            response=MagicMock(status_code=500, text="Internal Server Error"),
        )
    )
    mock_client = AsyncMock()
    mock_client.request = AsyncMock(return_value=mock_response)
    mock_client_ctx = AsyncMock()
    mock_client_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {"base_url": "https://api.example.com", "endpoint": "/err"}, {}
        )

    assert result.success is False
    assert "500" in result.error


@pytest.mark.asyncio
async def test_collect_non_json_response_returns_fail(channel):
    """Non-JSON response body yields a failed ChannelResult."""
    response = _make_mock_response(json_data=None)
    mock_client_ctx, _ = _make_mock_client(response)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {"base_url": "https://api.example.com", "endpoint": "/html"}, {}
        )

    assert result.success is False
    assert "JSON" in result.error


@pytest.mark.asyncio
async def test_collect_generic_exception_returns_fail(channel):
    """Connection errors yield a failed ChannelResult."""
    mock_client = AsyncMock()
    mock_client.request = AsyncMock(side_effect=OSError("connection refused"))
    mock_client_ctx = AsyncMock()
    mock_client_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await channel.collect(
            {"base_url": "https://api.example.com", "endpoint": "/data"}, {}
        )

    assert result.success is False
    assert "failed" in result.error.lower()


# ── fetch(): thick-contract path ─────────────────────────────────────────────

class _FetchHttp:
    """Minimal stand-in for the runner's rate-limited client (request())."""

    def __init__(self, response):
        self._response = response
        self.calls = []

    async def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self._response


@pytest.mark.asyncio
async def test_fetch_prefers_stored_credential_over_inline_config(channel, monkeypatch):
    """A source migrated to the encrypted store resolves its bearer token from
    AuthManager, ignoring the (now-stale) inline token_env in channel_config."""
    monkeypatch.setenv("SHOULD_NOT_BE_USED", "inline-value")
    response = _make_mock_response(json_data=[{"ok": True}])
    http = _FetchHttp(response)
    ctx = FetchContext(
        config={
            "base_url": "https://api.example.com",
            "endpoint": "/secure",
            "auth": {"type": "bearer", "token_env": "SHOULD_NOT_BE_USED"},
        },
        params={},
        source_id="src-1",
        http=http,
    )

    with patch(
        "backend.auth.manager.AuthManager.resolve",
        AsyncMock(return_value={"token": "stored-secret"}),
    ):
        result = await channel.fetch(ctx)

    assert result.items == [{"ok": True}]
    headers = http.calls[0][2]["headers"]
    assert headers["Authorization"] == "Bearer stored-secret"


@pytest.mark.asyncio
async def test_fetch_falls_back_to_inline_config_when_no_stored_credential(channel, monkeypatch):
    """A source that hasn't migrated to the encrypted store keeps working exactly
    as before — env-indirected token, zero behaviour change."""
    monkeypatch.setenv("MY_TOKEN", "env-secret")
    response = _make_mock_response(json_data=[{"ok": True}])
    http = _FetchHttp(response)
    ctx = FetchContext(
        config={
            "base_url": "https://api.example.com",
            "endpoint": "/secure",
            "auth": {"type": "bearer", "token_env": "MY_TOKEN"},
        },
        params={},
        source_id="src-2",
        http=http,
    )

    with patch(
        "backend.auth.manager.AuthManager.resolve",
        AsyncMock(return_value={}),  # nothing stored for this source
    ):
        result = await channel.fetch(ctx)

    assert result.items == [{"ok": True}]
    assert http.calls[0][2]["headers"]["Authorization"] == "Bearer env-secret"


@pytest.mark.asyncio
async def test_fetch_no_source_id_skips_credential_store(channel, monkeypatch):
    """fetch() called standalone (no source_id, e.g. a config test/preview) never
    hits the DB — falls straight to the legacy inline/env resolution."""
    monkeypatch.setenv("MY_TOKEN", "env-secret")
    response = _make_mock_response(json_data=[{"ok": True}])
    http = _FetchHttp(response)
    ctx = FetchContext(
        config={
            "base_url": "https://api.example.com",
            "endpoint": "/secure",
            "auth": {"type": "bearer", "token_env": "MY_TOKEN"},
        },
        params={},
        source_id=None,
        http=http,
    )

    with patch("backend.auth.manager.AuthManager.resolve") as mock_resolve:
        result = await channel.fetch(ctx)

    mock_resolve.assert_not_called()
    assert http.calls[0][2]["headers"]["Authorization"] == "Bearer env-secret"


@pytest.mark.asyncio
async def test_fetch_forwards_configured_timeout_to_shared_client(channel):
    """ctx.http is the runner's shared client (fixed client-level timeout) — the
    per-source configured timeout must still be applied per-request, or a slow
    API silently gets the runner's default instead of what the user configured."""
    response = _make_mock_response(json_data=[{"ok": True}])
    http = _FetchHttp(response)
    ctx = FetchContext(
        config={"base_url": "https://api.example.com", "endpoint": "/slow", "timeout": 120},
        params={},
        http=http,
    )

    await channel.fetch(ctx)

    assert http.calls[0][2]["timeout"] == 120


@pytest.mark.asyncio
async def test_fetch_returns_url_and_status_code_metadata(channel):
    response = _make_mock_response(json_data=[{"id": 1}])
    http = _FetchHttp(response)
    ctx = FetchContext(
        config={"base_url": "https://api.example.com", "endpoint": "/items"},
        params={},
        http=http,
    )

    result = await channel.fetch(ctx)

    assert result.metadata == {"url": "https://api.example.com/items", "status_code": 200}


@pytest.mark.asyncio
async def test_fetch_result_path_navigation(channel):
    response = _make_mock_response(json_data={"data": {"items": [{"x": 1}, {"x": 2}]}})
    http = _FetchHttp(response)
    ctx = FetchContext(
        config={
            "base_url": "https://api.example.com",
            "endpoint": "/data",
            "result_path": "data.items",
        },
        params={},
        http=http,
    )

    result = await channel.fetch(ctx)

    assert len(result.items) == 2
    assert result.items[0]["x"] == 1


@pytest.mark.asyncio
async def test_fetch_timeout_raises_channel_fetch_error(channel):
    import httpx

    http = AsyncMock()
    http.request = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
    ctx = FetchContext(
        config={"base_url": "https://api.example.com", "endpoint": "/slow"},
        params={},
        http=http,
    )

    with pytest.raises(ChannelFetchError, match="timed out"):
        await channel.fetch(ctx)


@pytest.mark.asyncio
async def test_fetch_generic_exception_raises_channel_fetch_error(channel):
    """collect() has a generic except-Exception fallback (connection refused, DNS
    failure, ...); fetch() must have the same, or those errors bypass
    ChannelFetchError and the runner's retry/backoff contract entirely."""
    http = AsyncMock()
    http.request = AsyncMock(side_effect=OSError("connection refused"))
    ctx = FetchContext(
        config={"base_url": "https://api.example.com", "endpoint": "/data"},
        params={},
        http=http,
    )

    with pytest.raises(ChannelFetchError, match="connection refused"):
        await channel.fetch(ctx)


@pytest.mark.asyncio
async def test_fetch_http_error_raises_channel_fetch_error(channel):
    import httpx

    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    mock_response.raise_for_status = MagicMock(
        side_effect=httpx.HTTPStatusError(
            message="Server Error",
            request=MagicMock(),
            response=MagicMock(status_code=500, text="Internal Server Error"),
        )
    )
    http = AsyncMock()
    http.request = AsyncMock(return_value=mock_response)
    ctx = FetchContext(
        config={"base_url": "https://api.example.com", "endpoint": "/err"},
        params={},
        http=http,
    )

    with pytest.raises(ChannelFetchError, match="500"):
        await channel.fetch(ctx)
