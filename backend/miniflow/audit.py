"""Append-only JSONL audit sink for built-in MiniFlow runs."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any


class AuditLog:
    """Record one JSONL row per MiniFlow step attempt.

    When ``path`` is ``None`` the log is in-memory only via ``on_record``. This
    keeps the runtime adapter useful for workflow trace streaming without
    forcing every run to write an artifact.
    """

    def __init__(
        self,
        path: str | Path | None,
        clock: Callable[[], float],
        on_record: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.path = Path(path) if path is not None else None
        self.clock = clock
        self._on_record = on_record

    def record(self, step: str, attempt: int, outcome: str, error: str | None = None) -> None:
        entry = {
            "ts": self.clock(),
            "step": step,
            "attempt": attempt,
            "outcome": outcome,
            "error": error,
        }
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        if self._on_record is not None:
            self._on_record(entry)
