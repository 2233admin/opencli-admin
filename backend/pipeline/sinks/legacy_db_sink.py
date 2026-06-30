"""LegacyDbSink — the original write path, now behind the ItemSink seam.

Normalizes items (``content_hash`` dedup) and stores them in
``collected_records``, exactly as the pipeline did inline before the seam
existed. Extracting it changes no behavior: it still calls
``normalizer.normalize_items`` then ``storer.store_records`` inside a
short-lived session.

Two things stay where they were on purpose, to keep this slice behavior-only:
  * The ODP forward still lives inside ``storer.store_records`` (fires when
    ``ODP_INGEST_URL`` is set), now behind a ``forward_to_odp`` gate so DualSink
    can suppress it on the legacy leg. The dedicated ``OdpSink`` owns the forward
    going forward; ``write_strategy`` picks the destination in a later slice.
  * Dedup here remains ``content_hash`` (title|url|content|source_id). The ODP
    path keys on ``(source_id, event_id)`` instead; the two will disagree, and
    surfacing that disagreement under shadow is the point of the migration.
"""

from __future__ import annotations

from typing import Sequence

from backend.pipeline.sinks.base import RunContext, SinkResult


class LegacyDbSink:
    """Persist collected items to the legacy ``collected_records`` table.

    ``forward_to_odp`` gates the ODP shadow-forward that lives inside
    ``storer.store_records``. Defaults to True (behavior unchanged); ``DualSink``
    constructs this with False so the legacy write does not double-send to ODP
    alongside ``OdpSink``.
    """

    def __init__(self, forward_to_odp: bool = True) -> None:
        self.forward_to_odp = forward_to_odp

    async def write_batch(self, ctx: RunContext, items: Sequence[dict]) -> SinkResult:
        # Function-local imports mirror the orchestrator: ``AsyncSessionLocal`` is
        # rebound per call so tests can patch ``backend.database.AsyncSessionLocal``,
        # and ``storer``/``normalizer`` are reached as module attributes so
        # ``patch("backend.pipeline.storer.store_records")`` takes effect.
        from backend.database import AsyncSessionLocal
        from backend.pipeline import normalizer, storer

        triples = normalizer.normalize_items(list(items), ctx.source_id)

        # The ODP shadow-forward still fires inside storer.store_records; the
        # forward_to_odp gate lets DualSink(LegacyDbSink + OdpSink) turn it off on
        # the legacy leg so ODP is not double-sent.
        async with AsyncSessionLocal() as session:
            new_records, skipped = await storer.store_records(
                session, ctx.task_id, ctx.source_id, triples,
                channel_type=ctx.provider, forward_to_odp=self.forward_to_odp,
            )
            await session.commit()

        return SinkResult(
            accepted=len(new_records),
            duplicates=skipped,
            normalized=len(triples),
            records=new_records,
        )
