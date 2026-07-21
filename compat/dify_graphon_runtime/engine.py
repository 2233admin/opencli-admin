from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass
from importlib import metadata
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import yaml

from contracts import CONTRACT_VERSION, InspectRequest, RunRequest, RuntimeContractError

GRAPHON_COMMIT = "b187ce7927fea1a7c137b642be3f78e3abb9f7de"
GRAPHON_EXPECTED_VERSION = "0.7.0"
SLIM_COMMIT = "14877f8f8b6dd63d3cec760411a875cc8e077547"
SLIM_VERSION = "0.6.5"


@dataclass(frozen=True)
class RuntimeLimits:
    max_request_bytes: int = 1_048_576
    max_output_bytes: int = 1_048_576
    execution_timeout_seconds: int = 120
    max_concurrent_runs: int = 2

    @classmethod
    def from_environment(cls) -> RuntimeLimits:
        return cls(
            max_request_bytes=_positive_int(
                "DIFY_GRAPHON_MAX_REQUEST_BYTES", cls.max_request_bytes
            ),
            max_output_bytes=_positive_int(
                "DIFY_GRAPHON_MAX_OUTPUT_BYTES", cls.max_output_bytes
            ),
            execution_timeout_seconds=_positive_int(
                "DIFY_GRAPHON_EXECUTION_TIMEOUT_SECONDS",
                cls.execution_timeout_seconds,
            ),
            max_concurrent_runs=_positive_int(
                "DIFY_GRAPHON_MAX_CONCURRENT_RUNS", cls.max_concurrent_runs
            ),
        )


@dataclass
class RunRecord:
    runtime_run_id: str
    status: str = "queued"
    events: list[dict[str, Any]] | None = None
    cancel_requested: bool = False
    command_channel: Any = None
    output_bytes: int = 0
    output_truncated: bool = False

    def __post_init__(self) -> None:
        if self.events is None:
            self.events = []


@dataclass(frozen=True)
class EngineIdentity:
    name: str = "graphon"
    version: str = GRAPHON_EXPECTED_VERSION
    commit: str = GRAPHON_COMMIT

    def as_dict(self) -> dict[str, str]:
        return {
            "name": self.name,
            "version": self.version,
            "commit": self.commit,
        }


