"""Pipeline Step 3: Persist normalized records, skipping duplicates."""

import logging
import os

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.record import CollectedRecord
from backend.pipeline import odp_client

logger = logging.getLogger(__name__)

# SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999 on older builds (32766 on
# newer ones, but we can't assume the deployment target). A collection batch
# (MAX_PAGES worth of items) can exceed that in one content_hash IN(...), so
# chunk the lookup instead of binding one variable per hash unconditionally.
_HASH_CHUNK_SIZE = 500


async def _existing_hashes(session: AsyncSession, source_id: str, hashes: list[str]) -> set[str]:
    """content_hash values from ``hashes`` already stored for ``source_id``.

    Chunks the IN() so a large batch never binds more query variables than
    SQLite allows (C15) — behavior for small batches is unchanged, just one
    chunk.
    """
    existing: set[str] = set()
    for i in range(0, len(hashes), _HASH_CHUNK_SIZE):
        chunk = hashes[i : i + _HASH_CHUNK_SIZE]
        result = await session.execute(
            select(CollectedRecord.content_hash).where(
                CollectedRecord.source_id == source_id,
                CollectedRecord.content_hash.in_(chunk),
            )
        )
        existing.update(row[0] for row in result)
    return existing


async def _existing_by_identity(
    session: AsyncSession, source_id: str, identity_keys: list[str]
) -> dict[str, CollectedRecord]:
    """CollectedRecord rows already stored for source_id, keyed by identity_key.

    Only queried when at least one channel-provided identity() value is
    present in the batch (C7) — channels without identity() never touch
    this path, and existing content_hash-only dedup behavior for them is
    unchanged. Chunked for the same reason as _existing_hashes (C15).
    """
    existing: dict[str, CollectedRecord] = {}
    for i in range(0, len(identity_keys), _HASH_CHUNK_SIZE):
        chunk = identity_keys[i : i + _HASH_CHUNK_SIZE]
        result = await session.execute(
            select(CollectedRecord).where(
                CollectedRecord.source_id == source_id,
                CollectedRecord.identity_key.in_(chunk),
            )
        )
        for record in result.scalars():
            existing[record.identity_key] = record
    return existing


