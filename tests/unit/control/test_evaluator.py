"""Unit tests for the PR-Control-2 provisional evaluator (no DB).

Only the minimal placeholder logic is exercised here; PR-Control-3 replaces
backend.control.evaluator with the real rule-based engine.
"""

from datetime import datetime, timezone

from backend.control.evaluator import evaluate
from backend.control.measurements import SourceMeasurement
from backend.control.models import SourceControlState
from backend.control.objectives import SourceObjective


def _measurement(**overrides) -> SourceMeasurement:
    kwargs = dict(
        source_id="src-1",
        run_id="run-1",
        accepted=10,
        duplicates=0,
        rejected=0,
        fetch_latency_ms=100,
        error_rate=0.0,
        duplicate_rate=0.0,
        cursor_advanced=False,
        observed_at=datetime(2026, 7, 2, tzinfo=timezone.utc),
    )
    kwargs.update(overrides)
    return SourceMeasurement(**kwargs)


class TestEvaluate:
    def test_healthy_by_default(self):
        m = _measurement()
        assert evaluate(m, SourceObjective()) is SourceControlState.HEALTHY

    def test_degraded_when_error_rate_exceeds_objective(self):
        # default max_error_rate = 0.05
        m = _measurement(rejected=1, accepted=1, error_rate=0.5)
        assert evaluate(m, SourceObjective()) is SourceControlState.DEGRADED

    def test_error_rate_at_setpoint_is_not_degraded(self):
        # strictly-greater comparison: equal to setpoint stays HEALTHY
        m = _measurement(error_rate=0.05)
        assert evaluate(m, SourceObjective(max_error_rate=0.05)) is SourceControlState.HEALTHY

    def test_backpressured_when_odp_pending_exceeds_max_pending(self):
        m = _measurement(odp_pending=5000)
        obj = SourceObjective(max_pending=1000)
        assert evaluate(m, obj) is SourceControlState.BACKPRESSURED

    def test_none_odp_pending_never_backpressured(self):
        # PR-Control-2 leaves odp_pending unpopulated (None) — that branch can't fire.
        m = _measurement(odp_pending=None)
        assert evaluate(m, SourceObjective()) is SourceControlState.HEALTHY

    def test_degraded_takes_precedence_over_backpressure(self):
        m = _measurement(error_rate=0.9, odp_pending=99999)
        assert evaluate(m, SourceObjective()) is SourceControlState.DEGRADED