class GraphonRuntime:
    def __init__(self, *, limits: RuntimeLimits | None = None) -> None:
        self.identity = EngineIdentity()
        self.limits = limits or RuntimeLimits.from_environment()
        self._import_error: str | None = None
        self._inspect_dsl: Any = None
        self._load_dsl: Any = None
        self._dsl_error: type[Exception] = Exception
        self._in_memory_channel: Any = None
        self._abort_command: Any = None
        self._sandbox_endpoint = os.getenv("DIFY_SANDBOX_ENDPOINT", "").strip()
        self._sandbox_api_key = os.getenv("DIFY_SANDBOX_API_KEY", "").strip()
        self._slim_path, self._slim_detected_version = _resolve_slim_helper()
        if self._slim_path:
            os.environ["SLIM_BINARY_PATH"] = self._slim_path
        self._runs: dict[str, RunRecord] = {}
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(
            max_workers=self.limits.max_concurrent_runs,
            thread_name_prefix="graphon-run",
        )
        try:
            from graphon.dsl import DslError, inspect, loads
            from graphon.graph_engine.command_channels import InMemoryChannel
            from graphon.graph_engine.entities.commands import AbortCommand

            self._inspect_dsl = inspect
            self._load_dsl = loads
            self._dsl_error = DslError
            self._in_memory_channel = InMemoryChannel
            self._abort_command = AbortCommand
            installed_version = metadata.version("graphon")
            if installed_version != GRAPHON_EXPECTED_VERSION:
                self._import_error = (
                    "Graphon version mismatch: expected "
                    f"{GRAPHON_EXPECTED_VERSION}, found {installed_version}."
                )
        except (
            Exception
        ) as error:  # pragma: no cover - exercised via public health seam
            self._import_error = f"Graphon import failed: {type(error).__name__}."

    @property
    def healthy(self) -> bool:
        return self._import_error is None

    @property
    def health_reason(self) -> str | None:
        return self._import_error

    @property
    def helpers(self) -> dict[str, dict[str, str | bool]]:
        return {
            "slim": {
                "name": "dify-plugin-daemon-slim",
                "version": SLIM_VERSION,
                "commit": SLIM_COMMIT,
                "available": self._slim_path is not None,
                "detectedVersion": self._slim_detected_version or "",
            }
        }

    def inspect(self, request: InspectRequest) -> dict[str, Any]:
        self._require_healthy()
        self._enforce_source_size(request.source.content)
        self._verify_digest(request.source.content, request.source.sha256)
        try:
            plan = self._inspect_dsl(request.source.content)
        except self._dsl_error as error:
            raise RuntimeContractError(
                getattr(error, "code", "dsl.invalid"),
                str(error),
                details=_dsl_error_details(error),
            ) from None

        graph_config = plan.document.graph_config or {}
        nodes = [_normalize_node(node) for node in graph_config.get("nodes", [])]
        blockers = _policy_blockers(
            nodes,
            request,
            sandbox_available=bool(self._sandbox_endpoint),
        )
        blocked_node_ids = {blocker["nodeId"] for blocker in blockers}
        for node in nodes:
            node["status"] = (
                "blocked" if node["sourceNodeId"] in blocked_node_ids else "ready"
            )
        graphon_status = str(plan.load_status)
        load_status = {
            "loadable": "ready",
            "unsupported": "unsupported",
            "failed": "failed",
        }.get(graphon_status, "failed")
        if blockers and load_status == "ready":
            load_status = "blocked"

        return {
            "loadStatus": load_status,
            "loadReason": plan.load_reason,
            "engine": self.identity.as_dict(),
            "appMode": _app_mode(request.source.content),
            "nodes": nodes,
            "dependencies": _normalize_dependencies(
                graph_config,
                list(plan.dependencies),
            ),
            "blockers": blockers,
        }

    def start_run(self, request: RunRequest) -> dict[str, Any]:
        inspection = self.inspect(request)
        if inspection["loadStatus"] != "ready":
            raise RuntimeContractError(
                f"run.{inspection['loadStatus']}",
                inspection.get("loadReason")
                or "The workflow is not ready to execute under the current policy.",
                status_code=409,
                details={"blockers": inspection["blockers"]},
            )

        with self._lock:
            active_count = sum(
                record.status in {"queued", "running"} for record in self._runs.values()
            )
            if active_count >= self.limits.max_concurrent_runs:
                raise RuntimeContractError(
                    "run.capacity_exceeded",
                    "The runtime has reached its concurrent execution limit.",
                    status_code=429,
                )
            runtime_run_id = str(uuid4())
            self._runs[runtime_run_id] = RunRecord(runtime_run_id=runtime_run_id)

        self._executor.submit(self._execute_run, runtime_run_id, request)
        return {
            "contractVersion": CONTRACT_VERSION,
            "runtimeRunId": runtime_run_id,
            "status": "queued",
            "eventsUrl": f"/v1/dify/runs/{runtime_run_id}/events",
        }

    def replay_events(
        self,
        runtime_run_id: str,
        *,
        after_sequence: int,
    ) -> dict[str, Any]:
        with self._lock:
            record = self._get_run(runtime_run_id)
            events = [
                event
                for event in record.events or []
                if event["sequence"] > after_sequence
            ]
            latest_sequence = max(
                after_sequence,
                (record.events or [{}])[-1].get("sequence", 0),
            )
            return {
                "contractVersion": CONTRACT_VERSION,
                "runtimeRunId": runtime_run_id,
                "status": record.status,
                "nextSequence": latest_sequence,
                "events": events,
            }

    def cancel_run(self, runtime_run_id: str) -> dict[str, Any]:
        with self._lock:
            record = self._get_run(runtime_run_id)
            already_requested = record.cancel_requested
            record.cancel_requested = True
            if (
                not already_requested
                and record.command_channel is not None
                and record.status
                in {
                    "queued",
                    "running",
                }
            ):
                record.command_channel.send_command(
                    self._abort_command(
                        reason="Cancelled through the OpenCLI contract."
                    )
                )
            return {
                "contractVersion": CONTRACT_VERSION,
                "runtimeRunId": runtime_run_id,
                "status": record.status,
                "cancelRequested": True,
            }

    def _execute_run(self, runtime_run_id: str, request: RunRequest) -> None:
        secrets = set(_secret_values(request.grants))
        if self._sandbox_api_key:
            secrets.add(self._sandbox_api_key)
        timer: threading.Timer | None = None
        try:
            with self._lock:
                record = self._get_run(runtime_run_id)
                if record.cancel_requested:
                    record.status = "cancelled"
                    return
                record.status = "running"

            command_channel = self._in_memory_channel()
            with self._lock:
                record.command_channel = command_channel

            timer = threading.Timer(
                self.limits.execution_timeout_seconds,
                lambda: command_channel.send_command(
                    self._abort_command(reason="Execution time limit exceeded.")
                ),
            )
            timer.daemon = True
            timer.start()
            credentials = deepcopy(request.grants)
            if self._sandbox_endpoint:
                code_settings = credentials.setdefault("code", {})
                code_settings.setdefault("execution_endpoint", self._sandbox_endpoint)
                if self._sandbox_api_key:
                    code_settings.setdefault("execution_api_key", self._sandbox_api_key)
            if self._slim_path:
                slim_settings = credentials.setdefault("slim", {})
                slim_settings.setdefault(
                    "plugin_folder",
                    os.getenv(
                        "DIFY_GRAPHON_SLIM_PLUGIN_FOLDER",
                        "/tmp/dify-graphon/slim/plugins",
                    ),
                )
            graph_engine = self._load_dsl(
                request.source.content,
                credentials=credentials or None,
                workflow_id=runtime_run_id,
                start_inputs=request.inputs,
                command_channel=command_channel,
            )
            for graphon_event in graph_engine.run():
                normalized = _normalize_event(graphon_event, secrets=secrets)
                self._append_event(runtime_run_id, normalized)
                terminal_status = _terminal_status(normalized["eventType"])
                if terminal_status is not None:
                    with self._lock:
                        record.status = terminal_status

            with self._lock:
                if record.status == "running":
                    record.status = "completed"
        except Exception as error:
            with self._lock:
                record = self._get_run(runtime_run_id)
                already_failed = bool(
                    record.events
                    and record.events[-1]["eventType"]
                    in {"graph_failed", "graph_aborted"}
                )
            if not already_failed:
                self._append_event(
                    runtime_run_id,
                    {
                        "eventType": "runtime_failed",
                        "payload": {
                            "code": getattr(error, "code", "runtime.execution_failed"),
                            "message": _redact_text(str(error), secrets),
                        },
                    },
                )
            with self._lock:
                record.status = "cancelled" if record.cancel_requested else "failed"
        finally:
            if timer is not None:
                timer.cancel()
            with self._lock:
                self._get_run(runtime_run_id).command_channel = None

    def _append_event(self, runtime_run_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            record = self._get_run(runtime_run_id)
            if record.output_truncated:
                return
            sequence = len(record.events or []) + 1
            bounded_event = {"sequence": sequence, **event}
            if record.events is None:
                record.events = []
            candidate_size = _json_size([*record.events, bounded_event])
            if candidate_size > self.limits.max_output_bytes:
                record.output_truncated = True
                marker = {
                    "sequence": sequence,
                    "eventType": "output_truncated",
                    "payload": {"maxBytes": self.limits.max_output_bytes},
                }
                while (
                    record.events
                    and _json_size([*record.events, marker])
                    > self.limits.max_output_bytes
                ):
                    record.events.pop()
                marker["sequence"] = len(record.events) + 1
                if _json_size([*record.events, marker]) <= self.limits.max_output_bytes:
                    record.events.append(marker)
                    record.output_bytes = _json_size(record.events)
                return
            record.events.append(bounded_event)
            record.output_bytes = candidate_size

    def _get_run(self, runtime_run_id: str) -> RunRecord:
        try:
            return self._runs[runtime_run_id]
        except KeyError:
            raise RuntimeContractError(
                "run.not_found",
                "The requested runtime run does not exist.",
                status_code=404,
            ) from None

    def _enforce_source_size(self, content: str) -> None:
        if len(content.encode()) > self.limits.max_request_bytes:
            raise RuntimeContractError(
                "request.too_large",
                "The DSL source exceeds the configured request limit.",
                status_code=413,
                details={"maxBytes": self.limits.max_request_bytes},
            )

    def _require_healthy(self) -> None:
        if not self.healthy:
            raise RuntimeContractError(
                "engine.unavailable",
                "The pinned Graphon engine is unavailable.",
                status_code=503,
            )

    @staticmethod
    def _verify_digest(content: str, expected_digest: str) -> None:
        actual_digest = hashlib.sha256(content.encode()).hexdigest()
        if actual_digest != expected_digest:
            raise RuntimeContractError(
                "source.digest_mismatch",
                "The DSL content does not match source.sha256.",
                details={"actualSha256": actual_digest},
            )


def _dsl_error_details(error: Exception) -> dict[str, Any]:
    details: dict[str, Any] = {}
    for name in ("path", "kind", "details"):
        value = getattr(error, name, None)
        if value is not None:
            details[name] = value
    return details


def _normalize_node(node: Any) -> dict[str, str]:
    if not isinstance(node, dict):
        return {"sourceNodeId": "", "type": "unknown"}
    raw_data = node.get("data")
    data: dict[str, Any] = raw_data if isinstance(raw_data, dict) else {}
    return {
        "sourceNodeId": str(node.get("id") or ""),
        "type": str(data.get("type") or "unknown"),
    }


def _policy_blockers(
    nodes: list[dict[str, str]],
    request: InspectRequest,
    *,
    sandbox_available: bool,
) -> list[dict[str, str]]:
    blockers: list[dict[str, str]] = []
    for node in nodes:
        node_type = node["type"]
        blocker: tuple[str, str] | None = None
        if node_type == "code" and (
            not request.policy.allow_code or not sandbox_available
        ):
            blocker = (
                "dify_sandbox_required",
                "Code nodes require an explicitly configured Dify sandbox.",
            )
        elif node_type == "http-request" and not request.policy.allow_network:
            blocker = (
                "network_permission_required",
                "HTTP request nodes require explicit network permission.",
            )
        elif node_type == "tool":
            blocker = (
                "tool_adapter_required",
                "Tool nodes require an installed OpenCLI adapter.",
            )
        if blocker is not None:
            blockers.append(
                {
                    "code": blocker[0],
                    "message": blocker[1],
                    "nodeId": node["sourceNodeId"],
                }
            )
    return blockers


def _app_mode(content: str) -> str | None:
    try:
        payload = yaml.safe_load(content)
    except yaml.YAMLError:
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("app"), dict):
        return None
    mode = payload["app"].get("mode")
    return str(mode) if mode is not None else None


