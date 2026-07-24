"""Bounded model-assisted edits for an existing Canvas node.

The model never receives authority to mutate a stored workflow.  It can only
suggest values for parameters already present on the selected node; those
values are run through the canonical patch preview before the browser may
offer an explicit Apply action.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.llm.base import LlmAdapterError
from backend.llm.resolver import ResolverError, resolver
from backend.schemas.workflow import (
    WorkflowNodeEditDraftRequest,
    WorkflowNodeEditDraftResponse,
    WorkflowPatchOperation,
)
from backend.workflow.patcher import preview_workflow_patch


class WorkflowNodeEditDraftError(Exception):
    """Expected model/configuration failure safe to expose to the UI."""


async def draft_workflow_node_edit(
    body: WorkflowNodeEditDraftRequest,
    *,
    session: AsyncSession,
) -> WorkflowNodeEditDraftResponse:
    node = _find_workflow_node(body.project, body.nodeId)
    if node is None:
        raise WorkflowNodeEditDraftError(f'Workflow node "{body.nodeId}" was not found.')

    allowed_params = [name for name in sorted(node.params) if not _is_sensitive_parameter_name(name)]
    if not allowed_params:
        return WorkflowNodeEditDraftResponse(
            reply="这个节点没有可由 AI 修改的公开参数；请先在参数面板配置节点。",
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a careful Workflow Canvas node editor. Reply with exactly one JSON object, no markdown. "
                'Shape: {"reply":"short Chinese explanation","params":{"parameterName":value}}. '
                "Only suggest changes requested by the user. Only use parameter names from allowedParams. "
                "Never include credentials, secrets, adapters, node ids, URLs with tokens, implementation code, or new parameter names. "
                "If no safe parameter edit is possible, return an empty params object and explain why in Chinese."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "request": body.message,
                    "node": {
                        "id": node.id,
                        "kind": node.kind,
                        "capability": node.capability,
                        "label": node.ui.get("label") if isinstance(node.ui, dict) else None,
                        "params": node.params,
                    },
                    "allowedParams": allowed_params,
                },
                ensure_ascii=False,
            ),
        },
    ]

    async def model_call(adapter, model_id: str) -> str:
        try:
            return await adapter.chat(messages, model=model_id, max_tokens=900)
        finally:
            await adapter.aclose()

    try:
        raw = await resolver.resolve_with_fallback(session, "chat", model_call)
    except (ResolverError, LlmAdapterError) as exc:
        raise WorkflowNodeEditDraftError(str(exc)) from exc

    decoded = _decode_model_reply(raw)
    reply = decoded.get("reply") if isinstance(decoded.get("reply"), str) else "AI 已分析当前节点。"
    params = _safe_param_patch(decoded.get("params"), allowed_params)
    if not params:
        return WorkflowNodeEditDraftResponse(reply=reply)

    patch = preview_workflow_patch(
        body.project,
        [WorkflowPatchOperation(op="update_parameters", nodeId=body.nodeId, params=params)],
    )
    return WorkflowNodeEditDraftResponse(reply=reply, patch=patch)


def _decode_model_reply(raw: str) -> dict[str, Any]:
    """Accept a JSON object even when a compatible model wraps it in prose."""

    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    candidates = [text, *_json_object_candidates(text)]
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return {"reply": raw or "模型没有返回可识别的编辑建议。", "params": {}}


def _json_object_candidates(text: str) -> list[str]:
    """Return complete JSON-object spans, including models that emit a think prelude."""

    candidates: list[str] = []
    start: int | None = None
    depth = 0
    in_string = False
    escaped = False
    for index, character in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "{":
            if depth == 0:
                start = index
            depth += 1
        elif character == "}" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                candidates.append(text[start : index + 1])
                start = None
    return list(reversed(candidates))


def _safe_param_patch(value: Any, allowed_params: list[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    allowed = set(allowed_params)
    return {key: candidate for key, candidate in value.items() if key in allowed}


def _is_sensitive_parameter_name(name: str) -> bool:
    normalized = name.lower().replace("-", "_")
    return any(token in normalized for token in ("api_key", "token", "secret", "password", "credential", "authorization"))


def _find_workflow_node(project, node_id: str):
    """Resolve a top-level or package-internal node by canonical ``::`` path."""

    parts = [part for part in node_id.split("::") if part]
    if not parts:
        return None
    current = next((candidate for candidate in project.nodes if candidate.id == parts[0]), None)
    for part in parts[1:]:
        if current is None or current.internals is None:
            return None
        current = next(
            (candidate for candidate in current.internals.nodes if candidate.id == part),
            None,
        )
    return current
