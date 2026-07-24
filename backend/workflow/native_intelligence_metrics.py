"""Bounded operational metrics for the native intelligence lifecycle."""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from threading import Lock
from typing import Final
from uuid import uuid4

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.intelligence import IntelligenceOutbox

TRANSITION_CONFLICT_REASONS: Final = (
    "version",
    "idempotency",
    "lease",
    "state",
    "other",
)
REJECTED_CONTRACT_REASONS: Final = (
    "artifact_invariant",
    "artifact_contract",
    "command_contract",
    "readiness_contract",
    "other",
)
READINESS_BLOCKED_REASONS: Final = (
    "executor_registered",
    "contract_complete",
    "fixture_evidence_registered",
    "gates_resolvable",
    "other",
)

_lock = Lock()
_transition_conflicts: Counter[str] = Counter()
_rejected_contracts: Counter[str] = Counter()
_readiness_blocked: Counter[str] = Counter()
_PROCESS_INSTANCE_ID: Final = uuid4().hex
_PROCESS_STARTED_AT: Final = datetime.now(UTC).isoformat()


def _bounded_reason(value: str, allowed: tuple[str, ...]) -> str:
    return value if value in allowed else "other"


def record_transition_conflict(reason: str) -> None:
    with _lock:
        _transition_conflicts[_bounded_reason(reason, TRANSITION_CONFLICT_REASONS)] += 1


def record_rejected_contract(reason: str) -> None:
    with _lock:
        _rejected_contracts[_bounded_reason(reason, REJECTED_CONTRACT_REASONS)] += 1


def record_readiness_blocked(reasons: list[str]) -> None:
    with _lock:
        for reason in reasons:
            _readiness_blocked[
                _bounded_reason(reason, READINESS_BLOCKED_REASONS)
            ] += 1


def counter_snapshot() -> dict[str, object]:
    with _lock:
        return {
            "scope": "process",
            "processInstanceId": _PROCESS_INSTANCE_ID,
            "processStartedAt": _PROCESS_STARTED_AT,
            "transitionConflicts": {
                reason: _transition_conflicts[reason]
                for reason in TRANSITION_CONFLICT_REASONS
            },
            "rejectedContracts": {
                reason: _rejected_contracts[reason]
                for reason in REJECTED_CONTRACT_REASONS
            },
            "readinessBlocked": {
                reason: _readiness_blocked[reason]
                for reason in READINESS_BLOCKED_REASONS
            },
        }


async def outbox_snapshot(session: AsyncSession) -> dict[str, int | float]:
    pending_count, oldest_pending_at, retry_count, failure_count = (
        await session.execute(
            select(
                func.count(IntelligenceOutbox.id),
                func.min(IntelligenceOutbox.available_at),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                IntelligenceOutbox.attempts > 1,
                                IntelligenceOutbox.attempts - 1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                IntelligenceOutbox.last_error.is_not(None)
                                & (IntelligenceOutbox.last_error != ""),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .where(IntelligenceOutbox.state == "pending")
        )
    ).one()
    now = datetime.now(UTC)
    if oldest_pending_at is None:
        oldest_age = 0.0
    else:
        available_at = (
            oldest_pending_at.replace(tzinfo=UTC)
            if oldest_pending_at.tzinfo is None
            else oldest_pending_at.astimezone(UTC)
        )
        oldest_age = max(0.0, (now - available_at).total_seconds())
    return {
        "pendingCount": int(pending_count or 0),
        "oldestPendingAgeSeconds": round(oldest_age, 3),
        "retryCount": int(retry_count or 0),
        "failureCount": int(failure_count or 0),
    }


def reset_for_tests() -> None:
    with _lock:
        _transition_conflicts.clear()
        _rejected_contracts.clear()
        _readiness_blocked.clear()


__all__ = [
    "counter_snapshot",
    "outbox_snapshot",
    "record_readiness_blocked",
    "record_rejected_contract",
    "record_transition_conflict",
    "reset_for_tests",
]
