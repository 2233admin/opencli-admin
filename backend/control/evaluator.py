"""Full rule-based control-state evaluator (PR-Control-3).

Replaces C0/PR-Control-2's minimal placeholder. See
docs/CONTROL_THEORY_ARCHITECTURE.md §4-5 for the vocabulary and §0 for the
non-negotiable honesty gate this module preserves from C0:

    * Positive-evidence states (an observed problem — DEGRADED, RATE_LIMITED,
      AUTH_FAILED, SCHEMA_DRIFT, BLOCKED_BY_ODP, DEAD) are NEVER gated by
      sensor-coverage confidence. Hiding a real, observed problem behind a
      "low confidence" flag would be strictly worse than reporting it.
    * Only the "nothing looks wrong" verdict is untrustworthy when sensor
      coverage is incomplete — low confidence remaps a would-be HEALTHY to
      UNKNOWN, never the reverse.

Rule order (first match wins; see ``evaluate()`` body for the exact
precedence chosen and documented inline):

    1. error_kinds.auth_failed > 0                          -> AUTH_FAILED
    2. error_kinds.rate_limited dominant / trend rate-limited-> RATE_LIMITED
    3. error_kinds.schema_drift > 0                          -> SCHEMA_DRIFT
    4. system_context.odp_backpressured (available+over)    -> BLOCKED_BY_ODP
    5. error_rate > objective.max_error_rate                 -> DEGRADED
    5b. measurement.odp_pending > objective.max_pending      -> BACKPRESSURED
        (legacy PR-Control-2 per-measurement signal, kept for callers that
        don't populate system_context; checked after DEGRADED — precedence
        preserved unchanged from PR-Control-2)
    6. trend.zero_accepted_streak >= N (and not a clean
       not-modified run)                                     -> DEAD
    7. else                                                   -> HEALTHY
       (gated to UNKNOWN when sensor-coverage confidence is "low")

Deterministic: the same ``(measurement, objective, trend, system_context)``
input always produces the same output — no randomness, no wall-clock reads
beyond what the caller already baked into ``measurement``/``trend``.
"""

from __future__ import annotations

from typing_extensions import TypedDict

from backend.control.coverage import compute_sensor_coverage, derive_confidence
from backend.control.measurements import SourceMeasurement
from backend.control.models import SourceControlState
from backend.control.objectives import SourceObjective

#: How many consecutive zero-accepted runs (from the trend window) count as
#: DEAD. Chosen (not derived) — documented here rather than buried in a magic
#: number: 3 consecutive empty runs is enough to distinguish "genuinely
#: nothing new to fetch" (which for polling sources is normal and transient)
#: from "this source stopped producing anything", without flagging DEAD on a
#: single quiet cycle.
DEAD_ZERO_STREAK_THRESHOLD = 3

#: A row whose sole terminal error is a clean "not modified" signal (304 / no
#: new content) is not evidence of the source being dead — it means the
#: cache/etag path is working correctly and there was nothing new to fetch.
#: We must not confuse "polite no-op" with "broken". There is no dedicated
#: ErrorKind for this yet (docs' error_kinds vocabulary doesn't have a 304
#: entry — the closest positive signal available on SourceMeasurement is an
#: empty error_kinds dict, i.e. no terminal error was recorded at all), so the
#: DEAD rule only fires when the streak of zero-accepted runs is ALSO
#: accompanied by at least one non-empty error_kinds entry somewhere in the
#: trend window; a source with zero_accepted_streak driven purely by empty,
#: error-free runs is left to fall through instead (documented decision, see
#: module docstring rule 6).


class SystemContext(TypedDict, total=False):
    """The shared-infrastructure signals the evaluator needs, distinct from a
    per-source measurement. Built by the endpoint from
    ``backend.control.collectors.odp_metrics`` — see
    ``backend.api.v1.sources.get_source_control_state``.

    ``odp_backpressured`` is already the boolean comparison result (stream lag
    / pending over the source's objective.max_pending) — the evaluator does
    not re-derive it from raw lag/pending numbers, since "what counts as too
    much backpressure" is an objective-level decision the endpoint already
    made once.
    """

    odp_backpressured: bool
    available: bool


class Trend(TypedDict, total=False):
    """Rolling-window summary from ``backend.control.aggregation.build_trend``."""

    window: int
    zero_accepted_streak: int
    avg_error_rate: float
    rate_limited_runs: int


