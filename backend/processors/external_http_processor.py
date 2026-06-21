"""External HTTP processor for delegating enrichment to a local service."""

import json
import logging
import os
import re
from datetime import datetime
from typing import TYPE_CHECKING, Any

import httpx

from backend.processors.base import AbstractProcessor, ProcessingResult

if TYPE_CHECKING:
    from backend.models.record import CollectedRecord

logger = logging.getLogger(__name__)

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def _render(template: str, data: dict[str, Any]) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: str(data.get(m.group(1), "")), template)


def _merged_config(config: dict[str, Any]) -> dict[str, Any]:
    nested = config.get("config")
    if isinstance(nested, dict):
        return {**nested, **{k: v for k, v in config.items() if k != "config"}}
    return config


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def _record_payload(record: "CollectedRecord") -> dict[str, Any]:
    payload: dict[str, Any] = {
        "raw_data": _jsonable(getattr(record, "raw_data", {})),
        "normalized_data": _jsonable(getattr(record, "normalized_data", {})),
    }
    for attr in ("id", "task_id", "source_id", "status", "content_hash", "ai_enrichment"):
        value = getattr(record, attr, None)
        if value is not None:
            payload[attr] = _jsonable(value)
    return payload


# NOTE: intentionally NOT registered. The "external_http" processor_type is
# served by the more capable ExternalProcessor (backend/processors/external_processor.py),
# which adds response_schema validation, _meta token accounting and trace_id.
# This class is kept as an alternative implementation (merged from 2233admin/main).
# To activate it instead, re-add @register_processor here and drop it from
# ExternalProcessor.
class ExternalHTTPProcessor(AbstractProcessor):
    """Process records by POSTing them to an external HTTP enrichment service."""

    processor_type = "external_http"

    async def process(
        self,
        records: list["CollectedRecord"],
        prompt_template: str,
        config: dict[str, Any],
    ) -> ProcessingResult:
        cfg = _merged_config(config)
        endpoint = cfg.get("endpoint") or cfg.get("url")
        if not endpoint:
            return ProcessingResult(success=False, error="external_http endpoint is required")

        timeout = float(cfg.get("timeout", 60))
        headers = dict(cfg.get("headers", {}))
        auth_header = cfg.get("auth_header")
        auth_token = cfg.get("auth_token") or os.environ.get("AGENT_AUTH_TOKEN")
        if auth_header:
            headers["Authorization"] = os.path.expandvars(str(auth_header))
        elif auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        send_record = bool(cfg.get("send_record", True))
        agent_id = cfg.get("agent_id")
        enrichments: list[dict[str, Any]] = []

        logger.info("external_http processor | endpoint=%s records=%d", endpoint, len(records))
        async with httpx.AsyncClient(timeout=timeout) as client:
            for i, record in enumerate(records):
                context = {
                    **getattr(record, "raw_data", {}),
                    **getattr(record, "normalized_data", {}),
                }
                payload: dict[str, Any] = {
                    "prompt": _render(prompt_template, context),
                }
                if send_record:
                    payload["record"] = _record_payload(record)
                if agent_id:
                    payload["agent_id"] = agent_id

                try:
                    resp = await client.post(str(endpoint), json=payload, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    enrichment = data if isinstance(data, dict) else {"result": data}
                    enrichments.append(enrichment)
                    logger.info("external_http resp [%d/%d] | keys=%s",
                                i + 1, len(records), sorted(enrichment.keys()))
                except Exception as exc:
                    logger.error("external_http error [%d/%d] | %s", i + 1, len(records), exc)
                    enrichments.append({"error": str(exc)})

        return ProcessingResult(success=True, enrichments=enrichments)
