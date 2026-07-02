"""Response schemas for the read-only control-state endpoint (PR-Control-2)."""

from typing import Optional

from pydantic import BaseModel

from backend.control.measurements import SourceMeasurement
from backend.control.models import SourceControlState
from backend.control.objectives import SourceObjective


class SourceControlStateRead(BaseModel):
    """Read-only view of a source's latest sensor reading + derived state.

    ``measurement`` and ``control_state`` are null when the source has never run
    (no run evidence to aggregate, nothing to evaluate). ``objective`` is always
    the setpoints the measurement was (or would be) compared against — for
    PR-Control-2 this is the :class:`SourceObjective` defaults, since per-source
    objective overrides are not stored yet (future work).
    """

    source_id: str
    measurement: Optional[SourceMeasurement] = None
    control_state: Optional[SourceControlState] = None
    objective: SourceObjective
