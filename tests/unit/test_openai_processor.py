"""Unit tests for OpenAIProcessor's provider-allowlist SSRF wiring.

backend/processors/openai_processor.py is coverage-omitted (pyproject.toml —
"AI processors (require API keys)"), so these aren't needed for the coverage
gate; they exist to prove the same guard-call swap made in
backend.skills.distill / backend.channels.skill_channel didn't regress this
third call site. records=[] means the per-record chat.completions.create
loop body never runs, so no network access is needed beyond client
construction (openai.AsyncOpenAI is swapped for a capturing stand-in).
"""

from types import SimpleNamespace

import pytest

from backend.config import get_settings
from backend.processors.openai_processor import OpenAIProcessor
from backend.security.url_guard import PinnedAsyncHTTPTransport


@pytest.fixture
def provider_allowlist_env(monkeypatch):
    def _set(value: str) -> None:
        monkeypatch.setenv("PROVIDER_URL_ALLOWLIST", value)
        get_settings.cache_clear()

    yield _set
    get_settings.cache_clear()


class _CapturingAsyncOpenAI:
    last_kwargs: dict | None = None

    def __init__(self, **kwargs):
        _CapturingAsyncOpenAI.last_kwargs = kwargs
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=None))


async def test_openai_processor_allowlisted_loopback_skips_pinning(
    monkeypatch, provider_allowlist_env
):
    import openai

    provider_allowlist_env("127.0.0.1:11434")
    monkeypatch.setattr(openai, "AsyncOpenAI", _CapturingAsyncOpenAI)

    result = await OpenAIProcessor().process(
        records=[],
        prompt_template="{{title}}",
        config={"base_url": "http://127.0.0.1:11434/v1", "api_key": "x", "model": "qwen3:4b"},
    )

    assert result.success is True
    assert _CapturingAsyncOpenAI.last_kwargs["base_url"] == "http://127.0.0.1:11434/v1"
    assert _CapturingAsyncOpenAI.last_kwargs["http_client"] is None


async def test_openai_processor_non_allowlisted_loopback_rejected(provider_allowlist_env):
    provider_allowlist_env("")  # explicit default, independent of ambient env

    result = await OpenAIProcessor().process(
        records=[],
        prompt_template="{{title}}",
        config={"base_url": "http://127.0.0.1:11434/v1", "api_key": "x", "model": "m"},
    )

    assert result.success is False
    assert "base_url rejected" in (result.error or "")


async def test_openai_processor_public_ip_still_pinned_when_not_allowlisted(
    monkeypatch, provider_allowlist_env
):
    import openai

    provider_allowlist_env("127.0.0.1:11434")  # configured, but for a different host
    monkeypatch.setattr(openai, "AsyncOpenAI", _CapturingAsyncOpenAI)

    result = await OpenAIProcessor().process(
        records=[],
        prompt_template="{{title}}",
        config={"base_url": "http://8.8.8.8:1234/v1", "api_key": "x", "model": "m"},
    )

    assert result.success is True
    http_client = _CapturingAsyncOpenAI.last_kwargs["http_client"]
    assert http_client is not None
    assert isinstance(http_client._transport, PinnedAsyncHTTPTransport)
    await http_client.aclose()
