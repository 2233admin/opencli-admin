"""Unit tests for backend.skills.distill.call_llm's provider-allowlist SSRF
wiring (backend.security.url_guard's "Provider allowlist" entry points).

Not a test of the distillation prompt / JSON-extraction logic itself — that
lives behind call_llm and is exercised (with call_llm stubbed) by
tests/skills/test_correction.py. These tests call the real call_llm against a
tiny local HTTP server so the guard/pinning wiring is proven with a genuine
request/response round trip rather than a mock.

Runs under the default ``pytest -m "not live"``; ``asyncio_mode = "auto"``.
"""

import http.server
import json
import threading

import pytest

from backend.config import get_settings
from backend.security.url_guard import SSRFValidationError
from backend.skills import distill


@pytest.fixture
def provider_allowlist_env(monkeypatch):
    """Set PROVIDER_URL_ALLOWLIST for one test and clear the settings cache
    both before use and on teardown (get_settings() is @lru_cache'd, so a
    stale Settings instance would otherwise leak into later tests)."""

    def _set(value: str) -> None:
        monkeypatch.setenv("PROVIDER_URL_ALLOWLIST", value)
        get_settings.cache_clear()

    yield _set
    get_settings.cache_clear()


def _run_openai_shaped_server(content: str):
    """Tiny local HTTP server answering any POST with a fixed
    OpenAI-chat-completions-shaped JSON body. Returns (server, port)."""

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 - stdlib method name
            length = int(self.headers.get("Content-Length", 0))
            self.rfile.read(length)
            body = json.dumps({"choices": [{"message": {"content": content}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):  # noqa: A002 - stdlib signature
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


async def test_call_llm_allowlisted_local_endpoint_completes_request(provider_allowlist_env):
    """The core behaviour change: an explicitly-configured local endpoint
    (not the hardcoded default string, so it would otherwise hit the SSRF
    guard) completes a real request once its host:port is allowlisted."""
    server, port = _run_openai_shaped_server("hello from local model")
    try:
        provider_allowlist_env(f"127.0.0.1:{port}")
        reply = await distill.call_llm(
            "system prompt",
            "user prompt",
            provider={"base_url": f"http://127.0.0.1:{port}/v1", "model": "qwen3:4b"},
        )
        assert reply == "hello from local model"
    finally:
        server.shutdown()


async def test_call_llm_non_allowlisted_loopback_still_rejected(provider_allowlist_env):
    """Regression guarantee: an explicitly-configured loopback base_url that
    is NOT the hardcoded default string, and NOT on the (empty, default)
    allowlist, is rejected exactly as before this feature existed."""
    provider_allowlist_env("")  # explicit default, independent of ambient env
    with pytest.raises(SSRFValidationError, match="non-public"):
        await distill.call_llm(
            "s", "u", provider={"base_url": "http://127.0.0.1:19999/v1", "model": "m"}
        )


async def test_call_llm_allowlist_configured_for_different_host_still_rejects(
    provider_allowlist_env,
):
    """An allowlist entry for a different host:port must not accidentally
    cover this one — exact match only."""
    provider_allowlist_env("127.0.0.1:11434")
    with pytest.raises(SSRFValidationError, match="non-public"):
        await distill.call_llm(
            "s", "u", provider={"base_url": "http://127.0.0.1:19999/v1", "model": "m"}
        )


async def test_call_llm_hardcoded_default_bypass_unaffected_by_allowlist(provider_allowlist_env):
    """The pre-existing hardcoded-default-Ollama exemption (base_url exactly
    equal to _DEFAULT_PROVIDER["base_url"]) is untouched by this feature: it
    still bypasses the guard entirely even when the allowlist is empty and
    does not name this endpoint — proven by pointing the *hardcoded* default
    string at a real local server (rather than the usual real Ollama) and
    confirming the request completes with no allowlist configured."""
    provider_allowlist_env("")
    server, port = _run_openai_shaped_server("default path reply")
    try:
        # Monkeypatch the module-level default to this test server's port so
        # the exact-string-equality branch is exercised without depending on
        # a real Ollama instance being present.
        original_default = dict(distill._DEFAULT_PROVIDER)
        distill._DEFAULT_PROVIDER["base_url"] = f"http://127.0.0.1:{port}/v1"
        try:
            reply = await distill.call_llm(
                "s", "u", provider={}  # no base_url -> falls back to the hardcoded default
            )
            assert reply == "default path reply"
        finally:
            distill._DEFAULT_PROVIDER.clear()
            distill._DEFAULT_PROVIDER.update(original_default)
    finally:
        server.shutdown()
