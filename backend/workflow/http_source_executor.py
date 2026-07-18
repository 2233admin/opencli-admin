"""Live HTTP source executor for workflow source nodes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from backend.security.url_guard import SSRFValidationError, guarded_async_client

_SUPPORTED_PROVIDERS = {"api", "http", "https", "rest"}
_SUPPORTED_METHODS = {"GET", "POST"}
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class WorkflowHTTPSourceResult:
    items: list[dict[str, Any]]
    url: str
    method: str
    status_code: int
    result_path: str | None = None


@dataclass(frozen=True)
class WorkflowHTTPSourceExecutionError(Exception):
    code: str
    message: str
    status: str = "failed"
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message


def supports_http_source(binding_input: dict[str, Any]) -> bool:
    provider = _read_string(binding_input.get("provider")).lower()
    channel_type = _read_string(binding_input.get("channelType")).lower()
    return provider in _SUPPORTED_PROVIDERS or channel_type in _SUPPORTED_PROVIDERS


async def execute_workflow_http_source(
    binding_input: dict[str, Any],
    *,
    allowed_domains: list[str],
    max_items: int,
) -> WorkflowHTTPSourceResult | None:
    if not supports_http_source(binding_input):
        return None

    config = _read_dict(binding_input.get("adapterConfig"))
    params = _read_dict(binding_input.get("params"))
    url = _first_string(
        config.get("url"),
        config.get("endpoint"),
        params.get("url"),
        params.get("sourceUrl"),
        params.get("endpoint"),
    )
    if not url:
        raise WorkflowHTTPSourceExecutionError(
            code="source_url_required",
            message="HTTP source requires a configured URL.",
            status="blocked",
        )

    hostname = (urlparse(url).hostname or "").lower()
    normalized_domains = {
        domain.strip().lower().lstrip(".") for domain in allowed_domains if domain.strip()
    }
    if not hostname or not any(
        hostname == domain or hostname.endswith(f".{domain}") for domain in normalized_domains
    ):
        raise WorkflowHTTPSourceExecutionError(
            code="source_domain_not_allowed",
            message=(
                f"HTTP source host {hostname or url!r} is not in "
                "agentPermissions.allowedDomains."
            ),
            status="blocked",
            details={"hostname": hostname, "allowedDomains": sorted(normalized_domains)},
        )

    method = (_first_string(config.get("method"), params.get("method")) or "GET").upper()
    if method not in _SUPPORTED_METHODS:
        raise WorkflowHTTPSourceExecutionError(
            code="source_method_not_supported",
            message=f"HTTP source method {method!r} is not supported; use GET or POST.",
            status="blocked",
            details={"method": method},
        )

    headers = _string_dict(config.get("headers"))
    query = _read_dict(config.get("query") or config.get("params"))
    body = config.get("body", config.get("json"))
    result_path = _first_string(
        config.get("resultPath"),
        config.get("result_path"),
        params.get("resultPath"),
        params.get("result_path"),
    )
    timeout = _bounded_timeout(config.get("timeout"))

    try:
        client, validated_url = await guarded_async_client(
            url,
            timeout=timeout,
            follow_redirects=False,
        )
        async with client as opened_client:
            response = await opened_client.request(
                method,
                validated_url,
                params=query or None,
                json=body if method == "POST" and body is not None else None,
                headers=headers or None,
            )
            response.raise_for_status()
            content_length = int(response.headers.get("content-length", "0") or 0)
            if content_length > _MAX_RESPONSE_BYTES or len(response.content) > _MAX_RESPONSE_BYTES:
                raise WorkflowHTTPSourceExecutionError(
                    code="source_response_too_large",
                    message="HTTP source response exceeds the 2 MiB workflow limit.",
                    details={"contentLength": max(content_length, len(response.content))},
                )
            payload = response.json()
    except WorkflowHTTPSourceExecutionError:
        raise
    except SSRFValidationError as exc:
        raise WorkflowHTTPSourceExecutionError(
            code="source_url_rejected",
            message=f"HTTP source URL rejected: {exc}",
            status="blocked",
        ) from exc
    except httpx.TimeoutException as exc:
        raise WorkflowHTTPSourceExecutionError(
            code="source_fetch_timeout",
            message=f"HTTP source request timed out: {exc}",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise WorkflowHTTPSourceExecutionError(
            code="source_fetch_http_error",
            message=f"HTTP source returned status {exc.response.status_code}.",
            details={"statusCode": exc.response.status_code},
        ) from exc
    except (TypeError, ValueError) as exc:
        raise WorkflowHTTPSourceExecutionError(
            code="source_response_invalid",
            message=f"HTTP source did not return valid JSON: {exc}",
        ) from exc
    except httpx.HTTPError as exc:
        raise WorkflowHTTPSourceExecutionError(
            code="source_fetch_failed",
            message=f"HTTP source request failed: {exc}",
        ) from exc

    selected = _select_result_path(payload, result_path)
    raw_items = selected if isinstance(selected, list) else [selected]
    items = [
        item if isinstance(item, dict) else {"value": item}
        for item in raw_items[: max(1, max_items)]
    ]
    return WorkflowHTTPSourceResult(
        items=items,
        url=validated_url,
        method=method,
        status_code=response.status_code,
        result_path=result_path,
    )


def _select_result_path(payload: Any, result_path: str | None) -> Any:
    selected = payload
    if not result_path:
        return selected
    for key in result_path.split("."):
        if not isinstance(selected, dict) or key not in selected:
            raise WorkflowHTTPSourceExecutionError(
                code="source_result_path_missing",
                message=f"HTTP source result path {result_path!r} was not found.",
                details={"resultPath": result_path},
            )
        selected = selected[key]
    return selected


def _bounded_timeout(value: Any) -> float:
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        timeout = 15.0
    return min(60.0, max(1.0, timeout))


def _read_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _string_dict(value: Any) -> dict[str, str]:
    return {
        str(key): str(item)
        for key, item in _read_dict(value).items()
        if isinstance(item, (str, int, float, bool))
    }


def _read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _first_string(*values: Any) -> str | None:
    for value in values:
        resolved = _read_string(value)
        if resolved:
            return resolved
    return None
