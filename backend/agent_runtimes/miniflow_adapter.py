"""Built-in adapter for MiniFlow-compatible local workflow files."""

from __future__ import annotations

import asyncio
import os
import time
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

from backend.agent_runtimes.base import (
    AgentTask,
    RuntimeAdapter,
    RuntimeCapabilities,
    event_done,
    event_error,
    event_started,
    event_state,
    event_tool_call,
    event_tool_result,
)
from backend.agent_runtimes.registry import register_runtime
from backend.miniflow.audit import AuditLog
from backend.miniflow.loader import confine_to_workflow_root, load_workflow_file
from backend.miniflow.model import Outcome
from backend.miniflow.runner import RunResult, run_workflow

_RUN_WORKFLOWS = {"run", "workflow.run", "miniflow.run"}
_DEFAULT_MAX_ATTEMPTS = 3
_DEFAULT_BREAKER_THRESHOLD = 3
_DEFAULT_BASE_DELAY = 0.1


@register_runtime
class MiniFlowRuntimeAdapter(RuntimeAdapter):
    """Run a MiniFlow workflow file inside the edge agent process."""

    runtime_type = "miniflow"
    capabilities = RuntimeCapabilities(
        transport="inprocess",
        streaming=True,
        resume_by_id=False,
        checkpoint="none",
        concurrent_sessions=True,
    )

    def validate_config(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        for key in ("workflow_path", "audit_log", "cwd"):
            if key in config and config[key] is not None and not isinstance(config[key], str):
                errors.append(f"'{key}' must be a string when provided")
        _validate_positive_int(config, "max_attempts", errors)
        _validate_positive_int(config, "breaker_threshold", errors)
        if "base_delay" in config and config["base_delay"] is not None:
            base_delay = config["base_delay"]
            if (
                not isinstance(base_delay, (int, float))
                or isinstance(base_delay, bool)
                or base_delay < 0
            ):
                errors.append("'base_delay' must be a non-negative number when provided")
        return errors

    async def health(self) -> bool:
        return True

    @classmethod
    def is_available(cls) -> bool:
        return True

    async def invoke(self, task: AgentTask) -> AsyncIterator[dict[str, Any]]:
        errors = self.validate_config(task.config or {})
        if errors:
            yield event_error(task.task_id, "; ".join(errors), error_type="ValueError")
            return

        try:
            run_request = _build_run_request(task)
        except (TypeError, ValueError) as exc:
            yield event_error(task.task_id, str(exc), error_type=type(exc).__name__)
            return

        yield event_started(task.task_id)

        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        runner_task = asyncio.create_task(
            asyncio.to_thread(self._run_sync, task, run_request, queue, loop)
        )
        audit_entries: list[dict[str, Any]] = []

        try:
            while not runner_task.done() or not queue.empty():
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=0.05)
                except TimeoutError:
                    continue
                audit_entries.append(entry)
                yield event_tool_call(
                    task.task_id,
                    entry["step"],
                    args={"attempt": entry["attempt"], "outcome": entry["outcome"]},
                )
                yield event_tool_result(
                    task.task_id,
                    entry["step"],
                    result=entry,
                    is_error=entry["outcome"] != "success",
                )

            result = await runner_task
        except Exception as exc:
            yield event_error(task.task_id, f"MiniFlow run failed: {exc}", type(exc).__name__)
            return

        payload = _run_result_payload(result, audit_entries)
        yield event_state(task.task_id, {"miniflow": payload})
        if result.success:
            yield event_done(task.task_id, result=payload)
            return

        yield event_error(
            task.task_id,
            _failure_message(result),
            error_type="MiniFlowRunFailed",
        )

    def _run_sync(
        self,
        task: AgentTask,
        request: _RunRequest,
        queue: asyncio.Queue[dict[str, Any]],
        loop: asyncio.AbstractEventLoop,
    ) -> RunResult:
        workflow = load_workflow_file(request.workflow_path)

        def emit(entry: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, entry)

        audit = AuditLog(request.audit_log, request.clock, on_record=emit)
        return run_workflow(
            workflow,
            clock=request.clock,
            sleep=request.sleep,
            audit=audit,
            max_attempts=request.max_attempts,
            base_delay=request.base_delay,
            breaker_threshold=request.breaker_threshold,
        )


class _RunRequest:
    def __init__(
        self,
        *,
        workflow_path: Path,
        audit_log: Path | None,
        max_attempts: int,
        breaker_threshold: int,
        base_delay: float,
        clock: Callable[[], float],
        sleep: Callable[[float], Any],
    ) -> None:
        self.workflow_path = workflow_path
        self.audit_log = audit_log
        self.max_attempts = max_attempts
        self.breaker_threshold = breaker_threshold
        self.base_delay = base_delay
        self.clock = clock
        self.sleep = sleep


