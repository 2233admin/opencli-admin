"""Unit tests for the external_http processor."""

from unittest.mock import MagicMock, patch

import pytest

from backend.processors.external_http_processor import ExternalHTTPProcessor
from backend.processors.registry import get_processor


def _record() -> MagicMock:
    record = MagicMock()
    record.id = "rec-1"
    record.task_id = "task-1"
    record.source_id = "source-1"
    record.status = "normalized"
    record.content_hash = "hash-1"
    record.ai_enrichment = None
    record.raw_data = {"source": "raw"}
    record.normalized_data = {
        "title": "Market note",
        "content": "Something happened",
        "author": "alice",
    }
    return record


def test_external_http_processor_registered():
    assert get_processor("external_http").processor_type == "external_http"


@pytest.mark.asyncio
async def test_external_http_processor_posts_prompt_and_record():
    captured: list[dict] = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"summary": "ok", "priority": 2}

    async def fake_post(self, url, json, headers):  # noqa: ARG001
        captured.append({"url": url, "json": json, "headers": headers})
        return FakeResponse()

    processor = ExternalHTTPProcessor()
    # This endpoint now runs through backend.security.url_guard (SSRF guard —
    # AUDIT item B3), which resolves the hostname via socket.getaddrinfo.
    # "agent-service" is a Docker Compose service name (resolves fine inside
    # the compose network in production) but isn't resolvable from this test
    # sandbox — fake a public-IP resolution so the test stays decoupled from
    # live DNS/network access entirely (same pattern as test_api_channel.py).
    with patch("httpx.AsyncClient.post", new=fake_post), patch(
        "socket.getaddrinfo", return_value=[(None, None, None, "", ("93.184.216.34", 0))]
    ):
        result = await processor.process(
            records=[_record()],
            prompt_template="Summarize {{title}} by {{author}}",
            config={
                "config": {
                    "endpoint": "http://agent-service:8088/process",
                    "timeout": 60,
                    "auth_token": "secret",
                    "agent_id": "investigative-tagger",
                }
            },
        )

    assert result.success is True
    assert result.enrichments == [{"summary": "ok", "priority": 2}]
    assert captured[0]["url"] == "http://agent-service:8088/process"
    assert captured[0]["headers"]["Authorization"] == "Bearer secret"
    assert captured[0]["json"]["prompt"] == "Summarize Market note by alice"
    assert captured[0]["json"]["agent_id"] == "investigative-tagger"
    assert captured[0]["json"]["record"]["normalized_data"]["title"] == "Market note"


@pytest.mark.asyncio
async def test_external_http_processor_requires_endpoint():
    result = await ExternalHTTPProcessor().process([_record()], "", {})

    assert result.success is False
    assert "endpoint" in result.error
