"""Provisional control-state derivation (PR-Control-2 placeholder).

⚠️ MINIMAL BY DESIGN. This is NOT the real evaluator. PR-Control-3 replaces this
with the full rule-based ``evaluator`` + ``policies`` engine described in
docs/CONTROL_THEORY_ARCHITECTURE.md §4-5 (rich state detection —
RATE_LIMITED / AUTH_FAILED / SCHEMA_DRIFT / DEAD — plus ControlActions).

For PR-Control-2 we only need the endpoint to be able to return *a*
:class:`SourceControlState` for the obvious cases, so it compares one
:class:`SourceMeasurement` against one :class:`SourceObjective` and maps:

    error_rate  > objective.max_error_rate  -> DEGRADED
    odp_pending > objective.max_pending      -> BACKPRESSURED
    otherwise                                -> HEALTHY

Keep this small. Do not grow it into a policy engine here.
"""

from backend.control.measurements import SourceMeasurement
from backend.control.models import SourceControlState
from backend.control.objectives import SourceObjective


def evaluate(
    measurement: SourceMeasurement, objective: SourceObjective
) -> SourceControlState:
    """Derive a provisional :class:`SourceControlState` (PR-Control-2 placeholder).

    PR-Control-3 will replace this with the real rule-based evaluator/policies.
    """
    # DEGRADED: rejects exceed the allowed error setpoint.
    if measurement.error_rate > objective.max_error_rate:
        return SourceControlState.DEGRADED

    # BACKPRESSURED: too many items pending downstream. Guarded on odp_pending
    # being present — PR-Control-2 leaves it None (no ODP-side source), so in
    # practice this branch can only fire once ODP metrics are wired in later.
    if (
        measurement.odp_pending is not None
        and measurement.odp_pending > objective.max_pending
    ):
        return SourceControlState.BACKPRESSURED

    return SourceControlState.HEALTHY
