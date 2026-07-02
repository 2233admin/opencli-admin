"""Control-model primitives: control state enum + control action.

See docs/CONTROL_THEORY_ARCHITECTURE.md §4 for the vocabulary these types
encode. This module only defines pure data contracts; it is not wired into
any runner, pipeline, or API in this PR.
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SourceControlState(str, Enum):
    """Control-theoretic state of a data source (the "plant").

    Derived by an evaluator (future PR-Control-3) from a SourceMeasurement
    compared against a SourceObjective. Defined here only as a vocabulary.
    """

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    BACKPRESSURED = "backpressured"
    RATE_LIMITED = "rate_limited"
    AUTH_FAILED = "auth_failed"
    SCHEMA_DRIFT = "schema_drift"
    PAUSED = "paused"
    DEAD = "dead"


class ControlAction(BaseModel):
    """A candidate control action against a source (the "actuator" input).

    Advisory-only in this PR: nothing constructs or executes a ControlAction
    yet. See docs/CONTROL_THEORY_ARCHITECTURE.md §4 for the action vocabulary
    (increase_interval / apply_backoff / pause / resume / reduce_page_size /
    switch_write_strategy / force_cursor_rescan / claim_pending /
    require_human_review).
    """

    action_type: str
    source_id: str
    reason: str
    payload: dict[str, Any] = Field(default_factory=dict)
