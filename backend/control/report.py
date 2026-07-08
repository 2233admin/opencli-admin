"""report: the shared (state, action_type) bucketing + tally math over the
Evidence Ledger.

Originally inline in ``backend.api.v1.control`` (PR-Control-3.5's
advisory-report endpoint); factored out here so the execution gate (issue 03,
``backend.control.actuator``) reads samples/recovery_rate through the EXACT
same arithmetic the human-facing advisory report shows — two call sites
computing "does this bucket have enough evidence" differently would let the
actuator execute on numbers the operator's report disagrees with.
"""

from __future__ import annotations

from backend.models.control_action import ControlActionRecord


def tally(rows: list[ControlActionRecord]) -> dict:
    """Fold a set of ledger rows into the shared totals shape (pure).

    ``recovery_rate`` = recovered / (recovered + persisted); null when
    nothing in the set has reached a recovered/persisted verdict yet — a
    0-of-0 rate would be a fabricated signal, not a measurement.
    """
    recovered = sum(1 for r in rows if r.outcome == "recovered")
    persisted = sum(1 for r in rows if r.outcome == "persisted")
    insufficient = sum(1 for r in rows if r.outcome == "insufficient_data")
    evaluated = sum(1 for r in rows if r.evaluated_at is not None)
    denominator = recovered + persisted
    return {
        "total": len(rows),
        "pending": len(rows) - evaluated,
        "evaluated": evaluated,
        "recovered": recovered,
        "persisted": persisted,
        "insufficient_data": insufficient,
        "recovery_rate": recovered / denominator if denominator else None,
    }


def bucket_by_state_action(
    rows: list[ControlActionRecord],
) -> dict[tuple[str, str], list[ControlActionRecord]]:
    """Group ledger rows by (state, action_type) — the same grouping key the
    advisory report and the execution gate both key their evidence lookup
    on."""
    buckets: dict[tuple[str, str], list[ControlActionRecord]] = {}
    for row in rows:
        buckets.setdefault((row.state, row.action_type), []).append(row)
    return buckets


def mode_breakdown(rows: list[ControlActionRecord]) -> dict[str, int]:
    modes: dict[str, int] = {}
    for row in rows:
        modes[row.mode] = modes.get(row.mode, 0) + 1
    return modes
