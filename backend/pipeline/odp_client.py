"""HTTP client for ODP ingest API (Rust hot path)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any
import httpx

logger = logging.getLogger(__name__)

INGEST_TIMEOUT = float(os.environ.get("ODP_INGEST_TIMEOUT", "10"))


def ingest_url() -> str | None:
    base = os.environ.get("ODP_INGEST_URL", "").strip().rstrip("/")
    return base or None


def _provider_for_channel(channel_type: str) -> str:
    return f"opencli-admin/{channel_type}"


def triple_to_event(
    *,
    channel_type: str,
    source_id: str,
    task_id: str,
    raw: dict[str, Any],
    normalized: dict[str, Any],
    content_hash: str,
) -> dict[str, Any]:
    published = normalized.get("published_at") or ""
    try:
        if published:
            source_ts = datetime.fromisoformat(published.replace("Z", "+00:00"))
            if source_ts.tzinfo is None:
                source_ts = source_ts.replace(tzinfo=timezone.utc)
        else:
            source_ts = datetime.now(timezone.utc)
    except ValueError:
        source_ts = datetime.now(timezone.utc)

    return {
        "schema_version": 1,
        "provider": _provider_for_channel(channel_type),
        "source_id": str(source_id),
        "event_id": content_hash,
        "ingest_mode": "snapshot",
        "source_ts": source_ts.isoformat().replace("+00:00", "Z"),
        "cursor": None,
        "payload": normalized,
        "raw_data": raw,
        "trace_id": None,
        "task_id": str(task_id),
    }


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
        resp.raise_for_status()
        data = resp.json()

    accepted = int(data.get("accepted", 0))
    duplicates = int(data.get("duplicates", 0))
    rejected = int(data.get("rejected", 0))
    logger.info(
        "odp ingest | channel=%s sent=%d accepted=%d duplicates=%d rejected=%d",
        channel_type,
        len(events),
        accepted,
        duplicates,
        rejected,
    )
    return accepted, duplicates, rejected


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