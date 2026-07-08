"""Skill bridge — Universal Studio kernel entry into the skill execute domain.

The TS kernel (universal-studio repo) runs ``browser.skill.execute`` as a bridged
node; its ``PythonBridge`` transport POSTs here. This endpoint is a thin,
domain-neutral *mapper* around
:meth:`backend.channels.skill_channel.SkillChannel.collect`: it translates the
kernel's wire envelope ⇄ a channel ``collect()`` call and back, and holds no
skill logic of its own (that lives in :mod:`backend.skills` / the channel).

Wire envelope — keep in lockstep with ``bridges/python`` in the universal-studio
repo (see ``platform/docs/PHASE-1-horizontal-slice.md``)::

    request : { capability, params, inputs: { port: TypedValue } }
    response: { ok, outputs: { port: TypedValue }, events: [ ... ], error? }

``outputs`` carries three typed ports — ``records`` (DataRef<Record>),
``trace`` (DataRef<JourneyTrace>), ``self_eval`` (Value<SelfEval>) — mapped from
the :class:`ChannelResult`'s ``items`` + ``metadata``. ``events`` is a post-hoc
projection of the journey trace's ``steps`` (the transport awaits the whole run,
then replays them as kernel ``node.progress`` events); streaming is a later
iteration.

Intentionally a *separate* router from ``skills.py`` (the human-triggered
re-distill / correct leg) and from ``chat.py`` (the agent dock): the bridge is
its own concern and adds no new skill behaviour — only a transport adapter.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter

from backend.channels.skill_channel import SkillChannel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skill", tags=["skill-bridge"])

# The single node capability this endpoint serves (the kernel routes by it).
SKILL_EXECUTE = "browser.skill.execute"

# TypeRefs — keep in lockstep with the manifest in universal-studio
# ``apps/skill-bridge-proof`` (the records / trace / self_eval ports).
_RECORDS_T = {"kind": "DataRef", "of": "Record"}
_TRACE_T = {"kind": "DataRef", "of": "JourneyTrace"}
_SELF_EVAL_T = {"kind": "Value", "of": "SelfEval"}


def _typed(type_ref: dict[str, str], value: Any) -> dict[str, Any]:
    """Wrap a plain value as a kernel TypedValue (the on-the-wire shape)."""
    return {"type": type_ref, "value": value}


def _events_from_trace(trace: Any) -> list[dict[str, Any]]:
    """Project the journey trace's ``steps`` into node.progress event details.

    The transport awaits the full run then replays these, so a post-hoc
    projection of ``trace['steps']`` is the faithful per-step signal (the same
    step records the spine ``TaskRunEvent``s are built from). Defensive: a
    non-dict trace or non-dict step yields no/blank events.
    """
    if not isinstance(trace, dict):
        return []
    events: list[dict[str, Any]] = []
    for step in trace.get("steps") or []:
        if not isinstance(step, dict):
            continue
        events.append(
            {
                "index": step.get("index"),
                "verb": step.get("verb"),
                "target": step.get("target"),
                "error": step.get("error"),
            }
        )
    return events


@router.post("/invoke")
async def skill_invoke(body: dict[str, Any]) -> dict[str, Any]:
    """Run a skill capability for the kernel; map ChannelResult ⇄ wire envelope.

    Domain-neutral transport adapter — no auth/session of its own (``collect``
    opens its own short-lived sessions). An unknown capability or a failed
    ``ChannelResult`` come back as ``{ok: false, error}`` (HTTP 200) so the
    transport surfaces a clean node failure rather than a 500 stacktrace.
    """
    capability = body.get("capability")
    if capability != SKILL_EXECUTE:
        return {"ok": False, "error": f"unknown capability: {capability!r}"}

    params = body.get("params") or {}
    inputs = body.get("inputs") or {}

    # inputs.task is a TypedValue { type, value }; the task string is its value.
    task = ""
    task_input = inputs.get("task") if isinstance(inputs, dict) else None
    if isinstance(task_input, dict):
        task = str(task_input.get("value") or "")

    # params → channel config (skill_md | skill_id | domain+capability, provider,
    # auto_confirm, elements, label, …). task + chrome_endpoint → parameters.
    config: dict[str, Any] = dict(params)
    parameters: dict[str, Any] = {}
    if task:
        parameters["task"] = task
    if params.get("chrome_endpoint"):
        parameters["chrome_endpoint"] = params["chrome_endpoint"]

    try:
        result = await SkillChannel().collect(config, parameters)
    except Exception as exc:  # transport must not leak a 500 stacktrace
        logger.error("skill bridge | collect raised: %s", exc)
        return {"ok": False, "error": f"skill invoke failed: {exc}"}

    if not result.success:
        return {"ok": False, "error": result.error or "skill run failed"}

    trace = result.metadata.get("trace")
    outputs = {
        "records": _typed(_RECORDS_T, result.items),
        "trace": _typed(_TRACE_T, trace),
        "self_eval": _typed(_SELF_EVAL_T, result.metadata.get("self_eval")),
    }
    return {"ok": True, "outputs": outputs, "events": _events_from_trace(trace)}
