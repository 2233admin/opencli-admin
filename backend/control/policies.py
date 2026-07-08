"""policies: state + measurement + objective -> list[ControlAction] (advisory only).

See docs/CONTROL_THEORY_ARCHITECTURE.md §4-5. This module is the "反馈律"
(feedback law) PR-Control-3 introduces: pure functions that map an already-
computed :class:`~backend.control.models.SourceControlState` onto a list of
suggested :class:`~backend.control.models.ControlAction`.

HARD RULE: everything here is a SUGGESTION. Nothing in this module executes
an action, mutates a ``DataSource``, calls the scheduler, or writes to any
table. ``actuators.py`` (PR-Control-4) is the future module that would read
these suggestions and actually perform them, gated by
``Settings.control_mode == "automatic"`` — that wiring does not exist yet.

Deterministic: the same ``(state, measurement, objective)`` input always
produces the same action list, in the same order — no randomness, no clock
reads, no I/O.
"""

from __future__ import annotations

from backend.control.measurements import SourceMeasurement
from backend.control.models import ControlAction, SourceControlState
from backend.control.objectives import SourceObjective


def suggest_actions(
    state: SourceControlState,
    measurement: SourceMeasurement,
    objective: SourceObjective,
) -> list[ControlAction]:
    """Return the advisory :class:`ControlAction` suggestions for ``state``.

    Every action carries a human-readable ``reason`` explaining WHY it was
    suggested (docs §2 principle 8: "自动化必须可解释"). Returns an empty list
    for states with no first-version policy yet (HEALTHY, PAUSED, UNKNOWN,
    BACKPRESSURED) — silence is the correct advisory output when there is
    nothing to suggest, not an error.
    """
    source_id = measurement.source_id

    if state is SourceControlState.RATE_LIMITED:
        return [
            ControlAction(
                action_type="increase_interval",
                source_id=source_id,
                reason=(
                    "Source is being rate-limited (error_kinds/trend show "
                    "rate_limited responses) — suggest widening the collection "
                    "interval to fall back under the upstream limit."
                ),
                payload={"error_rate": measurement.error_rate},
            )
        ]

    if state is SourceControlState.AUTH_FAILED:
        return [
            ControlAction(
                action_type="pause_source",
                source_id=source_id,
                reason=(
                    "Authentication is failing (error_kinds.auth_failed > 0) — "
                    "continuing to run will keep burning quota/attempts against "
                    "an invalid credential. Suggest pausing until credentials "
                    "are fixed."
                ),
                payload={"error_kinds": dict(measurement.error_kinds)},
            ),
            ControlAction(
                action_type="require_auth_review",
                source_id=source_id,
                reason="Auth failures need a human to rotate/verify the source's credential.",
                payload={"error_kinds": dict(measurement.error_kinds)},
            ),
        ]

    if state is SourceControlState.SCHEMA_DRIFT:
        return [
            ControlAction(
                action_type="pause_source",
                source_id=source_id,
                reason=(
                    "Schema/selector drift detected (error_kinds.schema_drift > 0) "
                    "— the source's shape changed and further runs would keep "
                    "collecting nothing (or garbage) until the extraction logic "
                    "is updated. Suggest pausing to stop wasted runs."
                ),
                payload={"error_kinds": dict(measurement.error_kinds)},
            ),
            ControlAction(
                action_type="require_review",
                source_id=source_id,
                reason="Schema drift needs a human to update the parser/selectors for this source.",
                payload={"error_kinds": dict(measurement.error_kinds)},
            ),
        ]

    if state is SourceControlState.BLOCKED_BY_ODP:
        return [
            ControlAction(
                action_type="pause_low_priority",
                source_id=source_id,
                reason=(
                    "The shared ODP data plane is backpressured beyond this "
                    "source's objective (stream lag/pending over threshold) — "
                    "this source isn't the cause, but continuing to feed a "
                    "backed-up pipe makes the backlog worse. Suggest pausing "
                    "if this source is low priority, to relieve pressure "
                    "while ODP catches up."
                ),
                payload={"max_pending": objective.max_pending},
            )
        ]

    if state is SourceControlState.DEAD:
        return [
            ControlAction(
                action_type="require_review",
                source_id=source_id,
                reason=(
                    "Source has produced zero accepted records for consecutive "
                    "runs with no not-modified/no-op explanation — likely dead "
                    "(broken feed, revoked access, or a target that stopped "
                    "publishing). Suggest a human review before further "
                    "automatic runs."
                ),
                payload={},
            )
        ]

    if state is SourceControlState.DEGRADED:
        return [
            ControlAction(
                action_type="require_review",
                source_id=source_id,
                reason=(
                    f"Error rate {measurement.error_rate:.2%} exceeds the "
                    f"objective's max_error_rate {objective.max_error_rate:.2%}."
                ),
                payload={"error_rate": measurement.error_rate},
            )
        ]

    # HEALTHY / PAUSED / UNKNOWN / BACKPRESSURED (legacy per-measurement
    # odp_pending signal): no first-version policy — nothing to suggest.
    return []
