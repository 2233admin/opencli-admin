from __future__ import annotations

from copy import deepcopy
from typing import Any

from contracts import InspectRequest


def policy_blockers(
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
        elif node_type == "http-request":
            blocker = (
                (
                    "network_adapter_required",
                    "HTTP request nodes require an installed network policy adapter.",
                )
                if request.policy.allow_network
                else (
                    "network_permission_required",
                    "HTTP request nodes require explicit network permission.",
                )
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


def prepare_execution_credentials(
    grants: dict[str, Any],
    *,
    sandbox_endpoint: str,
    sandbox_api_key: str,
    slim_path: str | None,
    slim_plugin_folder: str,
) -> dict[str, Any]:
    credentials = deepcopy(grants)

    raw_code_settings = credentials.get("code")
    code_settings = (
        dict(raw_code_settings) if isinstance(raw_code_settings, dict) else {}
    )
    code_settings.pop("execution_endpoint", None)
    code_settings.pop("execution_api_key", None)
    if sandbox_endpoint:
        code_settings["execution_endpoint"] = sandbox_endpoint
        if sandbox_api_key:
            code_settings["execution_api_key"] = sandbox_api_key
    if code_settings:
        credentials["code"] = code_settings
    else:
        credentials.pop("code", None)

    if slim_path:
        credentials["slim"] = {"plugin_folder": slim_plugin_folder}
    else:
        credentials.pop("slim", None)

    return credentials


def secret_values(value: Any, *, secret_context: bool = False) -> list[str]:
    secrets: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            key_is_secret = secret_context or _is_secret_key(str(key))
            secrets.extend(secret_values(item, secret_context=key_is_secret))
    elif isinstance(value, list):
        for item in value:
            secrets.extend(secret_values(item, secret_context=secret_context))
    elif secret_context and isinstance(value, (str, int, float)):
        text_value = str(value)
        if text_value:
            secrets.append(text_value)
    return secrets


def redact_value(value: Any, secrets: set[str], *, key: str = "") -> Any:
    if _is_secret_key(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            str(item_key): redact_value(item, secrets, key=str(item_key))
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_value(item, secrets) for item in value]
    if isinstance(value, str):
        return redact_text(value, secrets)
    if isinstance(value, (int, float)) and str(value) in secrets:
        return "[REDACTED]"
    return value


def redact_text(value: str, secrets: set[str]) -> str:
    redacted = value
    for secret in sorted(secrets, key=len, reverse=True):
        redacted = redacted.replace(secret, "[REDACTED]")
    return redacted


def _is_secret_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return any(
        token in normalized
        for token in ("api_key", "authorization", "password", "secret", "token")
    )
