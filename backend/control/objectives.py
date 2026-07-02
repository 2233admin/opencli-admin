"""SourceObjective: per-source control setpoints.

See docs/CONTROL_THEORY_ARCHITECTURE.md §4. Pure data contract only — no
evaluator/policy logic lives here (that's future PR-Control-3).
"""

from typing import Optional

from pydantic import BaseModel


class SourceObjective(BaseModel):
    """Setpoints a source's measurements are compared against.

    All fields have defaults so an objective can be constructed with no
    per-source overrides and still be meaningful.
    """

    max_error_rate: float = 0.05
    max_duplicate_rate: float = 0.50
    max_freshness_lag_seconds: Optional[int] = None
    max_run_latency_ms: int = 30_000
    max_pending: int = 1000
    min_accepted_per_run: Optional[int] = None
