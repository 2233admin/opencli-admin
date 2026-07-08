"""odp_client transport — payload shape and response parsing characterization.

``triple_to_event`` delegates to the mapper, but this test pins the literal wire
dict independently of the implementation so the forward contract is locked: a
later step moves this forward into an ``OdpSink`` and these bytes must not move.
"""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.channels.base import ChannelFetchError
from backend.pipeline import odp_client


def test_triple_to_event_pins_wire_shape():
    raw = {"title": "Hello", "extra": 1}
    normalized = {
        "title": "Hello",
        "url": "https://x/a",
        "content": "c",
        "author": "",
        "published_at": "2026-06-30T12:00:00Z",
        "source_id": "src-1",
    }
    event = odp_client.triple_to_event(
        channel_type="rss",
        source_id="src-1",
        task_id="task-1",
        raw=raw,
        normalized=normalized,
        content_hash="hash-1",
    )
    assert event == {
        "schema_version": 1,
        "provider": "opencli-admin/rss",
        "source_id": "src-1",
        "event_id": "hash-1",
        "ingest_mode": "snapshot",
        "source_ts": "2026-06-30T12:00:00Z",
        "cursor": None,
        "payload": normalized,
        "raw_data": raw,
        "trace_id": None,
        "task_id": "task-1",
    }


class _Resp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


def _client_cm(resp):
    client = AsyncMock()
    client.post = AsyncMock(return_value=resp)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm, client


@pytest.mark.asyncio
async def test_post_batch_posts_and_parses(monkeypatch):
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    cm, client = _client_cm(
        _Resp({"accepted": 2, "duplicates": 1, "rejected": 0, "errors": []})
    )
    events = [{"event_id": "a"}, {"event_id": "b"}]

    with patch("backend.pipeline.odp_client.httpx.AsyncClient", return_value=cm):
        result = await odp_client.post_batch(events, channel_type="rss")

    assert result == (2, 1, 0)
    client.post.assert_awaited_once()
    call = client.post.call_args
    assert call.args[0] == "http://odp:8040/v1/ingest/batch"
    assert call.kwargs["json"] == {"events": events}


@pytest.mark.asyncio
async def test_post_batch_noop_when_url_unset(monkeypatch):
    monkeypatch.delenv("ODP_INGEST_URL", raising=False)
    result = await odp_client.post_batch([{"event_id": "a"}], channel_type="rss")
    assert result == (0, 0, 0)


@pytest.mark.asyncio
async def test_post_batch_noop_when_no_events(monkeypatch):
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    result = await odp_client.post_batch([], channel_type="rss")
    assert result == (0, 0, 0)


@pytest.mark.asyncio
async def test_forward_triples_builds_events_and_posts(monkeypatch):
    normalized = {
        "title": "t",
        "url": "u",
        "content": "c",
        "author": "",
        "published_at": "2026-06-30T12:00:00Z",
        "source_id": "s",
    }
    triples = [({"title": "t"}, normalized, "hash-1")]

    post_mock = AsyncMock(return_value=(1, 0, 0))
    with patch("backend.pipeline.odp_client.post_batch", new=post_mock):
        result = await odp_client.forward_triples(
            channel_type="rss", task_id="task-1", source_id="s", triples=triples
        )

    assert result == (1, 0, 0)
    post_mock.assert_awaited_once()
    sent_events = post_mock.call_args.args[0]
    assert len(sent_events) == 1
    assert sent_events[0]["event_id"] == "hash-1"
    assert sent_events[0]["provider"] == "opencli-admin/rss"
    assert sent_events[0]["source_ts"] == "2026-06-30T12:00:00Z"


# ── P0-1: ODP sink 5xx/429 must classify retryable, not swallowed forever ────
#
# Bug: resp.raise_for_status() raised a raw httpx.HTTPStatusError, whose class
# name ("HTTPStatusError") is in neither error_taxonomy._RETRYABLE nor
# _PERMANENT — so effective_error_type()/is_retryable() treated a transient
# ODP 503 exactly like a permanent failure, and pipeline.py swallowed it into
# a success=False PipelineResult instead of letting Celery's autoretry_for
# see it. These tests mock httpx at the transport boundary (the client's
# .post response), not post_batch/forward_triples themselves, so the real
# raise_for_status() + classification code under test actually runs.

def _http_response(status_code: int, json_body: dict | None = None) -> httpx.Response:
    request = httpx.Request("POST", "http://odp:8040/v1/ingest/batch")
    return httpx.Response(
        status_code, json=json_body or {}, request=request
    )


@pytest.mark.asyncio
async def test_post_batch_5xx_classified_retryable(monkeypatch):
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    resp = _http_response(503)
    client = AsyncMock()
    client.post = AsyncMock(return_value=resp)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.pipeline.odp_client.httpx.AsyncClient", return_value=cm):
        with pytest.raises(ChannelFetchError) as exc_info:
            await odp_client.post_batch([{"event_id": "a"}], channel_type="rss")

    assert exc_info.value.error_type == "RetryableHTTPStatus"


@pytest.mark.asyncio
async def test_post_batch_429_classified_retryable(monkeypatch):
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    resp = _http_response(429)
    client = AsyncMock()
    client.post = AsyncMock(return_value=resp)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.pipeline.odp_client.httpx.AsyncClient", return_value=cm):
        with pytest.raises(ChannelFetchError) as exc_info:
            await odp_client.post_batch([{"event_id": "a"}], channel_type="rss")

    assert exc_info.value.error_type == "RetryableHTTPStatus"


@pytest.mark.asyncio
async def test_post_batch_400_classified_permanent(monkeypatch):
    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    resp = _http_response(400)
    client = AsyncMock()
    client.post = AsyncMock(return_value=resp)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.pipeline.odp_client.httpx.AsyncClient", return_value=cm):
        with pytest.raises(ChannelFetchError) as exc_info:
            await odp_client.post_batch([{"event_id": "a"}], channel_type="rss")

    assert exc_info.value.error_type == "PermanentHTTPStatus"


@pytest.mark.asyncio
async def test_post_batch_503_propagates_through_pipeline_taxonomy(monkeypatch):
    """End-to-end classification check: the exception raised out of
    post_batch on a 503 must be seen as retryable by the same taxonomy
    pipeline.py consults (effective_error_type + is_retryable), so a
    RetryableHTTPStatus 5xx propagates for Celery retry instead of getting
    swallowed."""
    from backend.pipeline.error_taxonomy import effective_error_type, is_retryable

    monkeypatch.setenv("ODP_INGEST_URL", "http://odp:8040")
    resp = _http_response(503)
    client = AsyncMock()
    client.post = AsyncMock(return_value=resp)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.pipeline.odp_client.httpx.AsyncClient", return_value=cm):
        try:
            await odp_client.post_batch([{"event_id": "a"}], channel_type="rss")
            assert False, "expected ChannelFetchError"
        except ChannelFetchError as exc:
            assert is_retryable(effective_error_type(exc)) is True