def _build_run_request(task: AgentTask) -> _RunRequest:
    payload = task.input if isinstance(task.input, dict) else {}
    config = task.config or {}
    cwd = _resolve_cwd(config.get("cwd"))
    workflow_ref = _string(payload.get("workflow_path")) or _string(config.get("workflow_path"))
    if not workflow_ref and task.workflow not in _RUN_WORKFLOWS:
        workflow_ref = task.workflow
    if not workflow_ref:
        raise ValueError(
            "MiniFlow run requires input.workflow_path/config.workflow_path "
            'or workflow="<workflow.py>"'
        )

    audit_ref = _string(payload.get("audit_log")) or _string(config.get("audit_log"))
    clock = config.get("_clock") if callable(config.get("_clock")) else time.monotonic
    sleep = config.get("_sleep") if callable(config.get("_sleep")) else time.sleep
    # Confine both to the MiniFlow allowlist root: workflow_path is executed
    # by loader.load_workflow_file (RCE surface) and audit_log is opened for
    # append with parents auto-created (arbitrary-file-write surface). Both
    # are attacker-influenced via task.input/task.config.
    workflow_path = confine_to_workflow_root(
        _resolve_path(workflow_ref, cwd), label="workflow_path"
    )
    audit_log = (
        confine_to_workflow_root(_resolve_path(audit_ref, cwd), label="audit_log")
        if audit_ref
        else None
    )
    return _RunRequest(
        workflow_path=workflow_path,
        audit_log=audit_log,
        max_attempts=_positive_int(payload, config, "max_attempts", _DEFAULT_MAX_ATTEMPTS),
        breaker_threshold=_positive_int(
            payload, config, "breaker_threshold", _DEFAULT_BREAKER_THRESHOLD
        ),
        base_delay=_non_negative_float(payload, config, "base_delay", _DEFAULT_BASE_DELAY),
        clock=clock,
        sleep=sleep,
    )


def _resolve_cwd(raw: object) -> Path:
    cwd = _string(raw)
    if not cwd:
        return Path.cwd()
    # An explicit cwd is attacker-influenced (task.config["cwd"]) and is used
    # as the base for resolving relative workflow_path/audit_log values, so it
    # must be confined too — otherwise a rooted-looking relative path could
    # still land outside the root via a malicious cwd.
    return confine_to_workflow_root(cwd, label="cwd")


def _resolve_path(raw: str, cwd: Path) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(raw)))
    if not path.is_absolute():
        path = cwd / path
    return path.resolve()


def _run_result_payload(result: RunResult, audit_entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "workflow": result.workflow_name,
        "success": result.success,
        "steps": [
            {
                "name": step.name,
                "outcome": step.outcome.value,
                "attempts": step.attempts,
            }
            for step in result.step_results
        ],
        "skipped": list(result.skipped),
        "wall_time": result.wall_time,
        "audit_path": str(result.audit_path) if result.audit_path else None,
        "audit": audit_entries,
    }


def _failure_message(result: RunResult) -> str:
    failed = [
        f"{step.name}:{step.outcome.value}"
        for step in result.step_results
        if step.outcome not in (Outcome.SUCCESS, Outcome.RETRIED)
    ]
    if result.skipped:
        failed.extend(f"{name}:skipped" for name in result.skipped)
    suffix = ", ".join(failed) if failed else "not all steps succeeded"
    return f"MiniFlow workflow {result.workflow_name!r} failed ({suffix})"


def _validate_positive_int(config: dict[str, Any], key: str, errors: list[str]) -> None:
    if key not in config or config[key] is None:
        return
    value = config[key]
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        errors.append(f"'{key}' must be a positive integer when provided")


def _positive_int(payload: dict[str, Any], config: dict[str, Any], key: str, default: int) -> int:
    raw = payload.get(key, config.get(key, default))
    if not isinstance(raw, int) or isinstance(raw, bool) or raw <= 0:
        raise ValueError(f"'{key}' must be a positive integer")
    return raw


def _non_negative_float(
    payload: dict[str, Any],
    config: dict[str, Any],
    key: str,
    default: float,
) -> float:
    raw = payload.get(key, config.get(key, default))
    if not isinstance(raw, (int, float)) or isinstance(raw, bool) or raw < 0:
        raise ValueError(f"'{key}' must be a non-negative number")
    return float(raw)


def _string(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
