"""Execute TurboPush publish bindings through the local HTTP/SSE API."""

from __future__ import annotations

import json
from typing import Any

import httpx

from backend.workflow.turbopush_accounts import resolve_turbopush_post_accounts
from backend.workflow.turbopush_errors import TurboPushPublishError
from backend.workflow.turbopush_runtime import (
    TURBOPUSH_BINDING_ID,
    TURBOPUSH_CONTENT_TYPES,
    normalize_turbopush_content_type,
    resolve_turbopush_service_credentials,
)


def execute_turbopush_publish(binding_input: dict[str, Any]) -> dict[str, Any]:
    """Create or reuse content, resolve logged accounts, and POST TurboPush SSE publish."""

    content_type = normalize_turbopush_content_type(binding_input.get("contentType"))
    if content_type is None:
        raise TurboPushPublishError(
            "missing_turbopush_content_type",
            "TurboPush contentType must be article, graph_text, or video.",
            status="blocked",
        )

    credentials = resolve_turbopush_service_credentials()
    if not credentials.configured or not credentials.base_url or not credentials.auth_token:
        raise TurboPushPublishError(
            "missing_turbopush_service",
            credentials.message,
            details={"missing": credentials.missing, "source": credentials.source},
            status="blocked",
        )

    client = _TurboPushHTTPClient(credentials.base_url, credentials.auth_token)
    try:
        post_accounts = resolve_turbopush_post_accounts(
            client, content_type, binding_input
        )
        article_id = _read_content_id(binding_input.get("articleId"))
        if article_id is None:
            article_id = _create_turbopush_content(client, content_type, binding_input)

        publish_body = {
            "postAccounts": post_accounts,
            "syncDraft": bool(binding_input.get("syncDraft", False)),
            "closeBrowser": True,
        }
        path = str(TURBOPUSH_CONTENT_TYPES[content_type]["publish_path"]).format(
            article_id=article_id
        )
        events = client.post_sse(path, publish_body)
    finally:
        client.close()

    return {
        "bindingId": TURBOPUSH_BINDING_ID,
        "contentType": content_type,
        "articleId": article_id,
        "targetPlatforms": [account["settings"]["platType"] for account in post_accounts],
        "postAccountCount": len(post_accounts),
        "publishTool": TURBOPUSH_CONTENT_TYPES[content_type]["publish_tool"],
        "events": events,
        "summary": _summarize_sse_events(events),
    }


class _TurboPushHTTPClient:
    def __init__(self, base_url: str, auth_token: str) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            headers={"Authorization": auth_token},
            timeout=600.0,
        )

    def close(self) -> None:
        self._client.close()

    def get(self, path: str) -> Any:
        return self._request("GET", path)

    def post(self, path: str, body: dict[str, Any]) -> Any:
        return self._request("POST", path, json=body)

    def post_sse(self, path: str, body: dict[str, Any]) -> list[dict[str, str]]:
        try:
            with self._client.stream(
                "POST",
                path,
                json=body,
                headers={"Accept": "text/event-stream"},
            ) as response:
                if response.status_code == 401:
                    raise TurboPushPublishError(
                        "turbopush_auth_failed",
                        "TurboPush authentication failed.",
                    )
                response.raise_for_status()
                return _parse_sse_lines(response.iter_lines())
        except TurboPushPublishError:
            raise
        except httpx.HTTPError as exc:
            raise TurboPushPublishError(
                "turbopush_sse_request_failed",
                f"TurboPush publish request failed: {exc}",
            ) from exc

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(method, path, **kwargs)
            if response.status_code == 401:
                raise TurboPushPublishError(
                    "turbopush_auth_failed",
                    "TurboPush authentication failed.",
                )
            response.raise_for_status()
            payload = response.json()
        except TurboPushPublishError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            raise TurboPushPublishError(
                "turbopush_request_failed",
                f"TurboPush API request failed: {exc}",
            ) from exc

        if not isinstance(payload, dict):
            raise TurboPushPublishError(
                "turbopush_invalid_response",
                "TurboPush API response is not an object.",
                details={"path": path},
            )
        if payload.get("code") != 200:
            raise TurboPushPublishError(
                "turbopush_api_error",
                _read_string(payload.get("msg")) or "TurboPush API returned an error.",
                details={"path": path, "code": payload.get("code")},
            )
        return payload.get("data")


