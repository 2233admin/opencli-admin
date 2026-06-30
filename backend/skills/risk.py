"""Risk-tiered confirm classifier + gate (ADR-0003 D4, PRD §4 D4 / §7).

The **safety spine** of the skill execute loop. A cheap text model drives a real
Chrome page one action per step (issue 03); before any action reaches issue 02's
``execute_action`` it passes through this gate. Reads / navigation / scroll /
extract auto-run; an action that matches the skill's ``red_lines`` **or** the
generic high-risk verb pattern (``submit | pay | post | delete``) needs confirm —
"写前确认是硬底线". A source may opt a trusted skill into unattended running with
``channel_config.auto_confirm = true`` (default **off**).

Design constraints (do not relitigate — ADR-0003):

  * **Pure.** :func:`classify_action` takes plain data (``action`` dict, the
    resolved ``element`` snapshot entry, and the ``Skill``/dict carrying
    ``red_lines``) and returns a :class:`RiskDecision`. **No DB session, no
    Playwright, no events, no I/O** — that is what makes the classifier unit
    testable with ``-m "not live"`` and no browser.
  * **Conservative.** The dangerous failure mode is a *false negative* (a write
    mis-classified as auto-run = a silent submit/pay/post). On any ambiguity the
    classifier defaults to ``needs_confirm=True`` (``reason="ambiguous-default-
    confirm"``).
  * **``red_lines`` are authoritative** over the generic verb pattern: an
    ``extract`` / ``navigate`` named in a red line still needs confirm.

The :data:`AWAITING_CONFIRM` string is the single source of truth for the new
paused run status (PRD §5/§7: ``TaskRun.status`` is free-text ``String(50)`` so a
typo won't be caught by the DB — define it once). ``loop.py`` (and the runner's
Phase-4 status write in issue 05) import this constant, never the literal.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

# ── Centralized run-status / metadata key ──────────────────────────────────────
# The new paused run status AND the ChannelResult.metadata key that signals it up
# the spine (PRD §5: metadata["awaiting_confirm"] -> PipelineResult.metadata ->
# runner Phase 4). Defined once; imported by loop.py / runner (issue 05).
AWAITING_CONFIRM = "awaiting_confirm"

# The companion metadata key carrying the action the operator must confirm.
PROPOSED_ACTION = "proposed_action"

# Generic high-risk verbs (ADR-0003 D4). Matched against the action verb AND the
# target element's name/role/value, case-insensitive, substring/word-ish.
HIGH_RISK_VERBS: tuple[str, ...] = ("submit", "pay", "post", "delete")

# Verbs that are inherently safe regardless of target (ADR-0003 D4: reads /
# navigation / scroll / extract auto-run). ``done`` is a control verb, not a
# page op, and is always safe.
AUTO_RUN_VERBS: tuple[str, ...] = ("navigate", "scroll", "extract", "done")

# Write-ish verbs that address a DOM element (ADR-0003 D3 ref verbs). These are
# the only verbs the generic high-risk pattern applies to, and the only verbs for
# which an unresolvable element (``element is None``) is treated as ambiguous.
WRITE_VERBS: frozenset[str] = frozenset({"click", "type", "select"})


class RiskTier(StrEnum):
    """Two tiers (ADR-0003 D4). ``StrEnum`` so the value IS the string ('auto'/
    'confirm') for events/JSON while keeping enum identity for the gate."""

    AUTO = "auto"          # read / navigate / scroll / extract — runs unattended
    CONFIRM = "confirm"    # write / high-risk / ambiguous — needs confirm


@dataclass(frozen=True)
class RiskDecision:
    """Outcome of classifying one action. Plain/immutable; dict-able for events."""

    tier: RiskTier
    needs_confirm: bool
    reason: str                          # why (for the event detail + tests)
    matched_red_line: str | None = None  # the red line that fired (step 1 only)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tier": self.tier.value,
            "needs_confirm": self.needs_confirm,
            "reason": self.reason,
            "matched_red_line": self.matched_red_line,
        }


def _red_lines_of(skill: Any) -> list[str]:
    """Read ``red_lines`` from a Skill row, its ``elements`` dict, or a plain dict.

    Accepts (so the classifier is testable without a DB row):
      * a ``Skill``-like object with an ``elements`` mapping,
      * a plain ``elements`` dict (``{"red_lines": [...]}``),
      * a dict that *is* the skill and nests ``elements``,
      * ``None`` → no red lines.
    Always returns a list of non-empty strings.
    """
    if skill is None:
        return []

    elements: Any = None
    if isinstance(skill, dict):
        # Either the elements dict itself, or a skill-shaped dict nesting it.
        elements = skill.get("elements", skill)
    else:
        elements = getattr(skill, "elements", None)

    red_lines: Any = None
    if isinstance(elements, dict):
        red_lines = elements.get("red_lines")
    if red_lines is None and isinstance(skill, dict):
        red_lines = skill.get("red_lines")

    if not red_lines:
        return []
    if isinstance(red_lines, str):
        red_lines = [red_lines]
    return [str(x).strip() for x in red_lines if str(x).strip()]


def _action_haystack(action: dict[str, Any], element: dict[str, Any] | None) -> str:
    """Lowercased text blob to match risk tokens against.

    Combines the action verb + the model-supplied free-text fields (``text``,
    ``data``, ``url``, ``value``, ``note``, ``status``) with the resolved
    element's ``name`` / ``role`` / ``value``. This is what both the red-line
    match and the generic high-risk pattern search.
    """
    parts: list[str] = []
    if isinstance(action, dict):
        for key in ("verb", "text", "url", "value", "note", "status"):
            v = action.get(key)
            if v:
                parts.append(str(v))
        data = action.get("data")
        if data:
            parts.append(str(data))
    if isinstance(element, dict):
        for key in ("name", "role", "value"):
            v = element.get(key)
            if v:
                parts.append(str(v))
    return " ".join(parts).lower()


def classify_action(
    action: dict[str, Any], element: dict[str, Any] | None, skill: Any
) -> RiskDecision:
    """Classify one action into a :class:`RiskDecision`. Pure; never raises.

    Decision order (this order is the contract — tests assert it):

    1. **``red_lines`` first and authoritative.** If the action (verb + target
       element name/role/value + the model's free-text args, lowercased) contains
       any red-line phrase → ``CONFIRM`` with ``matched_red_line`` set. **Wins
       even when the verb would otherwise auto-run** (e.g. an ``extract`` named in
       a red line) — acceptance criterion 3.
    2. **Generic high-risk pattern.** For a write verb (``click`` / ``type`` /
       ``select``): a ``type{...,submit:true}`` (the submit flag is a write
       signal regardless of element name), OR the verb token / element
       name/role/value containing a :data:`HIGH_RISK_VERBS` token
       (``submit|pay|post|delete``) → ``CONFIRM``.
    3. **Auto-run tiers.** ``navigate`` / ``scroll`` / ``extract`` / ``done``, and
       any plain read-style ``click`` / ``select`` that matched nothing above →
       ``AUTO``. **Any read is auto.**
    4. **Ambiguous default ⇒ confirm.** Unrecognized verb, OR a write verb with
       an unresolvable target (``element is None``) → ``CONFIRM`` with
       ``reason="ambiguous-default-confirm"``.
    """
    if not isinstance(action, dict):
        return RiskDecision(
            RiskTier.CONFIRM, True, reason="ambiguous-default-confirm"
        )

    verb = str(action.get("verb") or "").strip().lower()
    haystack = _action_haystack(action, element)

    # 1. red_lines — authoritative, even over auto-run verbs.
    for line in _red_lines_of(skill):
        token = line.lower()
        if token and token in haystack:
            return RiskDecision(
                RiskTier.CONFIRM,
                True,
                reason="red-line",
                matched_red_line=line,
            )

    is_write_verb = verb in WRITE_VERBS

    # 2. generic high-risk pattern (only meaningful for write verbs).
    if is_write_verb:
        # `type{...,submit:true}` is a write regardless of element name.
        if verb == "type" and bool(action.get("submit", False)):
            return RiskDecision(
                RiskTier.CONFIRM, True, reason="submit-flag"
            )
        for token in HIGH_RISK_VERBS:
            if token in haystack:
                return RiskDecision(
                    RiskTier.CONFIRM, True, reason=f"high-risk-verb:{token}"
                )

    # 4a. write verb with no resolvable target → ambiguous → confirm.
    if is_write_verb and element is None:
        return RiskDecision(
            RiskTier.CONFIRM, True, reason="ambiguous-default-confirm"
        )

    # 3. auto-run tiers: known-safe verbs, and plain reads.
    if verb in AUTO_RUN_VERBS or is_write_verb:
        return RiskDecision(RiskTier.AUTO, False, reason=f"auto:{verb}")

    # 4b. anything else (unknown verb) → ambiguous → confirm.
    return RiskDecision(
        RiskTier.CONFIRM, True, reason="ambiguous-default-confirm"
    )


def should_run(decision: RiskDecision, auto_confirm: bool) -> bool:
    """Gate decision: may this action run *now* without a human confirm?

    ``True`` → run it (auto-run tier, or ``auto_confirm`` bypasses the confirm).
    ``False`` → block: in headless v1 the loop aborts at :data:`AWAITING_CONFIRM`
    (interactive synchronous resume is issues 05/06). Pure — no browser needed,
    which is what makes acceptance criterion 5 testable in isolation.
    """
    if not decision.needs_confirm:
        return True
    return bool(auto_confirm)


def awaiting_confirm_metadata(action: dict[str, Any]) -> dict[str, Any]:
    """The additive ``ChannelResult.metadata`` contract for a blocked action.

    ``{AWAITING_CONFIRM: True, PROPOSED_ACTION: <action>}`` — rides
    ``ChannelResult.metadata`` → ``PipelineResult.metadata`` → runner Phase 4
    (issue 05 reads it and sets ``run.status = AWAITING_CONFIRM``). Keyed by the
    centralized constants, never inlined literals.
    """
    return {AWAITING_CONFIRM: True, PROPOSED_ACTION: dict(action)}
