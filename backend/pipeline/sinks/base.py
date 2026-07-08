"""The write seam: where collected items go.

A channel fetches; the runner orchestrates; a **Sink** decides the destination.
Today the only destination is the legacy ``collected_records`` table
(``LegacyDbSink``). Next, the same items also flow to the ODP hot path
(``OdpSink``), and both at once for shadow validation (``DualSink``) — all behind
this one interface, chosen per source by ``write_strategy``, with no change to
channels or the runner.

This is the strangler-fig seam: the old path keeps working unchanged, the new
path is wired in beside it, and a source is migrated by flipping its strategy —
never by rewriting the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence


@dataclass
class RunContext:
    """Identity of one collection run, threaded to whichever sink handles it.

    ``provider`` is the channel_type (e.g. ``"rss"``); it becomes the ODP
    ``provider`` and the legacy ``channel_type``. ``ingest_mode`` is
    ``snapshot`` (full re-list) or ``stream`` (incremental), mirroring the ODP
    contract.
    """

    task_id: str
    source_id: str
    provider: str
    ingest_mode: str = "snapshot"
    run_id: str | None = None
    trace_id: str | None = None


@dataclass
class SinkResult:
    """Outcome of writing one batch.

    Counts share one vocabulary across sinks, but each is defined relative to
    that sink's OWN durable boundary — not a shared one. A DualSink comparison
    must account for the boundaries differing:

      * ``accepted``   — items the sink committed to its durable path. For
        ``LegacyDbSink`` this is rows inserted into ``collected_records``; for
        ``OdpSink`` it is events the ingest service *queued* (Redis Stream) —
        a weaker guarantee than an inserted row.
      * ``duplicates`` — items the sink recognized as already-seen before its
        durable write (legacy: ``content_hash`` hit; ODP: ``(source_id, event_id)``).
      * ``rejected``   — items dropped for validation or a permanent error;
        detail in ``errors``.
      * ``normalized`` — items that passed normalization (legacy bookkeeping).
      * ``records``    — persisted ORM rows, for sinks that own a local table
        (``LegacyDbSink``), so the downstream AI/notify steps can enrich them.
        Forward-only sinks (``OdpSink``) leave it empty and those steps no-op,
        because on the ODP path enrichment happens off the ``record.committed``
        stream.
      * ``shadow_meta`` — set only by ``DualSink``: the best-effort shadow
        leg's OWN ``accepted``/``duplicates``/``rejected`` counts (the top-level
        fields above stay the legacy/authoritative leg's numbers so existing
        callers are unaffected). ``None`` when there is no shadow leg, or when
        the shadow write raised before producing a result. Previously these
        counts were only logged (P1-7); this lets a caller (pipeline.py)
        surface them without changing what "accepted"/"duplicates" mean.
    """

    accepted: int = 0
    duplicates: int = 0
    rejected: int = 0
    normalized: int = 0
    records: list[Any] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    shadow_meta: dict[str, int] | None = None


class ItemSink(Protocol):
    """Accepts raw collected items and persists/forwards them somewhere.

    Implementations own their own normalization, dedup, and persistence so the
    orchestrator stays destination-agnostic. The whole surface is one method:
    everything else a sink does is hidden behind it.
    """

    async def write_batch(self, ctx: RunContext, items: Sequence[dict]) -> SinkResult:
        ...