def _positive_int(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default


def _resolve_slim_helper() -> tuple[str | None, str | None]:
    configured_path = os.getenv("DIFY_GRAPHON_SLIM_PATH", "").strip()
    binary_path = configured_path or shutil.which("dify-plugin-daemon-slim")
    if (
        not binary_path
        or not os.path.isfile(binary_path)
        or not os.access(binary_path, os.X_OK)
    ):
        return None, None
    try:
        completed = subprocess.run(
            [binary_path, "version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None, None
    output_lines = completed.stdout.strip().splitlines()
    detected_version = output_lines[-1] if output_lines else ""
    if completed.returncode != 0 or detected_version != SLIM_VERSION:
        return None, detected_version or None
    return binary_path, detected_version


def _normalize_dependencies(
    graph_config: Any,
    graphon_dependencies: list[Any],
) -> list[dict[str, str]]:
    dependencies: set[tuple[str, str]] = set()
    nodes = graph_config.get("nodes", []) if isinstance(graph_config, dict) else []
    node_types: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
            continue
        data = node["data"]
        node_type = str(data.get("type") or "unknown")
        node_types.add(node_type)
        if node_type == "llm":
            model = data.get("model") if isinstance(data.get("model"), dict) else {}
            identity = str(model.get("provider") or model.get("name") or "model")
            dependencies.add(("model", identity))
        elif node_type == "tool":
            identity = str(
                data.get("provider_id")
                or data.get("provider_name")
                or data.get("tool_name")
                or "tool-adapter"
            )
            dependencies.add(("tool", identity))
        elif node_type == "code":
            dependencies.add(("sandbox", "dify-sandbox"))
        elif node_type == "http-request":
            hostname = urlparse(str(data.get("url") or "")).hostname
            dependencies.add(("network", hostname or "outbound-http"))

    dependency_types = [
        dependency_type
        for dependency_type, node_type in (("model", "llm"), ("tool", "tool"))
        if node_type in node_types
    ]
    for dependency in graphon_dependencies:
        raw_identity = (
            getattr(dependency, "plugin_unique_identifier", None)
            or getattr(dependency, "package", None)
            or getattr(dependency, "repo", None)
        )
        if raw_identity:
            for dependency_type in dependency_types:
                dependencies.add((dependency_type, str(raw_identity)))

    return [
        {"type": dependency_type, "id": identity}
        for dependency_type, identity in sorted(dependencies)
    ]


def _normalize_event(event: Any, *, secrets: set[str]) -> dict[str, Any]:
    class_name = type(event).__name__
    event_type = {
        "GraphRunStartedEvent": "graph_started",
        "GraphRunSucceededEvent": "graph_completed",
        "GraphRunPartialSucceededEvent": "graph_partially_completed",
        "GraphRunFailedEvent": "graph_failed",
        "GraphRunAbortedEvent": "graph_aborted",
        "GraphRunPausedEvent": "graph_paused",
        "NodeRunStartedEvent": "node_started",
        "NodeRunSucceededEvent": "node_completed",
        "NodeRunFailedEvent": "node_failed",
        "NodeRunExceptionEvent": "node_exception",
        "NodeRunRetryEvent": "node_retry",
        "NodeRunStreamChunkEvent": "node_stream",
        "NodeRunReasoningChunkEvent": "node_reasoning_stream",
    }.get(class_name, _snake_case(class_name.removesuffix("Event")))
    raw_payload = event.model_dump(mode="json")
    payload = _redact_value(raw_payload, secrets)
    normalized: dict[str, Any] = {
        "eventType": event_type,
        "payload": payload,
    }
    node_id = raw_payload.get("node_id")
    if node_id is not None:
        normalized["nodeId"] = str(node_id)
    return normalized


def _terminal_status(event_type: str) -> str | None:
    return {
        "graph_completed": "completed",
        "graph_partially_completed": "completed",
        "graph_failed": "failed",
        "graph_aborted": "cancelled",
        "graph_paused": "paused",
    }.get(event_type)


def _secret_values(value: Any, *, secret_context: bool = False) -> list[str]:
    secrets: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            key_is_secret = secret_context or _is_secret_key(str(key))
            secrets.extend(_secret_values(item, secret_context=key_is_secret))
    elif isinstance(value, list):
        for item in value:
            secrets.extend(_secret_values(item, secret_context=secret_context))
    elif secret_context and isinstance(value, (str, int, float)):
        text_value = str(value)
        if text_value:
            secrets.append(text_value)
    return secrets


def _is_secret_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(
        token in normalized
        for token in ("api_key", "authorization", "password", "secret", "token")
    )


def _redact_value(value: Any, secrets: set[str], *, key: str = "") -> Any:
    if _is_secret_key(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            str(item_key): _redact_value(item, secrets, key=str(item_key))
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_value(item, secrets) for item in value]
    if isinstance(value, str):
        return _redact_text(value, secrets)
    return value


def _redact_text(value: str, secrets: set[str]) -> str:
    redacted = value
    for secret in sorted(secrets, key=len, reverse=True):
        redacted = redacted.replace(secret, "[REDACTED]")
    return redacted


def _json_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())


def _snake_case(value: str) -> str:
    characters: list[str] = []
    for index, character in enumerate(value):
        if character.isupper() and index > 0:
            characters.append("_")
        characters.append(character.lower())
    return "".join(characters)
