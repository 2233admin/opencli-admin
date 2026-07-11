"""Webhook notifier: POST JSON payload to a URL."""

import hashlib
import hmac
import json
import time
from typing import Any

from backend.notifiers.base import AbstractNotifier, NotificationPayload, NotificationSendResult
from backend.notifiers.registry import register_notifier
from backend.security.url_guard import SSRFValidationError, guarded_async_client


@register_notifier
class WebhookNotifier(AbstractNotifier):
    notifier_type = "webhook"

    async def send(
        self, config: dict[str, Any], payload: NotificationPayload
    ) -> NotificationSendResult:
        url: str = config.get("url", "")
        secret: str = config.get("secret", "")
        timeout: int = config.get("timeout", 15)
        extra_headers: dict = config.get("headers", {})

        try:
            # guarded_async_client validates url AND pins the connection to
            # the IP(s) that validation resolved (DNS-rebinding TOCTOU
            # closure — AUDIT B3 follow-up; see backend.security.url_guard's
            # module docstring). TLS/SNI/cert verification are unaffected.
            client, url = await guarded_async_client(url, timeout=timeout)
        except SSRFValidationError:
            return False

        body = {
            "event": payload.event,
            "source_id": payload.source_id,
            "delivery_id": payload.delivery_id,
            "record_id": payload.record_id,
            "data": payload.data,
            "ai_enrichment": payload.ai_enrichment,
            "timestamp": int(time.time()),
        }
        body_bytes = json.dumps(body).encode()

        headers = {"Content-Type": "application/json", **extra_headers}
        if secret:
            sig = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
            headers["X-Signature-256"] = f"sha256={sig}"

        # httpx.AsyncClient defaults follow_redirects=False — kept unset
        # deliberately so a validated URL can't 30x-redirect to a private/
        # loopback/fleet address (SSRF via redirect).
        async with client as opened_client:
            response = await opened_client.post(url, content=body_bytes, headers=headers)
            return NotificationSendResult(
                success=response.is_success,
                response_data={
                    "status_code": response.status_code,
                    "body": response.text[:1000],
                },
            )
