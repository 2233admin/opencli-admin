"""Project Graphon run pages into the canonical OpenCLI workflow event shape."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from backend.schemas.dify_compat import DifyRuntimeEvent
from backend.workflow.dify_graphon_client import (
    DifyGraphonClient,
    DifyGraphonRunError,
    DifyGraphonUnavailableError,
)

DifyProjectedEventType = Literal[
    "queued",
    "started",
    "blocked",
    "tool_call_started",
    "tool_call_completed",
    "partial",
    "completed",
    "failed",
]
TERMINAL_RUNTIME_STATUSES = frozenset(
    {"completed", "failed", "cancelled", "paused"}
)
MAX_EVENT_PREVIEW_BYTES = 16 * 1024


@dataclass(frozen=True)
class DifyProjectedRuntimeEvent:
    runtime_run_id: str
    runtime_sequence: int
    event_type: DifyProjectedEventType
    source_node_id: str | None
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DifyGraphonRunResult:
    runtime_run_id: str | None
    status: Literal["completed", "blocked", "failed"]
    events: list[DifyProjectedRuntimeEvent]
    code: str | None = None
    message: str | None = None
    terminal_details: dict[str, Any] = field(default_factory=dict)


async def execute_dify_graphon_run(
    *,
    graphon_client: DifyGraphonClient,
    source_content: str,
    source_sha256: str,
    policy: dict[str, Any],
    inputs: dict[str, Any],
    grants: dict[str, Any],
) -> DifyGraphonRunResult:
    """Start one sidecar run and consume its replay pages with stable dedupe."""

    try:
        started = await graphon_client.start_run(
            source_content=source_content,
            source_sha256=source_sha256,
            policy=policy,
            inputs=inputs,
            grants=grants,
        )
    except DifyGraphonRunError as error:
        return DifyGraphonRunResult(
            runtime_run_id=None,
            status="blocked" if error.blocked else "failed",
            events=[],
            code=error.code,
            message=error.message,
        )
    except DifyGraphonUnavailableError:
        return _unavailable_result()

    runtime_run_id = started.runtime_run_id
    after_sequence = 0
    seen: set[tuple[str, int]] = set()
    projected: list[DifyProjectedRuntimeEvent] = []
    terminal_details: dict[str, Any] = {}
    timeout_seconds = max(float(getattr(graphon_client, "timeout_seconds", 15.0)), 0.1)
    deadline = time.monotonic() + timeout_seconds

    while time.monotonic() < deadline:
        try:
            page = await graphon_client.replay_events(
                runtime_run_id,
                after_sequence=after_sequence,
            )
        except DifyGraphonRunError as error:
            return DifyGraphonRunResult(
                runtime_run_id=runtime_run_id,
                status="blocked" if error.blocked else "failed",
                events=projected,
                code=error.code,
                message=error.message,
            )
        except DifyGraphonUnavailableError:
            return _unavailable_result(runtime_run_id, projected)

        for event in sorted(page.events, key=lambda item: item.sequence):
            identity = (runtime_run_id, event.sequence)
            if identity in seen:
                continue
            seen.add(identity)
            normalized = project_dify_runtime_event(runtime_run_id, event)
            if normalized is not None:
                projected.append(normalized)
            if event.event_type.startswith("graph_") or event.event_type.startswith(
                "runtime_"
            ):
                terminal_details = _safe_event_details(event.payload)

        after_sequence = max(
            after_sequence,
            page.next_sequence,
            *(event.sequence for event in page.events),
        )
        if page.status in TERMINAL_RUNTIME_STATUSES:
            if page.status == "completed":
                return DifyGraphonRunResult(
                    runtime_run_id=runtime_run_id,
                    status="completed",
                    events=projected,
                    terminal_details=terminal_details,
                )
            return DifyGraphonRunResult(
                runtime_run_id=runtime_run_id,
                status="failed",
                events=projected,
                code=(
                    "dify_runtime_cancelled"
                    if page.status == "cancelled"
                    else "dify_runtime_failed"
                ),
                message=f"Graphon workflow run ended with status {page.status}.",
                terminal_details=terminal_details,
            )
        await asyncio.sleep(0.05)

    try:
        await graphon_client.cancel_run(runtime_run_id)
    except (DifyGraphonRunError, DifyGraphonUnavailableError):
        pass
    return DifyGraphonRunResult(
        runtime_run_id=runtime_run_id,
        status="failed",
        events=projected,
        code="dify_runtime_timeout",
        message="The Graphon workflow run exceeded the OpenCLI polling deadline.",
    )


def project_dify_runtime_event(
    runtime_run_id: str,
    event: DifyRuntimeEvent,
) -> DifyProjectedRuntimeEvent | None:
    event_type = _event_type(event.event_type)
    if event_type is None:
        return None
    source_node_id = event.node_id
    return DifyProjectedRuntimeEvent(
        runtime_run_id=runtime_run_id,
        runtime_sequence=event.sequence,
        event_type=event_type,
        source_node_id=source_node_id,
        message=_event_message(event.event_type, source_node_id),
        details={
            "runtime": "graphon",
            "runtimeRunId": runtime_run_id,
            "runtimeSequence": event.sequence,
            "runtimeEventType": event.event_type,
            "outputPreview": _safe_event_details(event.payload),
        },
    )


def _event_type(event_type: str) -> DifyProjectedEventType | None:
    if event_type in {"graph_started"}:
        return None
    if event_type in {"node_scheduled", "node_retry"}:
        return "queued"
    if event_type == "node_started":
        return "started"
    if event_type in {"node_stream", "node_reasoning_stream", "output_truncated"}:
        return "partial"
    if "tool" in event_type and event_type.endswith(("started", "entered")):
        return "tool_call_started"
    if "tool" in event_type and event_type.endswith(("completed", "exited")):
        return "tool_call_completed"
    if event_type == "node_completed":
        return "completed"
    if event_type in {"node_blocked", "dependency_unavailable", "policy_blocked"}:
        return "blocked"
    if event_type in {
        "node_failed",
        "node_exception",
        "graph_failed",
        "graph_aborted",
        "runtime_failed",
    }:
        return "failed"
    if event_type in {
        "graph_completed",
        "graph_partially_completed",
        "graph_paused",
    }:
        return None
    return "partial"


def _event_message(event_type: str, source_node_id: str | None) -> str:
    subject = f'Dify node "{source_node_id}"' if source_node_id else "Dify graph"
    return f"{subject}: {event_type.replace('_', ' ')}"


def _safe_event_details(payload: Any) -> dict[str, Any]:
    sanitized = _sanitize_payload(payload)
    encoded = json.dumps(sanitized, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) <= MAX_EVENT_PREVIEW_BYTES:
        return sanitized if isinstance(sanitized, dict) else {"value": sanitized}
    preview = encoded.encode("utf-8")[:MAX_EVENT_PREVIEW_BYTES].decode(
        "utf-8",
        errors="ignore",
    )
    return {"preview": preview, "truncated": True}


def _sanitize_payload(value: Any, *, key: str = "") -> Any:
    normalized_key = key.lower().replace("-", "_")
    if any(
        token in normalized_key
        for token in (
            "api_key",
            "authorization",
            "credential",
            "password",
            "secret",
            "token",
            "grant",
            "source_content",
            "sourcecontent",
        )
    ):
        return "[REDACTED]"
    if normalized_key in {"source", "headers", "cookies"}:
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            str(item_key): _sanitize_payload(item, key=str(item_key))
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_payload(item) for item in value]
    return value


def _unavailable_result(
    runtime_run_id: str | None = None,
    events: list[DifyProjectedRuntimeEvent] | None = None,
) -> DifyGraphonRunResult:
    return DifyGraphonRunResult(
        runtime_run_id=runtime_run_id,
        status="failed",
        events=list(events or []),
        code="dify_graphon_unavailable",
        message="The pinned Graphon compatibility runtime is unavailable.",
    )
