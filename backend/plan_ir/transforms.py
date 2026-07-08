"""Shared-segment transforms v1: merge, dedupe (issue 04, ADR-0009).

Transform set v1 is deliberately minimal — no plugin system, no other
transform kinds. Each function is a plain, synchronous, patchable seam
(mirrors ``backend.pipeline.storer.store_records`` being importable and
patchable at ``backend.plan_ir.transforms.<name>`` for tests) operating on
``ProvenancedItem`` — the shape every item carries once it enters a shared
segment: the original (raw, normalized, content_hash) triple the per-source
pipeline already produced, PLUS the source-tagged provenance the Two-Tier
Attribution contract requires (ADR-0009 story 12: "any upstream delivery
runs the downstream shared segment ... with source-tagged provenance").

Nothing in this module touches a database, a DataSource, or any
per-source measurement/control-state row — these are pure functions over
in-memory item lists. The executor is the only caller, and the executor is
what performs (and isolates) all persistence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ProvenancedItem:
    """One item flowing through a shared segment, source-tagged.

    ``raw``/``normalized``/``content_hash`` are exactly the triple
    ``backend.pipeline.normalizer.normalize_items`` produces for a source's
    own per-source store — reused, not re-derived, so a shared segment's
    view of an item is byte-identical to what its source segment already
    computed.
    """

    raw: dict[str, Any]
    normalized: dict[str, Any]
    content_hash: str
    source_id: str
    source_node_id: str


def merge_items(branches: list[list[ProvenancedItem]]) -> list[ProvenancedItem]:
    """Merge node: concatenate every upstream branch's items, in upstream
    (edge) order. Merge never drops or reorders within a branch — it only
    combines; deduplication is dedupe's job, kept as a separate node so a
    Plan author can wire a merge without a dedupe when duplicates are
    wanted (e.g. a raw audit sink)."""
    merged: list[ProvenancedItem] = []
    for branch in branches:
        merged.extend(branch)
    return merged


def dedupe_items(items: list[ProvenancedItem]) -> tuple[list[ProvenancedItem], int]:
    """Dedupe node: drop items whose ``content_hash`` has already been seen,
    first-wins (matches ``backend.pipeline.storer.store_records``'s
    same-batch dedup rule). Returns (survivors, dropped_count).

    This is the seam the HARD TEST (issue 04 acceptance criterion) patches
    to induce a shared-segment failure: ``patch("backend.plan_ir.transforms.
    dedupe_items", side_effect=RuntimeError(...))`` — a raise here must never
    reach any source's measurement/control-state row, only Plan Health.
    """
    seen: set[str] = set()
    survivors: list[ProvenancedItem] = []
    dropped = 0
    for item in items:
        if item.content_hash in seen:
            dropped += 1
            continue
        seen.add(item.content_hash)
        survivors.append(item)
    return survivors, dropped
