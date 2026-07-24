"""Deterministic record normalization, deduplication, and acceptance.

The module deliberately exposes one execution interface.  Callers choose a
profile instead of wiring three subtly different record-cleanup scripts.
"""

from .engine import (
    HygieneConfigError,
    HygieneInvariantError,
    HygieneResult,
    RecordHygieneError,
    execute_record_hygiene,
)

__all__ = [
    "HygieneConfigError",
    "HygieneInvariantError",
    "HygieneResult",
    "RecordHygieneError",
    "execute_record_hygiene",
]
