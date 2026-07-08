"""Skill subsystem: distill execution traces into reusable SKILL.md cards.

Closed loop (BrowserBC path-B, integrated into opencli-admin):
    record  → a human/agent browser trace (journey_trace_v1)
    distill → trace + provider LLM → 9-element skill spec + SKILL.md   (this pkg)
    store   → Skill model (models/skill.py)
    execute → skill_channel reads SKILL.md, cheap model drives CDP page
    correct → run events feed self-eval back into a new distill round
"""

from backend.skills.distill import distill_trace, provider_from_model
from backend.skills.trace import TRACE_SCHEMA, assemble_trace, self_eval

__all__ = [
    "TRACE_SCHEMA",
    "assemble_trace",
    "distill_trace",
    "provider_from_model",
    "self_eval",
]
