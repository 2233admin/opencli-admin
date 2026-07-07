"""Workflow webhook delivery executor."""

from __future__ import annotations

from typing import Any

import httpx

from backend.notifiers.base import NotificationPayload
from backend.notifiers.registry import get_notifier

WEBHOOK_DELIVERY_EVENT = "workflow.evidence_batch.ready"
WEBHOOK_DELIVERY_PAYLOAD_SCHEMA = "workflow.webhook.evidence_batch.v1"


class WorkflowWebhookDeliveryError(RuntimeError):
    def __init__(self, code: str, message: str, details: dict[str, Any]) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


async def execute_workflow_webhook_delivery(
    binding_input: dict[str, Any],
    input_items: list[dict[str, Any]],
    *,
    workflow_id: str,
    run_id: str,
    node_id: str,
) -> dict[str, Any]:
    config = _webhook_config(binding_input)
    target = _read_string(binding_input.get("target")) or "webhook"
    payload = NotificationPayload(
        event=WEBHOOK_DELIVERY_EVENT,
        source_id=workflow_id,
        record_id=run_id,
        data={
            "schema": WEBHOOK_DELIVERY_PAYLOAD_SCHEMA,
            "workflowId": workflow_id,
            "workflowRunId": run_id,
            "nodeId": node_id,
            "target": target,
            "itemCount": len(input_items),
            "items": [_safe_delivery_item(item) for item in input_items],
        },
    )

    try:
        delivered = await get_notifier("webhook").send(config, payload)
    except WorkflowWebhookDeliveryError:
        raise
    except (httpx.HTTPError, OSError) as exc:
        # Network-level failures (connect errors, timeouts, DNS failures,
        # etc.) from the notifier's underlying HTTP client are not part of
        # its bool contract — without this, an unreachable webhook raises an
        # untyped exception here that isn't caught by the per-node
        # WorkflowWebhookDeliveryError handler in opencli_hda_tracer.py and
        # 500s the entire workflow run instead of failing just this node.
        raise WorkflowWebhookDeliveryError(
            code="webhook_delivery_network_error",
            message=f"Webhook delivery failed due to a network error: {exc}",
            details={
                "nodeId": node_id,
                "target": target,
                "itemCount": len(input_items),
                "payloadSchema": WEBHOOK_DELIVERY_PAYLOAD_SCHEMA,
            },
        ) from exc
    if not delivered:
        raise WorkflowWebhookDeliveryError(
            code="webhook_delivery_failed",
            message="Webhook delivery attempted but the notifier returned a failure.",
            details={
                "nodeId": node_id,
                "target": target,
                "itemCount": len(input_items),
                "payloadSchema": WEBHOOK_DELIVERY_PAYLOAD_SCHEMA,
            },
        )

    return {
        "notifierType": "webhook",
        "target": target,
        "deliveryAttempted": True,
        "delivered": True,
        "event": WEBHOOK_DELIVERY_EVENT,
        "payloadSchema": WEBHOOK_DELIVERY_PAYLOAD_SCHEMA,
        "itemCount": len(input_items),
    }


def _webhook_config(binding_input: dict[str, Any]) -> dict[str, Any]:
    config = _read_dict(binding_input.get("config"))
    url = _read_string(binding_input.get("url")) or _read_string(
        config.get("url")
    ) or _read_string(config.get("webhook_url"))
    if url:
        config = {**config, "url": url}
    return config


def _safe_delivery_item(item: dict[str, Any]) -> dict[str, Any]:
    raw = _read_dict(item.get("raw"))
    normalized = _read_dict(item.get("normalizedData"))
    return {
        "id": _read_string(raw.get("id"))
        or _read_string(normalized.get("id"))
        or _read_string(item.get("recordId")),
        "title": _read_string(raw.get("title")) or _read_string(normalized.get("title")),
        "url": _read_string(raw.get("url")) or _read_string(normalized.get("url")),
        "lineage": _read_dict_list(item.get("lineage")),
    }


def _read_string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _read_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _read_dict_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


__all__ = [
    "WEBHOOK_DELIVERY_EVENT",
    "WEBHOOK_DELIVERY_PAYLOAD_SCHEMA",
    "WorkflowWebhookDeliveryError",
    "execute_workflow_webhook_delivery",
]
