"""WeCom (企业微信) webhook notifier."""

import re
from typing import Any

from backend.notifiers.base import AbstractNotifier, NotificationPayload
from backend.notifiers.registry import register_notifier
from backend.security.url_guard import SSRFValidationError, guarded_async_client

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
            # guarded_async_client validates webhook_url AND pins the
            # connection to the IP(s) that validation resolved (DNS-rebinding
            # TOCTOU closure — AUDIT B3 follow-up; see
            # backend.security.url_guard's module docstring).
            client, webhook_url = await guarded_async_client(webhook_url, timeout=timeout)
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
        async with client as opened_client:
            resp = await opened_client.post(webhook_url, json=body)
            result = resp.json()
            return result.get("errcode", -1) == 0
