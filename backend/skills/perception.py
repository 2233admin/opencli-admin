"""Perception — injected-JS interactive snapshot with refs (ADR-0003 D2).

Each step of the skill execute loop perceives the page by injecting one JS
string that walks **visible interactive** elements (`a, button, input, select,
[role]`), tags each with a sequential ``data-skill-ref="N"`` *in the DOM*, and
returns a compact, token-bounded ``[{ref, role, name, value}]`` list. Actions
(#02) then address elements by that ``ref`` (see ``backend.skills.page``).

Why this shape (not raw DOM / screenshots): the executor model is a small
**text** model (e.g. ``qwen3:4b``, ~32k context, not vision), so raw DOM dumps
and screenshots are rejected on token + capability grounds (ADR-0003 D2/D3).
Only the projected ``[{ref, role, name, value}]`` list ever crosses the
model boundary — never ``outerHTML``, raw DOM, or an image.

Testability split (mirrors ``distill.py``'s pure ``extract_json`` /
``to_skill_fields``): the JS returns a *raw* list and the cap +
key-normalization + shape validation happen in **pure Python**
(``project_snapshot``), so the default test suite exercises the transform with
**no browser**. ``snapshot(page)`` is the thin I/O wrapper:
``project_snapshot(await page.evaluate(JS), max_elements)``.
"""

from typing import Any

# Token bound (ADR-0003 D2 + PRD §7 "Token blow-up on huge pages"): cap the
# returned interactive-element list so a huge page cannot blow past the cheap
# model's ~32k context. ~50 elements is a sane default — small enough to stay
# well under budget; reaching more elements is the `scroll` verb's job (#02),
# not a bigger snapshot. Override per-call via `snapshot(page, max_elements=...)`.
DEFAULT_MAX_ELEMENTS = 50

# Exact, ordered key set every projected row carries. Asserted by #03's prompt
# builder and the acceptance test — no extra keys cross the boundary.
SNAPSHOT_KEYS = ("ref", "role", "name", "value")

# Injected JS: tag visible interactive elements with a sequential
# data-skill-ref IN THE DOM and return a raw [{ref, role, name, value}] list.
# Pure projection (cap / normalize / validate) is done in Python below, so this
# string stays a thin DOM-walker and the JS-eval boundary is mockable.
#
#   1. select visible `a, button, input, select, [role]`
#      (skip hidden / zero-size / display:none / visibility:hidden),
#   2. assign each a sequential data-skill-ref="0", "1", … in the DOM,
#   3. return {ref, role, name, value}: role = ARIA role or tag name,
#      name = accessible name (text / aria-label / placeholder / value),
#      value = current value for inputs/selects ("" otherwise).
SNAPSHOT_JS = r"""
() => {
  const sel = 'a, button, input, select, textarea, [role]';
  const nodes = Array.from(document.querySelectorAll(sel));
  const out = [];
  let ref = 0;
  for (const el of nodes) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    el.setAttribute('data-skill-ref', String(ref));

    const tag = (el.tagName || '').toLowerCase();
    const role = el.getAttribute('role') || tag;

    let name = (
      el.getAttribute('aria-label') ||
      (el.textContent || '').trim() ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('name') ||
      el.getAttribute('value') ||
      ''
    );
    name = name.replace(/\s+/g, ' ').trim().slice(0, 200);

    let value = '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      value = (el.value == null ? '' : String(el.value)).slice(0, 200);
    }

    out.push({ ref: ref, role: role, name: name, value: value });
    ref += 1;
  }
  return out;
}
"""


def project_snapshot(
    raw: list[dict[str, Any]], max_elements: int = DEFAULT_MAX_ELEMENTS
) -> list[dict[str, Any]]:
    """Pure projection: cap + key-normalize + shape-validate the raw JS rows.

    Browser-free and unit-testable. Takes the list returned by ``SNAPSHOT_JS``
    (or any list of mapping-like rows) and produces a deterministic
    ``[{ref, role, name, value}]`` list where:

      * each dict has **exactly** the keys ``ref, role, name, value`` (extras
        dropped, missing filled — ``ref`` coerced to ``int``, the rest to
        ``str``);
      * the list is truncated to the first ``max_elements`` rows in DOM order
        (the token bound — reaching more elements is the ``scroll`` verb's job);
      * the returned ``ref`` equals the ``data-skill-ref`` the JS wrote in the
        DOM, so #02's ``click(ref)`` resolves the same element.

    Never emits ``outerHTML`` / raw DOM / a screenshot — only the projection.
    """
    if max_elements < 0:
        max_elements = 0
    rows = raw[:max_elements] if raw else []

    projected: list[dict[str, Any]] = []
    for row in rows:
        get = row.get if isinstance(row, dict) else (lambda _k, _d=None: _d)
        ref_raw = get("ref", None)
        try:
            ref = int(ref_raw)
        except (TypeError, ValueError):
            # Fall back to positional index so refs stay sequential/usable.
            ref = len(projected)
        projected.append(
            {
                "ref": ref,
                "role": str(get("role", "") or ""),
                "name": str(get("name", "") or ""),
                "value": str(get("value", "") or ""),
            }
        )
    return projected


async def snapshot(
    page: Any, *, max_elements: int = DEFAULT_MAX_ELEMENTS
) -> list[dict[str, Any]]:
    """Perceive ``page``: inject the ref-tagging JS and return the projected,
    token-bounded ``[{ref, role, name, value}]`` interactive snapshot.

    ``page`` is a Playwright ``Page`` (or any object exposing an awaitable
    ``evaluate(js)`` — the I/O boundary is mockable, so this is testable with an
    ``AsyncMock`` and no real browser). The default element cap is
    :data:`DEFAULT_MAX_ELEMENTS` (50).
    """
    raw = await page.evaluate(SNAPSHOT_JS)
    return project_snapshot(raw or [], max_elements=max_elements)
