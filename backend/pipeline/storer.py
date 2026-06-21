"""Pipeline Step 3: Persist normalized records, skipping duplicates."""

import logging
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.record import CollectedRecord
from backend.pipeline import odp_client

logger = logging.getLogger(__name__)


async def store_records(
    session: AsyncSession,
    task_id: str,
    source_id: str,
    normalized_triples: list[tuple[dict, dict, str]],
    *,
    channel_type: str = "unknown",
) -> tuple[list[CollectedRecord], int]:
    """Insert new records; skip existing ones by content_hash.

    When ``ODP_INGEST_URL`` is set, events are forwarded to the Rust ingest
    service first (hot path). SQLite/ORM write remains for pipeline AI/notify
    until those steps move to async ``record.committed`` consumers.

    Returns (new_records, skipped_count).
    """
    if not normalized_triples:
        return [], 0

    if odp_client.ingest_url():
        try:
            await odp_client.forward_triples(
                channel_type=channel_type,
                task_id=task_id,
                source_id=source_id,
                triples=normalized_triples,
            )
        except Exception as exc:
            if os.environ.get("ODP_INGEST_REQUIRED", "").lower() in ("1", "true", "yes"):
                raise
            logger.warning("odp ingest forward failed (continuing sqlite path): %s", exc)

    # Collect all hashes to check for duplicates in one query
    hashes = [h for _, _, h in normalized_triples]
    result = await session.execute(
        select(CollectedRecord.content_hash).where(
            CollectedRecord.source_id == source_id,
            CollectedRecord.content_hash.in_(hashes),
        )
    )
    existing_hashes = {row[0] for row in result}

    new_records: list[CollectedRecord] = []
    skipped = 0

    for raw, normalized, content_hash in normalized_triples:
        if content_hash in existing_hashes:
            skipped += 1
            continue

        record = CollectedRecord(
            task_id=task_id,
            source_id=source_id,
            raw_data=raw,
            normalized_data=normalized,
            content_hash=content_hash,
            status="normalized",
        )
        session.add(record)
        new_records.append(record)

    await session.flush()
    return new_records, skipped
