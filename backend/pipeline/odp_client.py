"""HTTP client for ODP ingest API (Rust hot path).

The wire shape (:class:`RecordEvent`) and the response
(:class:`OdpIngestResponse`) live in :mod:`backend.odp` as a typed mirror of the
Rust ``odp-contracts`` crate. This module is just the transport: build events
through the mapper, POST the batch, parse the response. One shape definition is
what lets a later step move this forward into an ``OdpSink`` behind a
characterization test proving the bytes are unchanged.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from backend.channels.base import ChannelFetchError
from backend.odp.mapper import RecordEventMapper
from backend.odp.schemas import OdpIngestResponse
from backend.pipeline.error_taxonomy import is_retryable_http_status

logger = logging.getLogger(__name__)

INGEST_TIMEOUT = float(os.environ.get("ODP_INGEST_TIMEOUT", "10"))


def ingest_url() -> str | None:
    base = os.environ.get("ODP_INGEST_URL", "").strip().rstrip("/")
    return base or None


def triple_to_event(
    *,
    channel_type: str,
    source_id: str,
    task_id: str,
    raw: dict[str, Any],
    normalized: dict[str, Any],
    content_hash: str,
) -> dict[str, Any]:
    """Normalized triple -> ODP wire event.

    Thin wrapper over :class:`RecordEventMapper` so the legacy forward path and
    the future ``OdpSink`` share exactly one shape definition.
    """
    return RecordEventMapper.from_triple(
        channel_type=channel_type,
        source_id=source_id,
        task_id=task_id,
        raw=raw,
        normalized=normalized,
        content_hash=content_hash,
    ).to_wire()


async def post_batch(
    events: list[dict[str, Any]],
    *,
    channel_type: str,
) -> tuple[int, int, int]:
    """POST events to odp-ingest. Returns (accepted, duplicates, rejected)."""
    url = ingest_url()
    if not url or not events:
        return 0, 0, 0

    endpoint = f"{url}/v1/ingest/batch"
    body = {"events": events}
    async with httpx.AsyncClient(timeout=INGEST_TIMEOUT) as client:
        resp = await client.post(endpoint, json=body)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # A raw HTTPStatusError classifies as neither retryable nor
            # permanent (effective_error_type falls back to the exception's
            # own class name, which is in neither frozenset in
            # error_taxonomy.py) — is_retryable() would return False and
            # pipeline.py would swallow a transient 503/429 into a
            # success=False PipelineResult, so Celery's autoretry_for never
            # fires. Reclassify by status code using the taxonomy's own
            # is_retryable_http_status() so 5xx/429 propagate for retry and
            # other 4xx stay permanent.
            error_type = (
                "RetryableHTTPStatus"
                if is_retryable_http_status(resp.status_code)
                else "PermanentHTTPStatus"
            )
            raise ChannelFetchError(
                f"odp-ingest returned {resp.status_code}: {exc}",
                error_type=error_type,
            ) from exc
        data = resp.json()

    parsed = OdpIngestResponse.from_wire(data)
    logger.info(
        "odp ingest | channel=%s sent=%d accepted=%d duplicates=%d rejected=%d",
        channel_type,
        len(events),
        parsed.accepted,
        parsed.duplicates,
        parsed.rejected,
    )
    return parsed.accepted, parsed.duplicates, parsed.rejected


async def forward_triples(
    *,
    channel_type: str,
    task_id: str,
    source_id: str,
    triples: list[tuple[dict, dict, str]],
) -> tuple[int, int, int]:
    events = [
        triple_to_event(
            channel_type=channel_type,
            source_id=source_id,
            task_id=task_id,
            raw=raw,
            normalized=normalized,
            content_hash=content_hash,
        )
        for raw, normalized, content_hash in triples
    ]
    return await post_batch(events, channel_type=channel_type)
