"""Pipeline Step 3: Persist normalized records, skipping duplicates."""

import logging
import os

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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
    forward_to_odp: bool = True,
) -> tuple[list[CollectedRecord], int]:
    """Insert new records; skip existing ones by content_hash.

    When ``ODP_INGEST_URL`` is set AND ``forward_to_odp`` is True, events are
    forwarded to the Rust ingest service first (hot path). SQLite/ORM write
    remains for pipeline AI/notify until those steps move to async
    ``record.committed`` consumers. ``DualSink`` passes ``forward_to_odp=False``
    so the legacy write does not double-send alongside ``OdpSink``.

    Returns (new_records, skipped_count).
    """
    if not normalized_triples:
        return [], 0

    if forward_to_odp and odp_client.ingest_url():
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
    # Dedup within this batch too: two triples can share a content_hash (e.g. two
    # CLI sub-commands that normalize to identical content). Without this, both
    # pass the existing_hashes check, both get added, and flush() fails the whole
    # batch atomically on the UNIQUE(source_id, content_hash) constraint.
    seen_in_batch: set[str] = set()

    for raw, normalized, content_hash in normalized_triples:
        if content_hash in existing_hashes or content_hash in seen_in_batch:
            skipped += 1
            continue
        seen_in_batch.add(content_hash)

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

    try:
        await session.flush()
    except IntegrityError:
        # A concurrent writer (e.g. a celery retry racing the original attempt)
        # inserted an overlapping content_hash between our existence check and
        # this flush. Re-check against the DB and insert survivors one at a
        # time so one collision doesn't lose the rest of an otherwise-new batch
        # (retries becoming real in PR-B makes this reachable in practice, not
        # just theoretical).
        await session.rollback()
        recheck = await session.execute(
            select(CollectedRecord.content_hash).where(
                CollectedRecord.source_id == source_id,
                CollectedRecord.content_hash.in_([r.content_hash for r in new_records]),
            )
        )
        already_there = {row[0] for row in recheck}
        survivors: list[CollectedRecord] = []
        for record in new_records:
            if record.content_hash in already_there:
                skipped += 1
                continue
            session.add(record)
            try:
                await session.flush()
                survivors.append(record)
            except IntegrityError:
                await session.rollback()
                skipped += 1
        new_records = survivors

    return new_records, skipped
