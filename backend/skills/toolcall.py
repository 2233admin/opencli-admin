"""LLM tool-call normalization — pure, shared, dependency-free.

Parses a chat model's tool-call output in both shapes the stack supports: native
OpenAI ``tool_calls`` and the XML ``<tool_use>`` fallback some local models
(Qwen-style) emit as plain message content. These helpers are *pure* — no I/O, no
DB, no FastAPI — and live in the skills package so the execute core
(:mod:`backend.skills.loop`) is self-contained and reusable.

Owning them here (rather than in the agent dock at ``backend.api.v1.chat``) breaks
the old ``skills.loop → api.v1.chat`` import cycle: the reusable skill core no
longer drags the dock's HTTP layer in. The dock can import the same helpers from
here to stay DRY (single source of truth for tool-call parsing).
"""

from __future__ import annotations

import json
import re
from typing import Any

# Some local models can't emit OpenAI ``tool_calls``; they return tool calls as
# XML in the message content. Callers describe the tools in the prompt as text
# and parse the XML themselves via the helpers below.
XML_TOOL_MODELS = ("qwable",)

# matches both <tool_use name="X" .../> (self-closing) and
# <tool_use name="X" ...>{json}</tool_use>
_TOOL_USE_RE = re.compile(
    r'<tool_use\s+name="([^"]+)"[^>]*?(?:/\s*>|>\s*(\{.*?\}|)\s*</tool_use>)', re.DOTALL
)


def _is_xml_tool_model(model: str) -> bool:
    m = model.lower()
    return any(k in m for k in XML_TOOL_MODELS)


def _parse_tool_use(content: str) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    for match in _TOOL_USE_RE.finditer(content or ""):
        calls.append((match.group(1), _safe_json(match.group(2) or "{}")))
    return calls


def _safe_json(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}