async def store_records(
    session: AsyncSession,
    task_id: str,
    source_id: str,
    normalized_triples: list[tuple[dict, dict, str]],
    *,
    channel_type: str = "unknown",
    forward_to_odp: bool = False,
    workflow_id: str | None = None,
    workflow_run_id: str | None = None,
    identities: list[str | None] | None = None,
) -> tuple[list[CollectedRecord], int]:
    """Insert new records; skip existing ones by content_hash.

    ``forward_to_odp`` gates a forward to the Rust ODP ingest hot path (fires
    only when ``ODP_INGEST_URL`` is ALSO set). Defaults to False: the ODP
    forward is opt-in, chosen explicitly by the write-seam layer under a
    source's ``write_strategy`` (``OdpSink`` / ``DualSink``, see
    ``backend/pipeline/sinks/strategy.py``), not an implicit side effect of a
    bare env var being present (P1-1). Previously this defaulted to True, so
    setting ``ODP_INGEST_URL`` anywhere forwarded every ``legacy``-strategy
    source's data into ODP too — bypassing the write_strategy state machine
    entirely and silently enrolling sources that were never migrated.
    ``LegacyDbSink`` (the ``legacy`` strategy's sink) now passes this
    explicitly; nothing should rely on the old implicit-True default.

    ``identities`` (C7), when given, is a list parallel to ``normalized_triples``
    (same length, index-aligned) of each item's channel-provided ``identity()``
    value, or None for items the channel can't identify. It is a SUPPLEMENTARY
    key alongside content_hash, not a replacement:
      - identity present AND matches an existing row for this source: that's
        the same source-native item seen before. If its content_hash is
        unchanged, it's a plain duplicate (skipped). If the content_hash
        differs (e.g. the feed fixed a typo in the title), the existing row
        is UPDATED in place instead of inserted as a new row — a title edit
        no longer duplicates the item (the C7 bug). Updated rows are folded
        into the returned new_records (their content actually changed, so
        downstream AI enrichment/notification should see them as fresh).
      - identity present but not matching any existing row: falls through
        to the normal content_hash-based insert path, with identity_key set
        on the new row so future edits can be matched.
      - identity None (or ``identities`` not given at all): behavior is
        completely unchanged — content_hash-only dedup, exactly as before
        C7. This is the only path channels without identity() ever take.

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

    # Collect all hashes to check for duplicates (chunked, see _existing_hashes)
    hashes = [h for _, _, h in normalized_triples]
    existing_hashes = await _existing_hashes(session, source_id, hashes)

    # C7: resolve identity()-matched existing rows, if the caller supplied any.
    # Channels without identity() (identities is None, or all-None entries)
    # never populate identity_keys, so existing_by_identity stays empty and
    # every item below falls straight through to the unchanged content_hash path.
    identity_keys = [i for i in (identities or []) if i is not None]
    existing_by_identity = (
        await _existing_by_identity(session, source_id, identity_keys)
        if identity_keys
        else {}
    )

    new_records: list[CollectedRecord] = []
    updated_records: list[CollectedRecord] = []
    skipped = 0
    # Dedup within this batch too: two triples can share a content_hash (e.g. two
    # CLI sub-commands that normalize to identical content). Without this, both
    # pass the existing_hashes check, both get added, and flush() fails the whole
    # batch atomically on the UNIQUE(source_id, content_hash) constraint.
    seen_in_batch: set[str] = set()
    seen_identities_in_batch: set[str] = set()

    for idx, (raw, normalized, content_hash) in enumerate(normalized_triples):
        identity = identities[idx] if identities else None

        if identity is not None:
            existing = existing_by_identity.get(identity)
            if existing is not None:
                if existing.content_hash == content_hash:
                    # Same source-native item, content unchanged: a genuine
                    # duplicate, same as the content_hash-only path always did.
                    skipped += 1
                else:
                    # Same source-native item, content changed (e.g. a feed
                    # fixed a title typo) — update in place instead of
                    # inserting a duplicate row (C7's fix).
                    existing.raw_data = raw
                    existing.normalized_data = normalized
                    existing.content_hash = content_hash
                    existing.status = "normalized"
                    existing.ai_enrichment = None
                    updated_records.append(existing)
                continue
            if identity in seen_identities_in_batch:
                # Two triples in this same batch share an identity (e.g. a
                # feed listed the same entry twice) — keep the first, skip
                # the rest rather than fight over which one "wins".
                skipped += 1
                continue
            seen_identities_in_batch.add(identity)

        if content_hash in existing_hashes or content_hash in seen_in_batch:
            skipped += 1
            continue
        seen_in_batch.add(content_hash)

        record = CollectedRecord(
            task_id=task_id,
            source_id=source_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            raw_data=raw,
            normalized_data=normalized,
            content_hash=content_hash,
            status="normalized",
            identity_key=identity,
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
        # C7: session.rollback() undoes the WHOLE transaction, not just the
        # failed insert — so any identity-matched update mutations flushed
        # in the same attempt are reverted too, and (expire_on_commit aside)
        # are not worth replaying here: we don't retry them in this call.
        # That's safe, not silent data loss — the row's stored content_hash
        # in the DB is still the old value, so the next natural collection
        # run will see the same "identity matches, content differs" mismatch
        # and retry the update then. Only log if this actually cost us something.
        if updated_records:
            logger.warning(
                "identity-matched update(s) reverted for source=%s alongside "
                "an insert collision (%d update(s) deferred to next "
                "collection run)",
                source_id,
                len(updated_records),
            )
        updated_records = []
        already_there = await _existing_hashes(
            session, source_id, [r.content_hash for r in new_records]
        )
        survivors: list[CollectedRecord] = []
        for record in new_records:
            if record.content_hash in already_there:
                skipped += 1
                continue
            # Nested transaction (SAVEPOINT) per record: a plain session.rollback()
            # here would undo every earlier survivor's flush too, since they all
            # share this one session/transaction — begin_nested() scopes the
            # rollback to just this record's failed insert.
            try:
                async with session.begin_nested():
                    session.add(record)
                    await session.flush()
                survivors.append(record)
            except IntegrityError:
                skipped += 1
        new_records = survivors

    return new_records + updated_records, skipped
