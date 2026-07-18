"""Unit tests for the local (Ollama/vLLM) AI processor (AUDIT C8/C25:
settings-driven timeout default + bounded concurrency instead of a
sequential await-in-a-for-loop).

httpx.AsyncClient is mocked at the class level, same convention as
tests/unit/channels/test_rss_channel.py / test_web_scraper_channel.py — no
real network call.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.processors.local_processor import LocalProcessor


def _record(rec_id: str, content: str = "hello") -> MagicMock:
    record = MagicMock()
    record.id = rec_id
    record.normalized_data = {"content": content}
    return record


def _make_client_ctx(post_impl):
    mock_client = AsyncMock()
    mock_client.post = post_impl
    mock_client_ctx = AsyncMock()
    mock_client_ctx.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client_ctx.__aexit__ = AsyncMock(return_value=False)
    return mock_client_ctx


def _ok_response(payload):
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value=payload)
    return resp


# ── C8: client timeout default sourced from settings ────────────────────────

@pytest.mark.asyncio
async def test_process_client_timeout_defaults_from_settings():
    captured = {}

    def fake_ctor(**kwargs):
        captured.update(kwargs)
        return _make_client_ctx(AsyncMock(return_value=_ok_response({"response": "{}"})))

    with patch("httpx.AsyncClient", side_effect=fake_ctor):
        result = await LocalProcessor().process(
            records=[_record("r1")], prompt_template="{{content}}", config={}
        )

    assert result.success is True
    assert captured["timeout"] == 120  # Settings.llm_request_timeout_seconds default


@pytest.mark.asyncio
async def test_process_client_timeout_overridable_via_config():
    captured = {}

    def fake_ctor(**kwargs):
        captured.update(kwargs)
        return _make_client_ctx(AsyncMock(return_value=_ok_response({"response": "{}"})))

    with patch("httpx.AsyncClient", side_effect=fake_ctor):
        await LocalProcessor().process(
            records=[_record("r1")],
            prompt_template="{{content}}",
            config={"timeout": 30},
        )

    assert captured["timeout"] == 30


@pytest.mark.asyncio
async def test_process_client_timeout_configurable_via_settings_env(monkeypatch):
    from backend.config import get_settings

    monkeypatch.setenv("LLM_REQUEST_TIMEOUT_SECONDS", "45")
    get_settings.cache_clear()
    captured = {}

    def fake_ctor(**kwargs):
        captured.update(kwargs)
        return _make_client_ctx(AsyncMock(return_value=_ok_response({"response": "{}"})))

    try:
        with patch("httpx.AsyncClient", side_effect=fake_ctor):
            await LocalProcessor().process(
                records=[_record("r1")], prompt_template="{{content}}", config={}
            )
        assert captured["timeout"] == 45
    finally:
        get_settings.cache_clear()


# ── C25: bounded concurrency, order, failure isolation ──────────────────────

@pytest.mark.asyncio
async def test_process_bounds_concurrency_to_semaphore_limit(monkeypatch):
    from backend.config import get_settings

    monkeypatch.setenv("LLM_MAX_CONCURRENCY", "2")
    get_settings.cache_clear()

    state = {"cur": 0, "peak": 0}

    async def fake_post(url, json):
        state["cur"] += 1
        state["peak"] = max(state["peak"], state["cur"])
        await asyncio.sleep(0.02)
        state["cur"] -= 1
        return _ok_response({"response": '{"ok": true}'})

    mock_client_ctx = _make_client_ctx(fake_post)

    try:
        with patch("httpx.AsyncClient", return_value=mock_client_ctx):
            result = await LocalProcessor().process(
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
    delays = {"r0": 0.03, "r1": 0.0, "r2": 0.0}

    async def fake_post(url, json):
        rec_id = json["prompt"]
        await asyncio.sleep(delays[rec_id])
        return _ok_response({"response": f'{{"seen": "{rec_id}"}}'})

    mock_client_ctx = _make_client_ctx(fake_post)

    records = [
        _record("r0", content="r0"),
        _record("r1", content="r1"),
        _record("r2", content="r2"),
    ]

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await LocalProcessor().process(
            records=records, prompt_template="{{content}}", config={}
        )

    assert [e["seen"] for e in result.enrichments] == ["r0", "r1", "r2"]


@pytest.mark.asyncio
async def test_process_one_record_failure_does_not_abort_batch():
    async def fake_post(url, json):
        if json["prompt"] == "boom":
            raise RuntimeError("connection reset")
        return _ok_response({"response": '{"ok": true}'})

    mock_client_ctx = _make_client_ctx(fake_post)

    records = [
        _record("r0", content="ok"),
        _record("r1", content="boom"),
        _record("r2", content="ok"),
    ]

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await LocalProcessor().process(
            records=records, prompt_template="{{content}}", config={}
        )

    assert result.success is True
    assert len(result.enrichments) == 3
    assert result.enrichments[0] == {"ok": True}
    assert "error" in result.enrichments[1]
    assert "connection reset" in result.enrichments[1]["error"]
    assert result.enrichments[2] == {"ok": True}


@pytest.mark.asyncio
async def test_process_openai_compatible_api_style_posts_chat_completions():
    """api_style="openai" hits /v1/chat/completions with the OpenAI shape —
    unaffected by the C8/C25 changes."""
    captured = {}

    async def fake_post(url, json):
        captured["url"] = url
        captured["json"] = json
        return _ok_response({"choices": [{"message": {"content": '{"ok": true}'}}]})

    mock_client_ctx = _make_client_ctx(fake_post)

    with patch("httpx.AsyncClient", return_value=mock_client_ctx):
        result = await LocalProcessor().process(
            records=[_record("r1")],
            prompt_template="{{content}}",
            config={"api_style": "openai"},
        )

    assert result.success is True
    assert captured["url"] == "/v1/chat/completions"
    assert result.enrichments == [{"ok": True}]
