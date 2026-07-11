"""Live generic webhook delivery acceptance tests."""

from __future__ import annotations

import asyncio
import os
import re
import time

import httpx
import pytest

from backend.security.url_guard import SSRFValidationError, avalidate_public_url_and_ip
from backend.workflow.webhook_delivery import (
    WEBHOOK_DELIVERY_EVENT,
    WEBHOOK_DELIVERY_PAYLOAD_SCHEMA,
    execute_workflow_webhook_delivery,
)

WEBHOOK_SITE_TOKEN_API = "https://webhook.site/token"
WEBHOOK_SITE_URL_RE = re.compile(r"^https://webhook\.site/(?P<token>[0-9a-fA-F-]{36})(?:[/?#].*)?$")


@pytest.mark.live
@pytest.mark.asyncio
async def test_generic_webhook_live_delivery_posts_public_http_request() -> None:
    target_url, webhook_site_token = await _resolve_live_webhook_target()
    run_id = f"generic-webhook-live-{int(time.time())}"

    result = await execute_workflow_webhook_delivery(
        {
            "target": "generic-webhook-live",
            "url": target_url,
            "config": {"timeout": 30},
        },
        [
            {
                "raw": {
                    "id": "live-item-1",
                    "title": "WSL generic webhook live acceptance",
                    "url": "https://example.com/opencli-admin-backend/live-webhook",
                },
                "lineage": [{"source": "pytest-live", "runId": run_id}],
            }
        ],
        workflow_id="opencli-admin-backend",
        run_id=run_id,
        node_id="notify-webhook",
    )

    assert result == {
        "notifierType": "webhook",
        "target": "generic-webhook-live",
        "deliveryAttempted": True,
        "delivered": True,
        "event": WEBHOOK_DELIVERY_EVENT,
        "payloadSchema": WEBHOOK_DELIVERY_PAYLOAD_SCHEMA,
        "itemCount": 1,
    }

    if webhook_site_token:
        captured = await _read_webhook_site_latest_payload(webhook_site_token)
        assert captured["event"] == WEBHOOK_DELIVERY_EVENT
        assert captured["source_id"] == "opencli-admin-backend"
        assert captured["record_id"] == run_id
        assert captured["data"]["schema"] == WEBHOOK_DELIVERY_PAYLOAD_SCHEMA
        assert captured["data"]["nodeId"] == "notify-webhook"
        assert captured["data"]["items"][0]["title"] == "WSL generic webhook live acceptance"


async def _resolve_live_webhook_target() -> tuple[str, str | None]:
    configured_url = os.environ.get("OPENCLI_GENERIC_WEBHOOK_LIVE_URL", "").strip()
    if configured_url:
        return configured_url, _webhook_site_token_from_url(configured_url)

    try:
        await avalidate_public_url_and_ip(WEBHOOK_SITE_TOKEN_API)
    except SSRFValidationError as exc:
        pytest.skip(f"webhook.site is not safely reachable in this environment: {exc}")

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(WEBHOOK_SITE_TOKEN_API)
        response.raise_for_status()
        token = response.json()["uuid"]
    return f"https://webhook.site/{token}", token


def _webhook_site_token_from_url(url: str) -> str | None:
    match = WEBHOOK_SITE_URL_RE.match(url)
    return match.group("token") if match else None


async def _read_webhook_site_latest_payload(token: str) -> dict:
    latest_url = f"{WEBHOOK_SITE_TOKEN_API}/{token}/request/latest/raw"
    async with httpx.AsyncClient(timeout=30) as client:
        for _ in range(10):
            response = await client.get(latest_url, headers={"accept": "application/json"})
            if response.status_code == 200 and response.text.strip():
                return response.json()
            await asyncio.sleep(1)
    raise AssertionError("Webhook.site did not expose the latest request payload in time")
