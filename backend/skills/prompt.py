"""Step prompt + skill verb tool schema for the execute loop (ADR-0003 D3/D6).

The cheap text model (e.g. ``qwen3:4b``, ~32k ctx, no vision) drives a real
Chrome page **one action per step**. This module is the loop's *language*: it

  1. builds the per-step **system prompt** from the SKILL.md 9 elements
     (``procedure``, ``milestones``, ``terminal_conditions``,
     ``false_terminal_states``, ``red_lines``) plus the current
     ``[{ref, role, name, value}]`` interactive snapshot
     (``backend.skills.perception``), and
  2. defines the skill's **own** verb tool schema — the 7 fixed verbs of
     ADR-0003 D3 — in two shapes: OpenAI function-calling (:data:`SKILL_TOOLS`)
     and a parallel text description for the Qwen XML-tool path
     (:data:`SKILL_TOOLS_TEXT`).

Hard rule (PRD §4 D3): this is **NOT** ``backend.api.v1.chat.TOOLS`` /
``WRITE_TOOLS`` — the skill loop must not overload the chat-console tools.
:data:`SKILL_TOOLS` is a distinct object covering a distinct verb set. The arg
names here are kept canonically aligned with issue 02's validator
(``backend.skills.actions.VERBS``: ``navigate{url}``, ``click{ref}``,
``type{ref,text,submit?}``, ``select{ref,value}``, ``scroll{dir}``,
``extract{data}``, ``done{status,note}``) so the model proposes exactly what 02
validates and executes — no JS / no verbs outside the set.
"""

from typing import Any

# ── The 7 verbs, canonically aligned with backend.skills.actions.VERBS ─────────
# Pull the verb names from the executor so this schema can never drift from the
# validator (acceptance #2 keeps the two in lockstep). Import is module-level and
# browser-free — actions.py imports SkillPage only under TYPE_CHECKING.
from backend.skills.actions import VERBS as _ACTION_VERBS

# Submit-ish writes — issue 04 will hang the risk/confirm gate off this set.
# Defining it here is in scope; *using* it to gate is issue 04 (do NOT import
# chat.py::WRITE_TOOLS — this is the skill loop's own marking).
SKILL_WRITE_VERBS = frozenset({"click", "type", "select"})


# ── Skill verb tool schema — OpenAI function-calling shape ─────────────────────
# Same envelope as chat.py::TOOLS ({"type":"function","function":{...}}) but a
# DISTINCT object covering the 7 skill verbs, not the chat-console tools.
SKILL_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "Navigate the browser to an absolute URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Absolute URL to open."},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "click",
            "description": "Click the interactive element addressed by its snapshot ref.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {
                        "type": "string",
                        "description": "The ref of the element from the snapshot below.",
                    },
                },
                "required": ["ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "type",
            "description": (
                "Type text into the input/textarea addressed by ref; "
                "optionally submit (press Enter)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "The ref of the input element."},
                    "text": {"type": "string", "description": "Text to type."},
                    "submit": {
                        "type": "boolean",
                        "description": "Press Enter after typing (e.g. submit). Default false.",
                    },
                },
                "required": ["ref", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select",
            "description": "Select an option value in the <select> element addressed by ref.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "The ref of the <select> element."},
                    "value": {"type": "string", "description": "Option value to select."},
                },
                "required": ["ref", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scroll",
            "description": "Scroll the page one viewport up or down to reveal more elements.",
            "parameters": {
                "type": "object",
                "properties": {
                    "dir": {
                        "type": "string",
                        "enum": ["up", "down"],
                        "description": "Scroll direction.",
                    },
                },
                "required": ["dir"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract",
            "description": (
                "Emit a structured record of data read from the page "
                "(becomes a collected item)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "object",
                        "description": "Free-form object of the fields you extracted.",
                    },
                },
                "required": ["data"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "done",
            "description": (
                "Finish the task. Call this ONLY when a terminal_condition is truly met. "
                "Do NOT call done in a false_terminal_state."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["success", "failed", "paused"],
                        "description": "Outcome of the task.",
                    },
                    "note": {
                        "type": "string",
                        "description": "Short note on what was accomplished or why it stopped.",
                    },
                },
                "required": ["status"],
            },
        },
    },
]

# Defensive: the schema must mirror exactly the 7 executor verbs. If issue 02's
# VERBS ever change, this assert trips at import — surfacing drift loudly instead
# of letting the model propose verbs the executor will reject.
assert {t["function"]["name"] for t in SKILL_TOOLS} == set(_ACTION_VERBS), (
    "SKILL_TOOLS verbs drifted from backend.skills.actions.VERBS"
)


