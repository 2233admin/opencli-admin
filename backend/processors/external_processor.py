"""External HTTP AI processor.

Generic adapter for agent runtimes that expose an HTTP surface (Pydantic AI,
dify, langflow, n8n, custom FastAPI workers, MCP-bridged agents). One POST
per record; the response JSON becomes that record's enrichment.

Required config:
    endpoint (str): full URL the processor POSTs to.

Optional config:
    timeout (float, default 60): per-request timeout in seconds.
    auth_header (str): full Authorization header value (e.g. "Bearer xyz").
    headers (dict): extra HTTP headers merged onto the request.
    agent_id (str): free-form identifier passed in the payload; useful when
        the external runtime hosts multiple agents.
    send_record (bool, default True): include the full normalized_data in
        the payload alongside the rendered prompt.
    response_schema (dict): JSON Schema validated against each response.
        On violation, the enrichment becomes a structured error record
        rather than corrupting downstream consumers. Recommended for
        production deployments to fail-fast on contract drift.

Request body per record:
    {
        "prompt": "<rendered prompt>",
        "record": { ... normalized_data ... },   # if send_record
        "agent_id": "<agent_id>",                # if set
        "trace_id": "<per-record uuid>"          # always
    }

Response must be a JSON object; it is stored verbatim as the enrichment.

Recognised optional fields on the response (passed through, never stripped):
    _meta (dict): backend-supplied accounting -- token usage, model name,
        cost, trace identifiers. When present, fields like
        ``_meta.input_tokens`` / ``_meta.output_tokens`` / ``_meta.model``
        are logged at INFO so observability stacks can aggregate them.

Non-2xx, non-JSON, non-dict, or schema-violating responses produce a
``{"error": "..."}`` enrichment for that record without aborting the batch.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import TYPE_CHECKING, Any

import httpx

from backend.processors.base import AbstractProcessor, ProcessingResult
from backend.processors.registry import register_processor

if TYPE_CHECKING:
    from backend.models.record import CollectedRecord

logger = logging.getLogger(__name__)

_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def _render(template: str, data: dict[str, Any]) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: str(data.get(m.group(1), "")), template)


def _build_validator(response_schema: dict[str, Any] | None):
    """Return a callable that raises on schema violation, or None."""
    if not response_schema:
        return None
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        logger.warning(
            "external_http: response_schema configured but jsonschema not "
            "installed; skipping validation"
        )
        return None
    validator = Draft202012Validator(response_schema)
    validator.check_schema(response_schema)
    return validator


def _log_meta(meta: dict[str, Any], trace_id: str, idx: int, total: int) -> None:
    """Emit structured log line for backend-reported usage."""
    if not isinstance(meta, dict):
        return
    logger.info(
        "external_http meta [%d/%d] trace=%s model=%s "
        "input_tokens=%s output_tokens=%s cost=%s",
        idx + 1,
        total,
        trace_id,
        meta.get("model"),
        meta.get("input_tokens"),
        meta.get("output_tokens"),
        meta.get("cost"),
    )


@register_processor
class ExternalProcessor(AbstractProcessor):
    """Process records by POSTing each one to an external agent endpoint."""

    processor_type = "external_http"

    async def process(
        self,
        records: list[CollectedRecord],
        prompt_template: str,
        config: dict[str, Any],
    ) -> ProcessingResult:
        endpoint = config.get("endpoint")
        if not endpoint:
            return ProcessingResult(
                success=False,
                error="external_http: 'endpoint' is required in config",
            )

        timeout = config.get("timeout", 60)
        auth_header = config.get("auth_header")
        extra_headers = config.get("headers") or {}
        agent_id = config.get("agent_id")
        send_record = config.get("send_record", True)
        validator = _build_validator(config.get("response_schema"))

        headers = {"content-type": "application/json", **extra_headers}
        if auth_header:
            headers["authorization"] = auth_header

        logger.info(
            "external_http processor | endpoint=%s agent_id=%s records=%d "
            "schema=%s",
            endpoint,
            agent_id or "(none)",
            len(records),
            "on" if validator else "off",
        )

        enrichments: list[dict[str, Any]] = []
        total_in = 0
        total_out = 0

        async with httpx.AsyncClient(timeout=timeout) as client:
            for i, record in enumerate(records):
                trace_id = uuid.uuid4().hex[:12]
                prompt = _render(prompt_template, record.normalized_data)
                payload: dict[str, Any] = {"prompt": prompt, "trace_id": trace_id}
                if send_record:
                    payload["record"] = record.normalized_data
                if agent_id:
                    payload["agent_id"] = agent_id

                try:
                    resp = await client.post(endpoint, json=payload, headers=headers)
                    resp.raise_for_status()
                    try:
                        enrichment = resp.json()
                    except json.JSONDecodeError:
                        enrichment = {"analysis": resp.text}
                    if not isinstance(enrichment, dict):
                        enrichment = {"analysis": enrichment}

                    if validator is not None:
                        errors = sorted(validator.iter_errors(enrichment), key=str)
                        if errors:
                            details = "; ".join(
                                f"{'.'.join(str(p) for p in e.absolute_path) or '<root>'}: "
                                f"{e.message}"
                                for e in errors[:5]
                            )
                            logger.warning(
                                "external_http schema violation [%d/%d] trace=%s "
                                "errors=%d details=%s",
                                i + 1,
                                len(records),
                                trace_id,
                                len(errors),
                                details,
                            )
                            enrichments.append(
                                {
                                    "error": "schema_violation",
                                    "details": details,
                                    "trace_id": trace_id,
                                    "raw_response": enrichment,
                                }
                            )
                            continue

                    meta = enrichment.get("_meta")
                    if isinstance(meta, dict):
                        _log_meta(meta, trace_id, i, len(records))
                        if isinstance(meta.get("input_tokens"), (int, float)):
                            total_in += int(meta["input_tokens"])
                        if isinstance(meta.get("output_tokens"), (int, float)):
                            total_out += int(meta["output_tokens"])

                    logger.info(
                        "external_http resp [%d/%d] trace=%s preview=%s",
                        i + 1,
                        len(records),
                        trace_id,
                        str(enrichment)[:200],
                    )
                    enrichments.append(enrichment)
                except Exception as exc:
                    logger.error(
                        "external_http error [%d/%d] trace=%s | %s",
                        i + 1,
                        len(records),
                        trace_id,
                        exc,
                    )
                    enrichments.append({"error": str(exc), "trace_id": trace_id})

        if total_in or total_out:
            logger.info(
                "external_http batch totals | input_tokens=%d output_tokens=%d "
                "endpoint=%s",
                total_in,
                total_out,
                endpoint,
            )

        return ProcessingResult(success=True, enrichments=enrichments)
