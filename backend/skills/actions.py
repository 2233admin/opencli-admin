"""Action executor — fixed verb set → SkillPage ops, ref-addressed (ADR-0003 D3).

This is the deterministic **act** primitive of the skill execute loop. It takes
*one* structured action the cheap model already chose (issue 03 picks it; issue
04 gates it) and performs it on a CDP-attached page, returning a uniform
structured result. It decides **nothing** about *which* action runs and never
classifies risk, opens a DB session, emits events, or builds a ``ChannelResult``
— those are issues 03/04/05.

Hard red line (ADR-0003 D2/D3): the verb set is exactly the fixed 7 below; any
other verb — explicitly including ``evaluate``/``js`` — is rejected with a
structured error, never executed. There is **no** model-facing JS escape hatch.

Module shape mirrors ``backend/skills/distill.py`` and
``backend/channels/opencli_channel.py``: a pure sync validator
(:func:`validate_action`) + pure ref resolver (:func:`resolve_ref`) tested
directly, and a single async dispatch (:func:`execute_action`) tested against a
mock ``SkillPage``. It imports nothing from ``backend.pipeline`` /
``backend.database`` / ``backend.models``; ``SkillPage`` is imported only under
``TYPE_CHECKING`` so the module loads with no browser / Playwright present.
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # typing only — no runtime browser/Playwright import
    from backend.skills.page import SkillPage

# ── Fixed verb set: single source of truth (ADR-0003 D3) ───────────────────────
# The 7 allowed verbs and their required/optional fields. This is the skill
# loop's OWN schema — deliberately NOT the chat-console TOOLS/WRITE_TOOLS in
# backend/api/v1/chat.py (PRD §4 D3). No verb may be added here, and there is no
# ``evaluate``/``js`` entry — that omission is what rejects the JS escape hatch.
VERBS: dict[str, dict[str, tuple[str, ...]]] = {
    "navigate": {"required": ("url",), "optional": ()},
    "click": {"required": ("ref",), "optional": ()},
    "type": {"required": ("ref", "text"), "optional": ("submit",)},
    "select": {"required": ("ref", "value"), "optional": ()},
    "scroll": {"required": ("dir",), "optional": ()},
    "extract": {"required": ("data",), "optional": ()},
    "done": {"required": ("status",), "optional": ("note",)},
}

# Verbs that address a DOM element by ``ref`` — they get ref-resolved against the
# current snapshot before the page is touched. The rest are not ref-addressed.
_REF_VERBS = frozenset({"click", "type", "select"})


@dataclass
class ActionResult:
    """Uniform result of one executed action.

    Returned for *every* call — success and the expected failure cases alike
    (unknown verb, bad/stale ref, missing field, page-op error). Mirrors
    ``ChannelResult``'s ``ok``/``fail`` classmethod style (``backend/channels/
    base.py``). Never raised; expected failures become ``failure(...)``.

    Fields:
      * ``ok``       — True on success, False on any handled failure.
      * ``verb``     — the echoed verb (None when the verb itself was invalid).
      * ``error``    — failure message (None on success).
      * ``record``   — only set by ``extract``; destined for
        ``ChannelResult.items`` (issue 05 appends it).
      * ``terminal`` — only True for ``done``; the loop-termination signal.
      * ``detail``   — extra context, e.g. ``{"url"}`` / ``{"ref"}`` acted on,
        or ``{"status","note"}`` for ``done``.
    """

    ok: bool
    verb: str | None = None
    error: str | None = None
    record: dict[str, Any] | None = None
    terminal: bool = False
    detail: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def success(
        cls,
        verb: str,
        *,
        record: dict[str, Any] | None = None,
        terminal: bool = False,
        detail: dict[str, Any] | None = None,
    ) -> "ActionResult":
        return cls(
            ok=True,
            verb=verb,
            record=record,
            terminal=terminal,
            detail=detail or {},
        )

    @classmethod
    def failure(cls, verb: str | None, error: str) -> "ActionResult":
        return cls(ok=False, verb=verb, error=error)


def validate_action(action: dict[str, Any]) -> str | None:
    """Validate one action dict against :data:`VERBS`. Pure; never raises.

    Returns an error string when the action is invalid, or ``None`` when it is
    well-formed. Distinct messages for: not a dict, missing/empty ``verb``, a
    verb not in the fixed set (this is the ``evaluate``/``js`` rejection), and
    each missing required field.
    """
    if not isinstance(action, dict):
        return f"action must be a dict, got {type(action).__name__}"

    verb = action.get("verb")
    if not verb:
        return "missing 'verb'"
    if verb not in VERBS:
        # Any verb outside the fixed 7 — including evaluate/js — is rejected here.
        return f"unknown verb: {verb!r} (allowed: {sorted(VERBS)})"

    for fieldname in VERBS[verb]["required"]:
        if fieldname not in action:
            return f"verb {verb!r} missing required field: {fieldname!r}"
    return None


def _normalize_ref(ref: Any) -> Any:
    """Strip the ``#`` display prefix a model may echo back as part of a ref.

    ``prompt._render_snapshot`` shows each element to the model as
    ``#<ref> <role> "<name>"`` while the snapshot's own refs (and the
    ``data-skill-ref`` DOM attributes) are bare ints/digit strings — a model
    that faithfully copies the rendered token sends ``"#0"`` and every click
    dies as ``stale/unknown ref`` before touching the page. Accept that echo
    at the action boundary instead of failing it.
    """
    if isinstance(ref, str) and ref.startswith("#"):
        return ref[1:]
    return ref


def resolve_ref(
    snapshot: list[dict[str, Any]], ref: Any
) -> dict[str, Any] | None:
    """Return the snapshot entry whose ``ref`` matches ``ref``, else ``None``.

    Pure helper. Compares as strings to tolerate int/str refs (the snapshot's
    ``ref`` is an int from ``perception.project_snapshot``; the model may emit it
    as a string, with or without the rendered ``#`` prefix — see
    :func:`_normalize_ref`). "Resolution" is membership/validity in the *current*
    snapshot; the actual element lookup on the page is done by ``SkillPage`` by
    ref (it set ``data-skill-ref`` during perception). A ``None`` return means
    the ref is stale/unknown — the caller turns that into a structured failure
    *before* touching the page.
    """
    if not snapshot:
        return None
    target = str(_normalize_ref(ref))
    for entry in snapshot:
        if isinstance(entry, dict) and str(entry.get("ref")) == target:
            return entry
    return None


async def execute_action(
    page: "SkillPage",
    snapshot: list[dict[str, Any]],
    action: dict[str, Any],
) -> ActionResult:
    """Perform one validated action on ``page``; return a structured result.

    Order: :func:`validate_action` → (for ref verbs) :func:`resolve_ref` → call
    the matching ``SkillPage`` method → build the result. Never raises for the
    expected failure cases — unknown verb, bad/stale ref, missing field, and any
    page-op ``Exception`` are converted to ``ActionResult.failure(...)`` (the
    same best-effort discipline as ``events.emit``).

    Does not decide *which* action to run (issue 03), classify risk (issue 04),
    or wire records/terminal into the pipeline (issue 05).
    """
    err = validate_action(action)
    if err is not None:
        return ActionResult.failure(action.get("verb"), err)

    # Normalize a model-echoed "#N" ref once, up front, so both the snapshot
    # membership check below and the SkillPage data-skill-ref lookup see the
    # bare ref. Copy — never mutate the caller's action dict (it is traced).
    if "ref" in action:
        action = {**action, "ref": _normalize_ref(action["ref"])}

    verb = action["verb"]

    # extract / done touch no page op — handle before resolution/dispatch.
    if verb == "extract":
        # Pure read: copy the model-supplied record so the caller can't mutate
        # the action. No page write (acceptance #3).
        return ActionResult.success("extract", record=dict(action["data"]))
    if verb == "done":
        # Distinctly-flagged terminal result (acceptance #3): terminal=True and
        # no other verb sets it. No page call.
        return ActionResult.success(
            "done",
            terminal=True,
            detail={"status": action["status"], "note": action.get("note")},
        )

    # Ref-addressed verbs: resolve against the current snapshot first; a
    # stale/unknown ref fails before the page is touched (acceptance #2).
    if verb in _REF_VERBS:
        ref = action["ref"]
        if resolve_ref(snapshot, ref) is None:
            return ActionResult.failure(verb, f"stale/unknown ref: {ref!r}")

    try:
        if verb == "navigate":
            url = action["url"]
            await page.goto(url)
            return ActionResult.success("navigate", detail={"url": url})
        if verb == "click":
            ref = action["ref"]
            await page.click(ref)
            return ActionResult.success("click", detail={"ref": ref})
        if verb == "type":
            ref = action["ref"]
            submit = bool(action.get("submit", False))
            await page.type(ref, action["text"], submit=submit)
            return ActionResult.success(
                "type", detail={"ref": ref, "submit": submit}
            )
        if verb == "select":
            ref = action["ref"]
            await page.select(ref, action["value"])
            return ActionResult.success("select", detail={"ref": ref})
        if verb == "scroll":
            direction = action["dir"]
            await page.scroll(direction)
            return ActionResult.success("scroll", detail={"dir": direction})
    except Exception as exc:  # page-op failure → structured error, never raise
        return ActionResult.failure(verb, f"page op failed: {exc}")

    # Unreachable: validate_action already rejected anything outside the fixed
    # set. Kept as a defensive structured failure rather than a silent None.
    return ActionResult.failure(verb, f"unhandled verb: {verb!r}")
