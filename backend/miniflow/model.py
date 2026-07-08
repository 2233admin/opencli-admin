"""MiniFlow data model: outcomes, domain errors, steps, and workflow ordering."""

from __future__ import annotations

import enum
import graphlib
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


class Outcome(enum.Enum):
    SUCCESS = "success"
    RETRIED = "retried"
    CIRCUIT_OPEN = "circuit_open"
    CRITICAL_FAILURE = "critical_failure"


class TransientError(Exception):
    """A retryable step failure."""


class CriticalError(Exception):
    """A non-retryable step failure."""


@dataclass
class Step:
    name: str
    run: Callable[[], Any]
    depends_on: list[str] = field(default_factory=list)


@dataclass
class Workflow:
    name: str
    steps: list[Step]

    def ordered(self) -> list[Step]:
        names = [step.name for step in self.steps]
        duplicates = sorted({name for name in names if names.count(name) > 1})
        if duplicates:
            raise ValueError(f"Duplicate step name(s): {', '.join(duplicates)}")

        by_name = {step.name: step for step in self.steps}
        unknown = sorted(
            {
                dependency
                for step in self.steps
                for dependency in step.depends_on
                if dependency not in by_name
            }
        )
        if unknown:
            raise ValueError(f"Unknown dependency name(s): {', '.join(unknown)}")

        declaration_index = {step.name: index for index, step in enumerate(self.steps)}
        sorter = graphlib.TopologicalSorter()
        for step in self.steps:
            sorter.add(step.name, *step.depends_on)

        sorter.prepare()
        ordered: list[Step] = []
        while sorter.is_active():
            ready = sorter.get_ready()
            for name in sorted(ready, key=lambda item: declaration_index[item]):
                ordered.append(by_name[name])
            sorter.done(*ready)
        return ordered
