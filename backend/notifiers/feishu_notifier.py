"""Feishu (Lark) webhook notifier."""

import base64
import hashlib
import hmac
import re
import time
from typing import Any

from backend.notifiers.base import AbstractNotifier, NotificationPayload
from backend.notifiers.registry import register_notifier
from backend.security.url_guard import SSRFValidationError, guarded_async_client

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def _render(template: str, data: dict[str, Any]) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: str(data.get(m.group(1), "")), template)


def _feishu_sign(secret: str, timestamp: int) -> str:
    """Generate Feishu webhook signature (加签)."""
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        string_to_sign.encode("utf-8"), digestmod=hashlib.sha256
    ).digest()
    return base64.b64encode(hmac_code).decode("utf-8")


@register_notifier
class FeishuNotifier(AbstractNotifier):
    """Send notifications to Feishu via incoming webhook (custom bot)."""

    notifier_type = "feishu"

    async def send(self, config: dict[str, Any], payload: NotificationPayload) -> bool:
        webhook_url: str = config.get("webhook_url", "")
        secret: str = config.get("secret", "")
        title_template: str = config.get("title", "【新采集】{{title}}")
        content_template: str = config.get(
            "content", "**来源**：{{source_id}}\n**标题**：{{title}}\n**链接**：{{url}}"
        )
        timeout: int = config.get("timeout", 15)

        try:
            # guarded_async_client validates webhook_url AND pins the
            # connection to the IP(s) that validation resolved (DNS-rebinding
            # TOCTOU closure — AUDIT B3 follow-up; see
            # backend.security.url_guard's module docstring).
            client, webhook_url = await guarded_async_client(webhook_url, timeout=timeout)
        except SSRFValidationError:
            return False

        data = {"source_id": payload.source_id, **(payload.data or {})}
        title = _render(title_template, data)
        content = _render(content_template, data)

        body: dict[str, Any] = {
            "msg_type": "post",
            "content": {
                "post": {
                    "zh_cn": {
                        "title": title,
                        "content": [[{"tag": "text", "text": content}]],
                    }
                }
            },
        }

        if secret:
            ts = int(time.time())
            body["timestamp"] = str(ts)
            body["sign"] = _feishu_sign(secret, ts)

        # follow_redirects left at httpx's default (False) — see webhook_notifier
        # for the SSRF-via-redirect reasoning.
        async with client as opened_client:
            resp = await opened_client.post(webhook_url, json=body)
            result = resp.json()
            return result.get("code", -1) == 0
