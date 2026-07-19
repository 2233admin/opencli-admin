"""Unit tests for the Claude (Anthropic) AI processor (AUDIT C8/C25: explicit
per-request timeout + bounded concurrency instead of a sequential
await-in-a-for-loop).

The SDK client is mocked at the ``anthropic.AsyncAnthropic`` class level,
same convention as tests/unit/llm/test_adapters.py — no real network call.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.processors.claude_processor import ClaudeProcessor


def _record(rec_id: str, content: str = "hello") -> MagicMock:
    record = MagicMock()
    record.id = rec_id
    record.normalized_data = {"content": content}
    return record


def _msg_response(text: str) -> SimpleNamespace:
    return SimpleNamespace(
        content=[SimpleNamespace(text=text)],
        usage=SimpleNamespace(input_tokens=1, output_tokens=1),
    )


# ── C8: explicit per-request timeout ────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_sets_explicit_timeout_from_settings_default():
    """Every call carries an explicit timeout instead of relying on the SDK's
    own (600s x 2 retries) default."""
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=_msg_response('{"a": 1}'))

    with patch("anthropic.AsyncAnthropic", return_value=mock_client):
        result = await ClaudeProcessor().process(
            records=[_record("r1")], prompt_template="{{content}}", config={}
        )

    assert result.success is True
    _, kwargs = mock_client.messages.create.call_args
    assert kwargs["timeout"] == 120  # Settings.llm_request_timeout_seconds default


@pytest.mark.asyncio
async def test_process_timeout_overridable_via_config():
    """An explicit ai_config["timeout"] wins over the settings default."""
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=_msg_response('{"a": 1}'))

    with patch("anthropic.AsyncAnthropic", return_value=mock_client):
        await ClaudeProcessor().process(
            records=[_record("r1")],
            prompt_template="{{content}}",
            config={"timeout": 45},
        )

    _, kwargs = mock_client.messages.create.call_args
    assert kwargs["timeout"] == 45


@pytest.mark.asyncio
async def test_process_timeout_configurable_via_settings_env(monkeypatch):
    """LLM_REQUEST_TIMEOUT_SECONDS env var changes the fallback default."""
    from backend.config import get_settings

    monkeypatch.setenv("LLM_REQUEST_TIMEOUT_SECONDS", "45")
    get_settings.cache_clear()
    try:
        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=_msg_response('{"a": 1}'))
        with patch("anthropic.AsyncAnthropic", return_value=mock_client):
            await ClaudeProcessor().process(
                records=[_record("r1")], prompt_template="{{content}}", config={}
            )
        _, kwargs = mock_client.messages.create.call_args
        assert kwargs["timeout"] == 45
    finally:
        get_settings.cache_clear()


# ── C25: bounded concurrency, order, failure isolation ──────────────────────

@pytest.mark.asyncio
async def test_process_bounds_concurrency_to_semaphore_limit(monkeypatch):
    """No more than LLM_MAX_CONCURRENCY records' LLM calls run at once, even
    when many records are enriched in one batch."""
    from backend.config import get_settings

    monkeypatch.setenv("LLM_MAX_CONCURRENCY", "2")
    get_settings.cache_clear()

    state = {"cur": 0, "peak": 0}

    async def fake_create(**kwargs):
        state["cur"] += 1
        state["peak"] = max(state["peak"], state["cur"])
        await asyncio.sleep(0.02)
        state["cur"] -= 1
        return _msg_response('{"ok": true}')

    mock_client = MagicMock()
    mock_client.messages.create = fake_create

    try:
        with patch("anthropic.AsyncAnthropic", return_value=mock_client):
            result = await ClaudeProcessor().process(
                records=[_record(f"r{i}") for i in range(6)],
                prompt_template="{{content}}",
                config={},
            )
    finally:
        get_settings.cache_clear()

    assert result.success is True
    assert len(result.enrichments) == 6
    assert state["peak"] <= 2


@pytest.mark.asyncio
async def test_process_preserves_record_order_despite_uneven_latency():
    """gather preserves input order regardless of which call finishes first —
    enrichments[i] must still correspond to records[i]."""
    delays = {"r0": 0.03, "r1": 0.0, "r2": 0.0}

    async def fake_create(**kwargs):
        rec_id = kwargs["messages"][0]["content"]
        await asyncio.sleep(delays[rec_id])
        return _msg_response(f'{{"seen": "{rec_id}"}}')

    mock_client = MagicMock()
    mock_client.messages.create = fake_create

    records = [
        _record("r0", content="r0"),
        _record("r1", content="r1"),
        _record("r2", content="r2"),
    ]

    with patch("anthropic.AsyncAnthropic", return_value=mock_client):
        result = await ClaudeProcessor().process(
            records=records, prompt_template="{{content}}", config={}
        )

    assert [e["seen"] for e in result.enrichments] == ["r0", "r1", "r2"]


@pytest.mark.asyncio
async def test_process_one_record_failure_does_not_abort_batch():
    """One record's LLM call raising must not prevent the other records in
    the same batch from being enriched."""

    async def fake_create(**kwargs):
        prompt = kwargs["messages"][0]["content"]
        if prompt == "boom":
            raise RuntimeError("gateway exploded")
        return _msg_response('{"ok": true}')

    mock_client = MagicMock()
    mock_client.messages.create = fake_create

    records = [
        _record("r0", content="ok"),
        _record("r1", content="boom"),
        _record("r2", content="ok"),
    ]

    with patch("anthropic.AsyncAnthropic", return_value=mock_client):
        result = await ClaudeProcessor().process(
            records=records, prompt_template="{{content}}", config={}
        )

    assert result.success is True
    assert len(result.enrichments) == 3
    assert result.enrichments[0] == {"ok": True}
    assert "error" in result.enrichments[1]
    assert "gateway exploded" in result.enrichments[1]["error"]
    assert result.enrichments[2] == {"ok": True}


@pytest.mark.asyncio
async def test_process_no_anthropic_package_returns_failed_result():
    """The pre-existing import-availability guard must still short-circuit
    cleanly (not raise) when the anthropic package isn't installed."""
    with patch.dict("sys.modules", {"anthropic": None}):
        result = await ClaudeProcessor().process(
            records=[_record("r1")], prompt_template="{{content}}", config={}
        )
    assert result.success is False
    assert "not installed" in result.error
