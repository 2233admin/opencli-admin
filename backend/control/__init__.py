"""Control model layer (control theory vocabulary) for data-acquisition sources.

See docs/CONTROL_THEORY_ARCHITECTURE.md for the full architecture and rationale.

This package (PR-Control-1) defines pure data contracts only:
- models.py: SourceControlState enum + ControlAction
- measurements.py: SourceMeasurement (sensor readings)
- objectives.py: SourceObjective (per-source setpoints)

Nothing in this package is wired into the runner/pipeline/API. Zero behavior
change — definitions only.
"""