def _create_turbopush_content(
    client: _TurboPushHTTPClient,
    content_type: str,
    binding_input: dict[str, Any],
) -> int:
    title = _require_concrete_string(binding_input.get("title"), "title")
    desc = _optional_concrete_string(binding_input.get("desc"), "desc")
    thumb = binding_input.get("thumb") if isinstance(binding_input.get("thumb"), list) else []
    body: dict[str, Any] = {"title": title}
    path = "/article/create"

    if content_type == "article":
        body["markdown"] = _require_concrete_string(binding_input.get("markdown"), "markdown")
        if desc is not None:
            body["desc"] = desc
    elif content_type == "graph_text":
        path = "/article/graphText"
        if desc is not None:
            body["desc"] = desc
        body["files"] = (
            binding_input.get("files") if isinstance(binding_input.get("files"), list) else []
        )
    else:
        path = "/article/video"
        files = binding_input.get("files") if isinstance(binding_input.get("files"), list) else []
        if not files:
            raise TurboPushPublishError(
                "missing_turbopush_video_files",
                "TurboPush video publish requires node.params.files with video paths.",
                status="blocked",
            )
        body["files"] = files
        if desc is not None:
            body["desc"] = desc

    if thumb:
        body["thumb"] = thumb
        body["autoThumb"] = False
    else:
        body["autoThumb"] = True

    data = client.post(path, body)
    article_id = _read_content_id(data)
    if article_id is None:
        raise TurboPushPublishError(
            "turbopush_missing_content_id",
            "TurboPush create content response did not include an article id.",
            details={"path": path, "data": _safe_preview(data)},
        )
    return article_id


def _parse_sse_lines(lines: Any) -> list[dict[str, str]]:
    events: list[dict[str, str]] = []
    current_event = ""
    current_data = ""
    for raw_line in lines:
        line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else str(raw_line)
        line = line.rstrip("\r")
        if not line:
            if current_event or current_data:
                events.append({"event": current_event, "data": current_data})
                if current_event == "finish":
                    return events
                current_event = ""
                current_data = ""
            continue
        if line.startswith("event:"):
            current_event = line[6:].strip()
        elif line.startswith("data:"):
            current_data = line[5:].strip()

    if current_event or current_data:
        events.append({"event": current_event, "data": current_data})
    return events


def _summarize_sse_events(events: list[dict[str, str]]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "successCount": 0,
        "errorCount": 0,
        "finish": None,
        "messages": [],
    }
    for event in events:
        event_type = event.get("event")
        data = event.get("data")
        if event_type == "success":
            result["successCount"] += 1
            result["messages"].append(data)
        elif event_type == "error":
            result["errorCount"] += 1
            result["messages"].append(data)
        elif event_type == "finish":
            result["finish"] = _maybe_json(data)
        elif event_type in {"wait", "vip"}:
            result["messages"].append(data)
    return result


def _read_content_id(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    if isinstance(value, dict):
        for key in ("id", "rid", "article_id", "articleId", "tid", "vid"):
            content_id = _read_content_id(value.get(key))
            if content_id is not None:
                return content_id
    return None


def _require_concrete_string(value: Any, field: str) -> str:
    text = _optional_concrete_string(value, field)
    if text is None:
        raise TurboPushPublishError(
            "missing_turbopush_content",
            f"TurboPush publish requires concrete node.params.{field}.",
            details={"field": field},
            status="blocked",
        )
    return text


def _optional_concrete_string(value: Any, field: str) -> str | None:
    text = _read_string(value)
    if text is None:
        return None
    if "{{" in text or "}}" in text:
        raise TurboPushPublishError(
            "unresolved_turbopush_template",
            f"TurboPush publish cannot send unresolved template in node.params.{field}.",
            details={"field": field},
            status="blocked",
        )
    return text


def _maybe_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _safe_preview(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: value[key] for key in list(value)[:10]}
    return value


def _read_string(value: Any) -> str | None:
    if isinstance(value, int):
        return str(value)
    return value.strip() if isinstance(value, str) and value.strip() else None
