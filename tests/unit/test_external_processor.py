"""Unit tests for external_http processor."""

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.processors.external_processor import ExternalProcessor
from backend.processors.registry import get_processor


def _make_record(normalized: dict) -> SimpleNamespace:
    return SimpleNamespace(normalized_data=normalized)


def _mock_async_client(post_side_effect):
    client = MagicMock()
    client.post = AsyncMock(side_effect=post_side_effect)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=None)
    return ctx, client


def _mock_response(status_code: int, json_body=None, text: str = ""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    if json_body is not None:
        resp.json = MagicMock(return_value=json_body)
    else:
        resp.json = MagicMock(side_effect=ValueError("not json"))
    if 200 <= status_code < 300:
        resp.raise_for_status = MagicMock()
    else:
        resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                f"HTTP {status_code}", request=MagicMock(), response=resp
            )
        )
    return resp


def test_external_processor_registered():
    proc = get_processor("external_http")
    assert proc.processor_type == "external_http"
    assert isinstance(proc, ExternalProcessor)


@pytest.mark.asyncio
async def test_missing_endpoint_returns_error():
    proc = ExternalProcessor()
    result = await proc.process([_make_record({"title": "x"})], "p", {})
    assert result.success is False
    assert "endpoint" in (result.error or "")


@pytest.mark.asyncio
async def test_happy_path_renders_prompt_and_returns_enrichment():
    proc = ExternalProcessor()
    records = [_make_record({"title": "Hello", "content": "Body"})]
    resp = _mock_response(200, {"tags": ["news"], "summary": "OK"})
    ctx, client = _mock_async_client(post_side_effect=[resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        result = await proc.process(
            records, "T={{title}} C={{content}}", {"endpoint": "http://x/process"}
        )

    assert result.success is True
    assert result.enrichments == [{"tags": ["news"], "summary": "OK"}]
    call = client.post.await_args
    assert call.args[0] == "http://x/process"
    payload = call.kwargs["json"]
    assert payload["prompt"] == "T=Hello C=Body"
    assert payload["record"] == {"title": "Hello", "content": "Body"}
    assert "agent_id" not in payload
    assert isinstance(payload["trace_id"], str) and len(payload["trace_id"]) >= 8


@pytest.mark.asyncio
async def test_agent_id_and_auth_propagate():
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"})]
    resp = _mock_response(200, {"ok": True})
    ctx, client = _mock_async_client(post_side_effect=[resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        await proc.process(
            records,
            "t",
            {
                "endpoint": "http://x",
                "agent_id": "tagger-v1",
                "auth_header": "Bearer abc",
                "headers": {"x-trace": "1"},
                "send_record": False,
            },
        )

    call = client.post.await_args
    assert call.kwargs["json"]["agent_id"] == "tagger-v1"
    assert "record" not in call.kwargs["json"]
    headers = call.kwargs["headers"]
    assert headers["authorization"] == "Bearer abc"
    assert headers["x-trace"] == "1"


@pytest.mark.asyncio
async def test_per_record_error_does_not_abort_batch():
    proc = ExternalProcessor()
    records = [_make_record({"title": "a"}), _make_record({"title": "b"})]
    ok_resp = _mock_response(200, {"summary": "good"})
    bad_resp = _mock_response(500, text="boom")
    ctx, _client = _mock_async_client(post_side_effect=[bad_resp, ok_resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        result = await proc.process(records, "t", {"endpoint": "http://x"})

    assert result.success is True
    assert "error" in result.enrichments[0]
    assert "trace_id" in result.enrichments[0]
    assert result.enrichments[1] == {"summary": "good"}


@pytest.mark.asyncio
async def test_non_dict_json_wrapped_in_analysis():
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"})]
    resp = _mock_response(200, ["tag-a", "tag-b"])
    ctx, _client = _mock_async_client(post_side_effect=[resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        result = await proc.process(records, "t", {"endpoint": "http://x"})

    assert result.enrichments[0] == {"analysis": ["tag-a", "tag-b"]}


# ---------------------------------------------------------------------------
# response_schema validation
# ---------------------------------------------------------------------------

_TAGGER_SCHEMA = {
    "type": "object",
    "required": ["tags", "summary"],
    "properties": {
        "tags": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
        "priority": {"type": "integer", "minimum": 1, "maximum": 5},
    },
}


@pytest.mark.asyncio
async def test_response_schema_pass_returns_enrichment_unchanged():
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"})]
    good = {"tags": ["ai"], "summary": "ok", "priority": 3}
    resp = _mock_response(200, good)
    ctx, _client = _mock_async_client(post_side_effect=[resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        result = await proc.process(
            records,
            "t",
            {"endpoint": "http://x", "response_schema": _TAGGER_SCHEMA},
        )

    assert result.enrichments == [good]


@pytest.mark.asyncio
async def test_response_schema_violation_produces_error_enrichment():
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"})]
    bad = {"tags": ["ai"]}  # missing 'summary'
    resp = _mock_response(200, bad)
    ctx, _client = _mock_async_client(post_side_effect=[resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        result = await proc.process(
            records,
            "t",
            {"endpoint": "http://x", "response_schema": _TAGGER_SCHEMA},
        )

    enrichment = result.enrichments[0]
    assert enrichment["error"] == "schema_violation"
    assert "summary" in enrichment["details"]
    assert enrichment["raw_response"] == bad
    assert "trace_id" in enrichment


@pytest.mark.asyncio
async def test_response_schema_type_violation_captured():
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"})]
    # priority should be int, sent string
    bad = {"tags": ["x"], "summary": "ok", "priority": "high"}
    resp = _mock_response(200, bad)
    ctx, _client = _mock_async_client(post_side_effect=[resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        result = await proc.process(
            records,
            "t",
            {"endpoint": "http://x", "response_schema": _TAGGER_SCHEMA},
        )

    assert result.enrichments[0]["error"] == "schema_violation"


# ---------------------------------------------------------------------------
# _meta accounting
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_meta_field_preserved_in_enrichment():
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"})]
    body = {
        "tags": ["ai"],
        "summary": "ok",
        "_meta": {
            "model": "claude-haiku-4-5",
            "input_tokens": 123,
            "output_tokens": 45,
            "cost": 0.0012,
        },
    }
    resp = _mock_response(200, body)
    ctx, _client = _mock_async_client(post_side_effect=[resp])

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        result = await proc.process(records, "t", {"endpoint": "http://x"})

    assert result.enrichments[0]["_meta"]["input_tokens"] == 123
    assert result.enrichments[0]["_meta"]["model"] == "claude-haiku-4-5"


@pytest.mark.asyncio
async def test_meta_token_totals_logged(caplog: pytest.LogCaptureFixture):
    proc = ExternalProcessor()
    records = [_make_record({"title": "a"}), _make_record({"title": "b"})]
    responses = [
        _mock_response(200, {"_meta": {"input_tokens": 100, "output_tokens": 30}}),
        _mock_response(200, {"_meta": {"input_tokens": 50, "output_tokens": 10}}),
    ]
    ctx, _client = _mock_async_client(post_side_effect=responses)

    with caplog.at_level(logging.INFO, logger="backend.processors.external_processor"):
        with patch(
            "backend.processors.external_processor.httpx.AsyncClient",
            return_value=ctx,
        ):
            await proc.process(records, "t", {"endpoint": "http://x"})

    totals_line = [r for r in caplog.records if "batch totals" in r.getMessage()]
    assert totals_line, "expected one batch totals line"
    msg = totals_line[0].getMessage()
    assert "input_tokens=150" in msg
    assert "output_tokens=40" in msg


@pytest.mark.asyncio
async def test_meta_absent_does_not_log_totals(caplog: pytest.LogCaptureFixture):
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"})]
    resp = _mock_response(200, {"tags": ["x"], "summary": "y"})
    ctx, _client = _mock_async_client(post_side_effect=[resp])

    with caplog.at_level(logging.INFO, logger="backend.processors.external_processor"):
        with patch(
            "backend.processors.external_processor.httpx.AsyncClient",
            return_value=ctx,
        ):
            await proc.process(records, "t", {"endpoint": "http://x"})

    totals_line = [r for r in caplog.records if "batch totals" in r.getMessage()]
    assert not totals_line


@pytest.mark.asyncio
async def test_trace_id_propagates_in_payload():
    proc = ExternalProcessor()
    records = [_make_record({"title": "x"}), _make_record({"title": "y"})]
    responses = [
        _mock_response(200, {"summary": "a"}),
        _mock_response(200, {"summary": "b"}),
    ]
    ctx, client = _mock_async_client(post_side_effect=responses)

    with patch("backend.processors.external_processor.httpx.AsyncClient", return_value=ctx):
        await proc.process(records, "t", {"endpoint": "http://x"})

    calls = client.post.await_args_list
    trace_ids = [c.kwargs["json"]["trace_id"] for c in calls]
    assert all(isinstance(t, str) and len(t) >= 8 for t in trace_ids)
    assert trace_ids[0] != trace_ids[1]
