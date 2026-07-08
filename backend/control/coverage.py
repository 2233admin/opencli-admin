"""SensorCoverage: make sensor gaps visible (C0 — Control Room v0).

See docs/CONTROL_THEORY_ARCHITECTURE.md §0: "先让系统诚实" — a controller built
on lying sensors is worse than no controller. Before PR-Control-3's real
evaluator/policies engine can be trusted, the system must be honest about
*which* sensor readings it actually has versus which are placeholders.

This module adds NO sensors and reads NO new data. It only inspects a
:class:`backend.control.measurements.SourceMeasurement` that
``backend.control.aggregation.build_measurement`` already produced, and reports
which of the five signals that PR-Control-3+ depends on are real:

    run          — do we have run evidence at all? (always True here: this
                   module is only called once a measurement exists — a `None`
                   measurement is a separate "never ran" case the endpoint
                   already handles.)
    cursor       — is cursor advancement a real observed signal, or the
                   ``cursor_advanced=False`` placeholder the TaskRunEvent
                   fallback path in aggregation.py hardcodes (a source with a
                   real ``source_measurements`` row carries the actual C1
                   ``CommitResult.advanced`` outcome, which can legitimately
                   be True or False — so for rows sourced from that table,
                   ``cursor`` coverage is real regardless of the boolean's
                   value; only the pre-C1 fallback path is a structural gap)?
    freshness    — is ``freshness_lag_seconds`` populated?
    error_kinds  — is ``error_kinds`` non-empty, OR did the reading come from
                   a real ``source_measurements`` row where an EMPTY dict
                   legitimately means "no terminal error" (a fully successful
                   run) rather than "never recorded"? PR-Control-3: now a real
                   :class:`SourceMeasurement` field (see
                   backend.control.error_kinds / backend.control.recorder),
                   populated from the persisted row in aggregation.py. Only
                   the pre-C1 TaskRunEvent-fallback path leaves it structurally
                   empty with no way to tell "no error" from "never measured".
    odp          — are the ODP metrics (odp_stream_lag / odp_pending / dlq_count
                   beyond its int default) populated, or the ``None`` /
                   zero-default aggregation.py leaves them as (system-level ODP
                   metrics are supplied by the endpoint's system_context, not
                   by a per-run SourceMeasurement — see backend.control.
                   collectors.odp_metrics)?

Because ``error_kinds`` being an empty dict is ambiguous on its own (it could
mean "no error" or "never recorded"), and ``cursor_advanced`` is a required
non-Optional bool, this module distinguishes the two aggregation.py code paths
via ``source_ts_quality``: the TaskRunEvent fallback path never sets it (always
``None``), while both real recording paths (C1's recorder, and this module's
own persisted-row mapping) always set it to one of the five valid quality
strings. That is therefore the one field reliably present only on "real
signal" measurements, and doubles as the discriminator for cursor/error_kinds
coverage without adding a new field to the contract.
"""

from typing_extensions import TypedDict

from backend.control.measurements import SourceMeasurement

# Signals PR-Control-3+ needs to trust an automatic (non-advisory) decision.
_CRITICAL_SIGNALS = ("odp", "error_kinds")


class SensorCoverage(TypedDict):
    run: bool
    cursor: bool
    freshness: bool
    error_kinds: bool
    odp: bool


def compute_sensor_coverage(measurement: SourceMeasurement) -> SensorCoverage:
    """Which sensor signals behind ``measurement`` are real vs. placeholder.

    Read-only inspection of fields already on ``measurement`` — adds no new
    sensor, calls no new source. A measurement is only ever built once a
    source has run (see ``aggregation.build_measurement``), so ``run`` is
    always True in this function's contract; the "never ran" case is handled
    by the endpoint returning ``measurement=None`` before this is called.
    """
    # source_ts_quality is only ever set by a real source_measurements row
    # (either C1's recorder, or aggregation.py's own row->contract mapping) —
    # the pre-C1 TaskRunEvent fallback path leaves it None. Use it as the
    # discriminator for whether cursor_advanced/error_kinds are genuinely
    # observed signals versus that fallback's structural placeholders.
    has_rich_row = measurement.source_ts_quality is not None

    return SensorCoverage(
        run=True,
        cursor=has_rich_row,
        freshness=measurement.freshness_lag_seconds is not None,
        error_kinds=has_rich_row,
        odp=measurement.odp_stream_lag is not None or measurement.odp_pending is not None,
    )


def missing_signals(coverage: SensorCoverage) -> list[str]:
    """The (stably ordered) list of signal names that are False in coverage."""
    return [name for name, present in coverage.items() if not present]


def derive_confidence(coverage: SensorCoverage) -> str:
    """"high" | "medium" | "low" confidence in the coverage, per C0 contract.

        low    — any critical signal (odp, error_kinds) is missing, OR two or
                 more signals overall are missing. A state derived from this
                 little evidence must never be reported as a confident HEALTHY.
        medium — exactly one non-critical signal is missing.
        high   — every signal is present.

    This function only classifies coverage; it does not decide control_state
    (see backend.control.evaluator for how confidence gates HEALTHY).
    """
    missing = missing_signals(coverage)
    if not missing:
        return "high"
    if any(signal in missing for signal in _CRITICAL_SIGNALS):
        return "low"
    if len(missing) >= 2:
        return "low"
    return "medium"