# ── Parallel text description for the XML-tool path (mirrors chat.py::XML_TOOL_TEXT) ──
# Models like Qwable emit <tool_use name="verb" id="...">{json}</tool_use> in the
# message content rather than OpenAI tool_calls; describe the same 7 verbs as text
# so the loop's XML branch can parse them with chat.py's parser.
SKILL_TOOLS_TEXT = (
    "\n\nYou are a browser-driving agent. Emit EXACTLY ONE action per step.\n"
    "Available verbs:\n"
    "- navigate(url): open an absolute URL.\n"
    "- click(ref): click the element with that snapshot ref.\n"
    "- type(ref, text, submit?): type text into an input; submit=true presses Enter.\n"
    "- select(ref, value): select an option value in a <select>.\n"
    "- scroll(dir): scroll one viewport, dir is \"up\" or \"down\".\n"
    "- extract(data): emit a structured record (object) of data read from the page.\n"
    "- done(status, note): finish; status is \"success\"|\"failed\"|\"paused\". "
    "Call done ONLY when a terminal_condition is met, NEVER in a false_terminal_state.\n"
    'To act, output strictly this XML and nothing else: '
    '<tool_use name="verb" id="toolu_1">{json args}</tool_use>\n'
    "Address elements by their ref from the snapshot. Do not use JS or any verb "
    "outside this set. Do not wrap output in markdown code fences."
)


# ── System prompt builder ──────────────────────────────────────────────────────
# The 9-element sections the step prompt foregrounds (ADR-0003 D6). procedure /
# milestones / terminal_conditions / false_terminal_states / red_lines are the
# loop-control elements; the prompt MUST contain them (acceptance #1).
_PROMPT_ELEMENT_SECTIONS: tuple[tuple[str, str], ...] = (
    ("procedure", "Procedure (generalized steps)"),
    ("milestones", "Milestones (mid-way checkpoints)"),
    ("terminal_conditions", "Terminal conditions (how you know it's truly done)"),
    (
        "false_terminal_states",
        "False terminal states (TRAPS — looks done but is NOT; never `done` here)",
    ),
    ("red_lines", "Red lines (never do these)"),
)


def _render_element(value: Any) -> str:
    """Render one 9-element value (list[str] | str | None) as prompt lines."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (list, tuple)):
        items = [str(x).strip() for x in value if str(x).strip()]
        return "\n".join(f"- {x}" for x in items)
    return str(value).strip()


def _render_snapshot(snapshot: list[dict[str, Any]]) -> str:
    """Render the [{ref, role, name, value}] snapshot compactly, one line each.

    ``#<ref> <role> "<name>" = <value>`` (value omitted when empty). Already
    token-bounded by perception (issue 01) — do not re-expand here.
    """
    if not snapshot:
        return "(no interactive elements detected)"
    lines: list[str] = []
    for el in snapshot:
        ref = el.get("ref", "")
        role = str(el.get("role", "") or "")
        name = str(el.get("name", "") or "")
        value = str(el.get("value", "") or "")
        line = f'#{ref} {role} "{name}"'
        if value:
            line += f" = {value}"
        lines.append(line)
    return "\n".join(lines)


def build_system_prompt(
    *,
    skill_md: str | None,
    elements: dict | None,
    snapshot: list[dict[str, Any]],
    task: str | None,
    step_index: int,
    max_steps: int,
) -> str:
    """Build the per-step system prompt from the 9 elements + current snapshot.

    The skill spec arrives two ways (a Skill row carries both): structured
    ``elements`` (the ``Skill.elements`` JSON — keys per
    ``backend.skills.distill.ELEMENT_KEYS``) and/or the raw ``skill_md``. Prefer
    structured ``elements`` so each loop-control section is addressable; when no
    usable ``elements`` are given, fall back to embedding ``skill_md`` verbatim
    (it already contains the same sections). The returned prompt always:

      * foregrounds ``procedure``, ``milestones``, ``terminal_conditions``,
        ``false_terminal_states`` and ``red_lines`` (acceptance #1),
      * states the loop contract (exactly one action/step; ``done`` only on a
        terminal condition; ``false_terminal_states`` are traps; address by
        ``ref``; no JS / no verbs outside the set), and
      * renders the current snapshot so every element's ``ref`` appears.
    """
    parts: list[str] = []
    parts.append(
        "You are a careful browser-automation agent driving a real Chrome page "
        "to accomplish a task by following a distilled skill."
    )
    if task:
        parts.append(f"Task:\n{task}")

    # 9-element body: structured sections when available, else raw skill_md.
    rendered_sections: list[str] = []
    if elements:
        for key, label in _PROMPT_ELEMENT_SECTIONS:
            body = _render_element(elements.get(key))
            if body:
                rendered_sections.append(f"## {label}\n{body}")
    if rendered_sections:
        parts.append("Skill card (follow it):\n\n" + "\n\n".join(rendered_sections))
    elif skill_md:
        # Degrade gracefully: the raw card already carries the same sections.
        parts.append("Skill card (SKILL.md — follow it):\n\n" + skill_md.strip())

    # Loop contract (ADR-0003 D6).
    parts.append(
        "Loop contract:\n"
        "- Emit EXACTLY ONE tool call (one action) per step.\n"
        "- Call `done` ONLY when a terminal condition is met.\n"
        "- `false_terminal_states` are traps — do NOT `done` when one applies.\n"
        "- Address elements by their `ref` from the snapshot below.\n"
        "- Use only the provided verbs. No JavaScript, no actions outside the verb set.\n"
        f"- This is step {step_index + 1} of at most {max_steps}."
    )

    # Current perception (renders every ref — acceptance #1).
    parts.append(
        "Current page (interactive elements, addressed by ref):\n"
        + _render_snapshot(snapshot)
    )

    return "\n\n".join(parts)
