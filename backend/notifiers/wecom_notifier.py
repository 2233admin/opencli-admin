"""WeCom (企业微信) webhook notifier."""

import re
from typing import Any

import httpx

from backend.notifiers.base import AbstractNotifier, NotificationPayload
from backend.notifiers.registry import register_notifier
from backend.security.url_guard import SSRFValidationError, avalidate_public_url

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def _render(template: str, data: dict[str, Any]) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: str(data.get(m.group(1), "")), template)


@register_notifier
class WeComNotifier(AbstractNotifier):
    """Send notifications to WeCom (企业微信) via group robot webhook."""

    notifier_type = "wecom"

    async def send(self, config: dict[str, Any], payload: NotificationPayload) -> bool:
        webhook_url: str = config.get("webhook_url", "")
        content_template: str = config.get(
            "content",
            "**{{title}}**\nSource: {{source_id}}",
        )
        timeout: int = config.get("timeout", 15)

        try:
            webhook_url = await avalidate_public_url(webhook_url)
        except SSRFValidationError:
            return False

        data = {"source_id": payload.source_id, **(payload.data or {})}
        content = _render(content_template, data)

        body = {
            "msgtype": "markdown",
            "markdown": {"content": content},
        }

        # follow_redirects left at httpx's default (False) — see webhook_notifier
        # for the SSRF-via-redirect reasoning.
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(webhook_url, json=body)
            result = resp.json()
            return result.get("errcode", -1) == 0
