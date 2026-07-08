"""Dependency-free MiniFlow runner with retry, circuit breaker, and audit hooks."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from backend.miniflow.model import CriticalError, Outcome, Step, TransientError, Workflow


@dataclass
class StepResult:
    name: str
    outcome: Outcome
    attempts: int


@dataclass
class RunResult:
    workflow_name: str
    step_results: list[StepResult] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    wall_time: float = 0.0
    audit_path: object = None

    @property
    def success(self) -> bool:
        return all(
            result.outcome in (Outcome.SUCCESS, Outcome.RETRIED)
            for result in self.step_results
        )


class CircuitBreaker:
    def __init__(self, threshold: int) -> None:
        self.threshold = threshold
        self._failures = 0

    def record_failure(self) -> None:
        self._failures += 1

    def record_success(self) -> None:
        self._failures = 0

    @property
    def is_open(self) -> bool:
        return self._failures >= self.threshold


def execute_step(
    step: Step,
    breaker: CircuitBreaker | None = None,
    *,
    clock: Callable[[], float],
    sleep: Callable[[float], Any],
    audit: Any = None,
    max_attempts: int,
    base_delay: float,
) -> tuple[Outcome, int]:
    if breaker is not None and breaker.is_open:
        if audit is not None:
            audit.record(step.name, 0, "circuit_open")
        return Outcome.CIRCUIT_OPEN, 0

    for attempt in range(1, max_attempts + 1):
        try:
            step.run()
        except CriticalError as exc:
            if breaker is not None:
                breaker.record_failure()
            if audit is not None:
                audit.record(step.name, attempt, "critical_failure", str(exc))
            return Outcome.CRITICAL_FAILURE, attempt
        except TransientError as exc:
            if breaker is not None:
                breaker.record_failure()
                if breaker.is_open:
                    if audit is not None:
                        audit.record(step.name, attempt, "circuit_open", str(exc))
                    return Outcome.CIRCUIT_OPEN, attempt
            if audit is not None:
                audit.record(step.name, attempt, "transient_failure", str(exc))
            if attempt < max_attempts:
                sleep(base_delay * 2 ** (attempt - 1))
                continue
            return Outcome.CRITICAL_FAILURE, attempt
        else:
            if breaker is not None:
                breaker.record_success()
            if audit is not None:
                audit.record(step.name, attempt, "success")
            return (Outcome.SUCCESS if attempt == 1 else Outcome.RETRIED), attempt

    return Outcome.CRITICAL_FAILURE, max_attempts


def run_workflow(
    workflow: Workflow,
    *,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Any] = time.sleep,
    audit: Any = None,
    max_attempts: int = 3,
    base_delay: float = 0.1,
    breaker_threshold: int = 3,
) -> RunResult:
    breakers: dict[str, CircuitBreaker] = {}
    poisoned: set[str] = set()
    result = RunResult(
        workflow_name=workflow.name,
        audit_path=getattr(audit, "path", None),
    )

    start = clock()
    for step in workflow.ordered():
        if poisoned.intersection(step.depends_on):
            poisoned.add(step.name)
            result.skipped.append(step.name)
            continue

        breaker = breakers.setdefault(step.name, CircuitBreaker(breaker_threshold))
        outcome, attempts = execute_step(
            step,
            breaker,
            clock=clock,
            sleep=sleep,
            audit=audit,
            max_attempts=max_attempts,
            base_delay=base_delay,
        )
        result.step_results.append(StepResult(step.name, outcome, attempts))

        if outcome in (Outcome.CIRCUIT_OPEN, Outcome.CRITICAL_FAILURE):
            poisoned.add(step.name)
        if outcome is Outcome.CRITICAL_FAILURE:
            break

    result.wall_time = clock() - start
    return result
