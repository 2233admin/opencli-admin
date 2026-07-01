"""The **record** leg — capture a human demonstration into ``journey_trace_v1``
(2026-07-01 addendum, ADR-0003). The one leg of the closed loop
(record → distill → store → execute → correct) that was never built: every
prior skill had to be hand-crafted as a raw trace dict and POSTed at the API.

Design (mirrors the execute leg's substrate — no new browser plumbing):

  * **Same CDP attach** as the execute leg — :func:`backend.skills.page.
    open_skill_page` connects to an **already-running, human-visible (headed)**
    Chrome via ``connect_over_cdp``. The human drives that real window directly;
    this module never renders a live view or streams video (ADR-0003 record
    addendum: this whole subsystem is single-user/local — the human is already
    looking at the same machine's screen).
  * **Capture, not drive.** Unlike :mod:`backend.skills.loop` (a cheap model
    *proposes* one action per step and an executor runs it), here a human acts
    freely and the page **reports** what happened via a small injected listener
    + ``page.expose_binding`` — the one genuinely new piece of browser
    plumbing in this codebase (no prior ``expose_binding``/event-listener
    precedent existed; ``loop.py`` is purely action-driven).
  * **Semantic capture, not ref replay.** The listener reports each element's
    *accessible name* (same algorithm as :data:`backend.skills.perception.
    SNAPSHOT_JS`: aria-label → text → placeholder → title → name → value), not
    a numeric ``data-skill-ref``. A recorded trace never needs to be replayed
    ref-for-ref — the distiller reads it holistically and the execute leg's
    *own* cheap model re-perceives the live page and picks its own refs at run
    time ("举一反三,非复刻坐标" — generalize, don't hard-code coordinates). This
    also sidesteps keeping a capture-time ref scheme in sync with
    ``perception.py``'s independent per-step tagging.
  * **Same trace shape.** Steps are built as the *same* :class:`~backend.skills
    .loop.StepRecord` dataclass the execute leg produces, and
    :func:`~backend.skills.trace.assemble_trace` (unchanged, zero new code)
    assembles the final ``journey_trace_v1`` — the distiller
    (:func:`backend.skills.distill.distill_trace`) needs no adaptation to
    consume a human-recorded trace.
  * **Human asserts the outcome.** ``stop(status=...)`` is the human explicitly
    marking "this demo succeeded / failed" — the most honest ground truth
    available (the execute leg has to *infer* success via ``self_eval``
    heuristics because no human is present there).
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from backend.skills.loop import StepRecord
from backend.skills.page import SkillPage
from backend.skills.trace import assemble_trace, outcome_from_loop

logger = logging.getLogger(__name__)

# Injected once via `page.add_init_script` (Playwright re-runs init scripts on
# every navigation automatically — no manual re-injection on framenavigated
# needed, unlike perception.py's per-step SNAPSHOT_JS which is called fresh
# each loop iteration instead). Capture-phase listeners so a click/change deep
# inside a component still bubbles to `document` before any site handler can
# stop propagation. Reports {verb, name, role, value?, ts} — never `ref` (see
# module docstring "semantic capture, not ref replay").
#
# The guard flag is keyed by `sessionId` (passed as the function arg), NOT a
# fixed name — `open_skill_page` may hand back an *already-open* page (it
# reuses `context.pages[0]`), so a second, unrelated RecordSession attaching to
# the same live page must NOT see a prior session's leftover flag and skip
# installing its own listener (verified live: a fixed flag name silently
# no-ops the second session's capture entirely — the bug this comment is
# guarding against actually happened during development).
CAPTURE_JS = r"""
(sessionId) => {
  const boundKey = '__skillRecordBound_' + sessionId;
  if (window[boundKey]) return;
  window[boundKey] = true;
  const nameOf = (el) => {
    if (!el || !el.getAttribute) return '';
    let name = (
      el.getAttribute('aria-label') ||
      (el.textContent || '').trim() ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('name') ||
      el.getAttribute('value') ||
      ''
    );
    return String(name).replace(/\s+/g, ' ').trim().slice(0, 200);
  };
  const roleOf = (el) =>
    (el && el.getAttribute && el.getAttribute('role')) || ((el && el.tagName) || '').toLowerCase();
  document.addEventListener('click', (e) => {
    window.__record_event({ verb: 'click', name: nameOf(e.target), role: roleOf(e.target) });
  }, true);
  document.addEventListener('change', (e) => {
    const tag = ((e.target && e.target.tagName) || '').toLowerCase();
    const isSelect = tag === 'select';
    window.__record_event({
      verb: isSelect ? 'select' : 'type',
      name: nameOf(e.target),
      role: roleOf(e.target),
      value: String((e.target && e.target.value) ?? ''),
    });
  }, true);
  document.addEventListener('submit', (e) => {
    window.__record_event({ verb: 'submit', name: nameOf(e.target), role: 'form' });
  }, true);
}
"""


@dataclass
class RecordSession:
    """One in-progress recording — accumulates :class:`StepRecord`\\ s until
    :meth:`stop` assembles them into a ``journey_trace_v1`` trace.

    Construct via :func:`start_recording`; the caller (the API router, issue
    skill-record) owns the session's lifetime in an in-process dict keyed by
    ``session_id`` — this whole subsystem is single-user/local (no Redis/DB-
    backed session store needed, matching the rest of ADR-0003).
    """

    session_id: str
    domain: str
    capability: str
    page: SkillPage
    steps: list[StepRecord] = field(default_factory=list)
    _last_ts: float = field(default_factory=time.monotonic, repr=False)
    stopped: bool = False

    async def start(self) -> None:
        """Wire the capture binding + listener onto the live page.

        ``expose_binding`` (Playwright-native) persists across navigations on
        its own; ``add_init_script`` re-runs :data:`CAPTURE_JS` on every new
        document automatically, so a human navigating mid-demo keeps being
        captured with no manual re-injection. The *current* already-loaded
        document predates both, so it gets one manual injection too.
        """
        await self.page.page.expose_binding("__record_event", self._on_event)
        # `add_init_script` only takes raw JS source (no separate-arg form like
        # `evaluate`), so the session id is inlined as a JS string literal here
        # (safe — `session_id` is a `uuid.uuid4().hex`, pure alphanumeric).
        await self.page.page.add_init_script(f"({CAPTURE_JS})({self.session_id!r})")
        await self.page.page.evaluate(CAPTURE_JS, self.session_id)
        self.page.page.on("framenavigated", self._on_navigate)

    def _append(self, *, verb: str, args: dict[str, Any], target: Any) -> None:
        now = time.monotonic()
        elapsed_ms = int((now - self._last_ts) * 1000)
        self._last_ts = now
        self.steps.append(
            StepRecord(
                index=len(self.steps),
                verb=verb,
                args=args,
                target=target,
                result={"captured": True},
                elapsed_ms=elapsed_ms,
            )
        )

    def _on_navigate(self, frame: Any) -> None:
        # Playwright's `on("framenavigated")` handler is sync; only the main
        # frame counts as a step (iframe navigations are noise for this v1).
        if frame is not self.page.page.main_frame:
            return
        self._append(verb="navigate", args={"url": frame.url}, target=frame.url)

    async def _on_event(self, source: dict[str, Any], payload: dict[str, Any]) -> None:
        """`page.expose_binding` callback — one call per captured DOM event."""
        verb = payload.get("verb")
        name = payload.get("name") or ""
        role = payload.get("role") or ""
        if verb == "click":
            args: dict[str, Any] = {"name": name, "role": role}
        elif verb == "type":
            args = {"name": name, "role": role, "text": payload.get("value", "")}
        elif verb == "select":
            args = {"name": name, "role": role, "value": payload.get("value", "")}
        elif verb == "submit":
            args = {"name": name}
        else:  # pragma: no cover - CAPTURE_JS never emits anything else
            return
        self._append(verb=verb, args=args, target=name)

    async def stop(self, *, status: str, note: str | None = None) -> dict[str, Any]:
        """Human marks the demo done — append a ``done`` step and assemble the
        full ``journey_trace_v1`` (unchanged :func:`assemble_trace`, same shape
        the execute leg produces). Does **not** persist a Skill row — the
        caller reviews the returned trace first, then explicitly distills it
        (mirrors the execute leg's propose→confirm philosophy: capture is
        reversible/inspectable before it becomes a skill).
        """
        self.stopped = True
        self._append(
            verb="done",
            args={"status": status, "note": note},
            target=status,
        )

        trace_id = f"record-{self.session_id}"
        outcome = outcome_from_loop("done_success" if status == "success" else "done_failed")
        outcome["trace_id"] = trace_id
        return assemble_trace(
            [s.to_dict() for s in self.steps],
            outcome,
            domain=self.domain,
            label=self.capability,
            trace_id=trace_id,
            extra={"recorded": True, "step_count": len(self.steps)},
        )


async def start_recording(cdp_endpoint: str, *, domain: str, capability: str) -> RecordSession:
    """Attach to ``cdp_endpoint`` (same acquisition path as the execute leg —
    the caller resolves it via ``browser_pool.get_pool().acquire()``) and start
    a new :class:`RecordSession`."""
    from backend.skills.page import open_skill_page

    page = await open_skill_page(cdp_endpoint)
    session = RecordSession(
        session_id=uuid.uuid4().hex, domain=domain, capability=capability, page=page,
    )
    await session.start()
    logger.info(
        "record session started | id=%s domain=%s capability=%s",
        session.session_id, domain, capability,
    )
    return session
