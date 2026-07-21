from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from contracts import RuntimeContractError

EVICTABLE_RUN_STATUSES = frozenset({"completed", "failed", "cancelled", "paused"})


@dataclass
class RunRecord:
    runtime_run_id: str
    status: str = "queued"
    events: list[dict[str, Any]] = field(default_factory=list)
    cancel_requested: bool = False
    command_channel: Any = None
    output_bytes: int = 0
    output_truncated: bool = False
    updated_at: float = field(default_factory=time.monotonic)


class RunRegistry:
    def __init__(self, *, max_stored_runs: int, retention_seconds: int) -> None:
        self.max_stored_runs = max_stored_runs
        self.retention_seconds = retention_seconds
        self.lock = threading.RLock()
        self._records: dict[str, RunRecord] = {}

    def active_count(self) -> int:
        return sum(
            record.status in {"queued", "running"} for record in self._records.values()
        )

    def create(self, runtime_run_id: str) -> RunRecord:
        self._make_slot()
        record = RunRecord(runtime_run_id=runtime_run_id)
        self._records[runtime_run_id] = record
        return record

    def get(self, runtime_run_id: str) -> RunRecord:
        try:
            return self._records[runtime_run_id]
        except KeyError:
            raise RuntimeContractError(
                "run.not_found",
                "The requested runtime run does not exist.",
                status_code=404,
            ) from None

    def prune_expired(self) -> None:
        cutoff = time.monotonic() - self.retention_seconds
        expired_run_ids = [
            runtime_run_id
            for runtime_run_id, record in self._records.items()
            if record.status in EVICTABLE_RUN_STATUSES and record.updated_at < cutoff
        ]
        for runtime_run_id in expired_run_ids:
            self._records.pop(runtime_run_id, None)

    def _make_slot(self) -> None:
        self.prune_expired()
        if len(self._records) < self.max_stored_runs:
            return

        evictable = sorted(
            (
                record
                for record in self._records.values()
                if record.status in EVICTABLE_RUN_STATUSES
            ),
            key=lambda record: record.updated_at,
        )
        while len(self._records) >= self.max_stored_runs and evictable:
            oldest = evictable.pop(0)
            self._records.pop(oldest.runtime_run_id, None)

        if len(self._records) >= self.max_stored_runs:
            raise RuntimeContractError(
                "run.registry_capacity_exceeded",
                "The runtime run registry has reached its configured limit.",
                status_code=429,
            )
