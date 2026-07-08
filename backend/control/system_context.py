"""build_system_context: the ONE builder for the shared ODP system_context
dict that ``backend.control.service.decide_for_source`` consumes.

Originally inline in ``backend.api.v1.sources._build_system_context``
(PR-Control-3); factored out here so the control-state endpoint AND the
Control Cycle (issue 03) build system_context identically — two call sites
computing "is the shared ODP plane backpressured" differently would be
exactly the kind of disagreement ``backend.control.service``'s docstring
warns against.

Reuses the read-only ODP collector (backend.control.collectors.odp_metrics);
degrades to ``available=False`` / ``odp_backpressured=False`` on any
collector failure rather than raising — see that module's degrade-not-raise
contract.
"""

from __future__ import annotations

import logging

from backend.control.objectives import SourceObjective
from backend.schemas.control import SystemContextRead

logger = logging.getLogger(__name__)


async def build_system_context(objective: SourceObjective) -> SystemContextRead:
    """Collect the shared ODP system_context for one source's objective
    (only ``max_pending`` is read from it)."""
    try:
        from backend.control.collectors import odp_metrics

        snapshot = await odp_metrics.collect()
    except Exception as exc:  # pragma: no cover - collect() already degrades
        # internally; this is a last-resort guard so a collector import/
        # crash bug can never turn a caller into a 500 or stall the cycle.
        logger.warning("system_context: odp_metrics.collect failed: %s", exc)
        return SystemContextRead(odp_backpressured=False, available=False)

    stream_available = snapshot.stream.available
    pending = snapshot.stream.pending
    lag = snapshot.stream.lag

    odp_backpressured = (
        stream_available and pending is not None and pending > objective.max_pending
    )

    return SystemContextRead(
        odp_backpressured=odp_backpressured,
        stream_lag=lag if stream_available else None,
        pending=pending if stream_available else None,
        available=stream_available,
    )
