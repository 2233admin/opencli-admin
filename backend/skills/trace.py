"""The shared ``journey_trace_v1`` shape (ADR-0003 D6, D7).

Both legs of the closed loop must target **one** trace shape so they feed the
*same* distiller:

  * the human **record** leg ("录这站") — a separate TODO (PRD §1, §7) — turns a
    demonstration into the *first* ``journey_trace_v1``,
  * the **execute → correct** leg (this issue) assembles a trace from an execute
    run's step events + outcome.

:func:`assemble_trace` is that single builder. It is **forward-compatible** with
:func:`backend.skills.distill.distill_trace`, which reads exactly three keys —
``trace["summary"]["domain"]``, ``trace["label"]``, ``trace["trace_id"]`` — and
ignores everything else, so the extra ``schema`` / ``steps`` / ``outcome`` keys
this shape carries do not perturb distillation.

:func:`self_eval` is a small **pure** function comparing a run's outcome against
the skill's ``terminal_conditions`` / ``milestones`` (read from
``skill.elements``; keys per :data:`backend.skills.distill.ELEMENT_KEYS`). The
dict it returns is what the channel appends to ``skills.evidence`` (the
closed-loop log the :class:`~backend.models.skill.Skill` model is built for).
Neither function touches the DB or the network.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

# The shape tag both legs share. Bump only on an incompatible shape change.
TRACE_SCHEMA = "journey_trace_v1"

# Loop outcome (LoopResult.outcome) → trace/self-eval status vocabulary.
# ``done_success`` is the only "passed" terminal state; ``awaiting_confirm`` maps
# to ``paused`` (the run stopped at a confirm gate, neither done nor failed).
_OUTCOME_STATUS = {
    "done_success": "success",
    "done_failed": "failed",
    "capped": "failed",
    "error": "failed",
    "awaiting_confirm": "paused",
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def assemble_trace(
    step_events: list[dict[str, Any]],
    outcome: dict[str, Any],
    *,
    domain: str,
    label: str,
    trace_id: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble a ``journey_trace_v1`` from a run's step events + outcome.

    Parameters
    ----------
    step_events:
        One dict per loop step (built from the loop's own ordered step records —
        the channel accumulates them as it emits; we do **not** re-query
        ``TaskRunEvent`` rows). Each entry carries at least the action verb,
        the ref/target it addressed, a snapshot digest, the result, and timing.
    outcome:
        ``{"status": "success"|"failed"|"paused", "milestones_hit": [...],
        "terminal_check": <bool|str|None>, ...}`` — the run's terminal summary.
    domain / label / trace_id:
        The three keys :func:`distill_trace` reads. ``domain`` lands at
        ``summary.domain``; ``label`` is the capability-slug fallback;
        ``trace_id`` becomes the distilled spec's ``source_trace``.
    extra:
        Optional extra ``summary`` fields (merged into ``summary``). Distiller
        ignores unknown keys, so this stays forward-compatible.

    Returns
    -------
    dict
        ``{schema, trace_id, label, summary{domain, ...}, steps[], outcome}``.
        At least one ``steps`` entry per loop step; an ``outcome`` block always
        present. Round-trips through :func:`distill_trace` unchanged (it needs
        only ``summary.domain`` / ``label`` / ``trace_id``).
    """
    return {
        "schema": TRACE_SCHEMA,
        "trace_id": trace_id,
        "label": label,
        "summary": {"domain": domain, **(extra or {})},
        "steps": list(step_events),
        "outcome": outcome,
    }


def outcome_from_loop(
    loop_outcome: str,
    *,
    milestones_hit: list[Any] | None = None,
    terminal_check: Any = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the trace ``outcome`` block from a :class:`LoopResult` outcome.

    Maps the loop's outcome vocabulary (``done_success`` / ``done_failed`` /
    ``capped`` / ``error`` / ``awaiting_confirm``) onto the trace status
    (``success`` / ``failed`` / ``paused``) shared by both legs.
    """
    return {
        "status": _OUTCOME_STATUS.get(loop_outcome, "failed"),
        "loop_outcome": loop_outcome,
        "milestones_hit": list(milestones_hit or []),
        "terminal_check": terminal_check,
        **(extra or {}),
    }


def _as_list(value: Any) -> list[Any]:
    """Coerce a possibly-None / scalar elements field into a list."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _skill_elements(skill: Any) -> dict[str, Any]:
    """Best-effort pull of the structured 9-element dict from a Skill / dict.

    Accepts a :class:`~backend.models.skill.Skill` row (reads ``.elements``) or a
    bare ``elements``-shaped dict (inline-skill case). Returns ``{}`` when no
    structured elements are resolvable.
    """
    if skill is None:
        return {}
    elements = getattr(skill, "elements", None)
    if isinstance(elements, dict):
        return elements
    # Inline case: ``skill`` may itself be the elements dict (channel passes
    # ``elements or config``); only treat it as such if it looks like one.
    if isinstance(skill, dict):
        if "elements" in skill and isinstance(skill["elements"], dict):
            return skill["elements"]
        return skill
    return {}


def self_eval(outcome: dict[str, Any], skill: Any) -> dict[str, Any]:
    """Compare a run outcome against the skill's terminal/milestone conditions.

    Pure. Returns the evidence entry appended to ``skills.evidence``::

        {"event": "executed", "passed": bool, "milestones_hit": [...],
         "terminal_met": bool, "outcome": "...", "trace_id": "...", "at": <iso>}

    ``passed`` is the conjunction of "the run terminated successfully" and "no
    declared terminal condition was violated". With no declared
    ``terminal_conditions``, ``terminal_met`` falls back to the run's own
    ``status == "success"`` (we can't contradict a clean ``done`` we have no
    rule to judge). ``milestones_hit`` echoes the outcome's reported hits,
    bounded to those the skill actually declares when it declares any.
    """
    elements = _skill_elements(skill)
    declared_terminals = _as_list(elements.get("terminal_conditions"))
    declared_milestones = _as_list(elements.get("milestones"))

    status = str(outcome.get("status") or "").lower()
    succeeded = status == "success"

    reported_hits = _as_list(outcome.get("milestones_hit"))
    if declared_milestones:
        declared_set = {str(m) for m in declared_milestones}
        milestones_hit = [m for m in reported_hits if str(m) in declared_set]
    else:
        milestones_hit = reported_hits

    if declared_terminals:
        # The loop validates a claimed ``done`` against terminal/false-terminal
        # conditions (see loop._check_done); a successful terminal status means
        # that validation passed. A non-success status never meets terminals.
        terminal_met = succeeded
    else:
        terminal_met = succeeded

    return {
        "event": "executed",
        "passed": bool(succeeded and terminal_met),
        "milestones_hit": milestones_hit,
        "terminal_met": bool(terminal_met),
        "outcome": status or "unknown",
        "trace_id": outcome.get("trace_id"),
        "at": _now_iso(),
    }