def evaluate(
    measurement: SourceMeasurement,
    objective: SourceObjective,
    *,
    trend: Trend | None = None,
    system_context: SystemContext | None = None,
) -> SourceControlState:
    """Derive a :class:`SourceControlState` from multi-signal evidence.

    ``trend`` and ``system_context`` are optional so existing call sites (and
    tests) that only have a measurement+objective keep working — every branch
    that depends on them treats "not supplied" the same as "signal absent",
    never as "signal present but zero".
    """
    trend = trend or {}
    system_context = system_context or {}
    error_kinds = measurement.error_kinds or {}

    # 1. AUTH_FAILED: highest precedence — an invalid credential means every
    # other signal on this run is suspect (a source can't even talk to fetch
    # data to be rate-limited/drift-classified). Positive evidence -> never
    # gated by coverage.
    if error_kinds.get("auth_failed", 0) > 0:
        return SourceControlState.AUTH_FAILED

    # 2. RATE_LIMITED: either this run's terminal error was a rate limit, or
    # the trend shows a pattern of rate-limited runs even if this particular
    # run's terminal error_kind was something else (e.g. it eventually failed
    # for a different reason after retries against a limit). Positive
    # evidence -> never gated by coverage.
    trend_rate_limited = trend.get("rate_limited_runs", 0)
    trend_window = trend.get("window", 0)
    rate_limited_dominant_in_trend = (
        trend_window > 0 and trend_rate_limited * 2 > trend_window
    )
    if error_kinds.get("rate_limited", 0) > 0 or rate_limited_dominant_in_trend:
        return SourceControlState.RATE_LIMITED

    # 3. SCHEMA_DRIFT: the source's shape changed underneath it (feed/DOM/API
    # format). Positive evidence -> never gated by coverage.
    if error_kinds.get("schema_drift", 0) > 0:
        return SourceControlState.SCHEMA_DRIFT

    # 4. BLOCKED_BY_ODP: the shared downstream pipe is backpressured beyond
    # this source's objective — a system-level constraint, not a source
    # defect. Positive evidence (an observed system_context flag) -> never
    # gated by coverage. Only fires when the system context actually reports
    # ODP as available and over threshold; an unavailable ODP collector must
    # never be conflated with "backpressured" (see backend.control.
    # collectors.odp_metrics — degrade to unavailable, not a fabricated True).
    if system_context.get("available", True) and system_context.get(
        "odp_backpressured", False
    ):
        return SourceControlState.BLOCKED_BY_ODP

    # 5. DEGRADED: reject rate exceeds the allowed error setpoint. Positive
    # evidence -> never gated by coverage. Checked BEFORE the legacy
    # BACKPRESSURED rule below — this precedence is preserved unchanged from
    # PR-Control-2's evaluator (see test_degraded_takes_precedence_over_backpressure).
    if measurement.error_rate > objective.max_error_rate:
        return SourceControlState.DEGRADED

    # 5b. BACKPRESSURED (legacy, PR-Control-2): a per-measurement odp_pending
    # reading exceeding the objective, kept for backward compatibility with
    # callers that populate SourceMeasurement.odp_pending directly without
    # going through the system_context path above. Distinct from
    # BLOCKED_BY_ODP: this is a per-source measurement signal, that one is
    # the shared-infrastructure system_context signal. Positive evidence ->
    # never gated by coverage.
    if measurement.odp_pending is not None and measurement.odp_pending > objective.max_pending:
        return SourceControlState.BACKPRESSURED

    # 6. DEAD: a sustained streak of zero-accepted runs that is NOT explained
    # by a clean not-modified/no-op pattern. We approximate "not a clean
    # no-op" as "at least one terminal error was recorded on this latest
    # reading" — a source silently producing nothing with no errors at all
    # falls through to the HEALTHY/UNKNOWN branch instead (documented
    # decision: see module-level comment above `SystemContext`). This keeps
    # DEAD a genuine "something is broken" signal rather than flagging every
    # low-traffic-but-fine polling source.
    zero_streak = trend.get("zero_accepted_streak", 0)
    if zero_streak >= DEAD_ZERO_STREAK_THRESHOLD and bool(error_kinds):
        return SourceControlState.DEAD

    # Nothing looked wrong — but "nothing looked wrong" is only meaningful if
    # the sensors that would have caught a problem are actually present. If
    # coverage confidence is low, report UNKNOWN instead of a fake HEALTHY.
    coverage = compute_sensor_coverage(measurement)
    if derive_confidence(coverage) == "low":
        return SourceControlState.UNKNOWN

    return SourceControlState.HEALTHY
