# 01 Playwright dependency + CDP page wrapper + injected-JS perception snapshot

> Self-contained issue. Source of truth for the design: `docs/adr/0003-skill-execute-loop-architecture.md` (decisions **D1**, **D2**) and `docs/skills-execute-loop-PRD.md` (§4 D1/D2, §8 cut-line, §9 issue 01). You should not need any other context to implement this.

## Context

The skill subsystem closes a record → distill → store → **execute** → correct loop. This issue builds the **lowest layer of the execute leg**: the page-driving primitives that everything above (action executor #02, model loop #03, run integration #05) sits on. Today the repo has **zero in-process page-driving primitives** — `backend/agent_server.py` only shells `opencli collect`, and there is no `playwright` / `connect_over_cdp` reference anywhere in the codebase or `pyproject.toml`. The skill channel skeleton (`backend/channels/skill_channel.py`) already acquires a CDP endpoint string from the shared browser pool and stops at a confirm-gate stub; what is missing is the thing that takes that endpoint and actually drives the page.

This issue implements exactly two ADR decisions:
- **ADR-0003 D1 (Placement — center-side, Playwright over CDP):** add Playwright as a new backend dependency and wrap `chromium.connect_over_cdp(cdp_endpoint)` in a thin `SkillPage` helper exposing the page ops the verb set needs. Local + LAN endpoints only.
- **ADR-0003 D2 (Perception — injected-JS interactive snapshot with refs):** a `snapshot()` that injects JS to tag visible interactive elements with a sequential `data-skill-ref` and returns a compact, **token-bounded** `[{ref, role, name, value}]` list. No raw DOM, no screenshots (the executor model is a small text model, ~32k context).

No model, no loop, no DB, no events, no run integration in this issue — those are #02–#07.

## Scope

**In scope**
- Add `playwright` to `pyproject.toml` `[project].dependencies`.
- `backend/skills/page.py` — `SkillPage` wrapper (+ `open_skill_page(cdp_endpoint)` async factory) around `connect_over_cdp`, exposing the raw page ops the verb set (#02) will call: `goto`, `click(ref)`, `type(ref, text, submit)`, `select(ref, value)`, `scroll(dir)`, `inner_text()`/`extract()`.
- `backend/skills/perception.py` — `snapshot(page) -> list[dict]`: injected-JS ref tagging + the `[{ref, role, name, value}]` projection + element-count cap / pagination. Parsing/projection logic must be pure-Python and unit-testable **without a browser** (the JS-eval boundary is mockable).
- `backend/skills/__init__.py` if the package marker is missing (so `backend.skills.page` / `backend.skills.perception` import). Note: `backend/skills/distill.py` already exists, so the package likely already imports — only add the marker if needed.
- `TESTING.md` — a short note that the skill execute loop needs `playwright install chromium` (Windows dev/CI) and that the loop connects **over CDP** to an already-running `browser_pool` Chrome.

**Out of scope** (other issues / v2)
- The cheap-model step loop and 9-element prompt → **#03**.
- Action-verb dispatch / risk gate / `red_lines` matching beyond the raw page ops → **#02 / #04**.
- Any run / event / DB integration (`events.emit`, `run_id`, `ChannelResult` plumbing, `awaiting_confirm` status) → **#04 / #05**.
- `journey_trace_v1` emission, re-distill, dock button → **#06**.
- e2e against a real local Chrome behind the `live` marker → **#07** (this issue only needs a parsing unit test in the default suite; a live smoke test here is optional).
- Screenshots, raw-DOM / `outerHTML` dumps, vision models, `evaluate(js)` exposed to the model — **rejected by ADR-0003** (D2/D3), do not add.

## Depends on

**None.** This is the first issue in the build order (PRD §9). It does not touch `SkillChannel.collect`, the pipeline, or the DB.

## Files

| File | Create / Edit | Purpose (one line) |
|---|---|---|
| `D:/projects/opencli-admin/pyproject.toml` | Edit | Add `playwright>=1.40.0` to `[project].dependencies`. |
| `D:/projects/opencli-admin/backend/skills/page.py` | Create | `SkillPage` + `open_skill_page(cdp_endpoint)` — `connect_over_cdp` wrapper exposing `goto/click/type/select/scroll/inner_text/extract`, all `ref`-addressed. |
| `D:/projects/opencli-admin/backend/skills/perception.py` | Create | `snapshot(page) -> list[dict]` — injected-JS ref tagging + `[{ref,role,name,value}]` projection + element-count cap; pure parsing helper split out for testing. |
| `D:/projects/opencli-admin/TESTING.md` | Edit | Document `playwright install chromium` (Windows) + "loop connects over CDP to a browser_pool Chrome". |
| `D:/projects/opencli-admin/tests/skills/test_perception.py` | Create | Unit test (or doctest) for the pure snapshot-parsing/cap logic; runs under `-m "not live"` with **no browser** (mock the JS-eval boundary). |

## Implementation notes

Tie everything to the symbols that already exist in this repo. Do not invent new substrate; do not change `AbstractChannel.collect`.

### 1. Dependency (`pyproject.toml`)
- Add `"playwright>=1.40.0"` to the `[project].dependencies` array (the same list that currently ends with `"docker>=7.0.0"`). Keep the existing comment-grouped style; a `# Browser automation (skill execute loop over CDP)` comment above it is fine.
- After `pip install -e .` (or `uv sync`), `from playwright.async_api import async_playwright` must import. The Chromium **driver** comes from `playwright install chromium`; the loop connects to an *already-running* Chrome over CDP, so a second browser is not required at runtime — only the driver. Document this in `TESTING.md` (below).

### 2. `backend/skills/page.py` — the CDP wrapper (ADR D1)
- Async API throughout (the codebase is async: channels, pipeline, `browser_pool.acquire` is an `@asynccontextmanager`).
- The endpoint argument is **exactly the value `browser_pool.get_pool().acquire(endpoint=...)` yields** — a CDP endpoint URL string (see `backend/browser_pool.py`; the skeleton in `backend/channels/skill_channel.py` already does `async with pool.acquire(endpoint=endpoint) as cdp_endpoint:`). Take it as a plain `str`; do **not** acquire the pool slot inside `SkillPage` (the caller owns the slot lifetime).
- Connect with `async_playwright().start()` → `pw.chromium.connect_over_cdp(cdp_endpoint)`. `connect_over_cdp` attaches to the **existing** browser context, so a logged-in page (site cookies already in that Chrome) is reused — same substrate the opencli channel relies on. Pick the existing context/page when present (`browser.contexts[0]` → its first `page`, else `new_page()`); only create a context/page if none exists.
- Shape it as a class plus a factory:
  - `class SkillPage` holding the Playwright handle, browser, and active `page`.
  - `async def open_skill_page(cdp_endpoint: str) -> SkillPage` factory that does the connect.
  - Provide `async def aclose(self)` and make it usable as an async context manager (`__aenter__`/`__aexit__`) so the loop (#03) can `async with open_skill_page(ep) as sp:`. On close, `await browser.close()` then `await pw.stop()` — but do **not** close the underlying Chrome owned by the pool; closing the *connection* is enough. (Prefer disconnecting the CDP connection over killing the browser; if Playwright's `connect_over_cdp` browser `.close()` would terminate the shared Chrome, use context/page cleanup instead and just `pw.stop()`.)
- Page ops (these are the raw primitives #02's verb dispatcher will call — keep them dumb, one Playwright action each):
  - `async def goto(self, url: str)` → `await page.goto(url)`; return when navigation settles (default `wait_until` is fine). Must navigate and return without raising given a live endpoint.
  - `async def click(self, ref: str)` → resolve the element by its `data-skill-ref` attribute (`page.locator(f'[data-skill-ref="{ref}"]')`) and `.click()`.
  - `async def type(self, ref: str, text: str, submit: bool = False)` → locate by ref, `.fill(text)` (or `.click()` then `.type(text)` if a real keystroke stream is needed), and if `submit` press `Enter`.
  - `async def select(self, ref: str, value: str)` → locate by ref, `.select_option(value)`.
  - `async def scroll(self, direction: str)` → `page.evaluate` a `window.scrollBy(0, ±viewport)` (down/up). This is the **only** internal `evaluate` use besides perception; it is **not** exposed to the model (ADR D3 forbids a model-facing `evaluate(js)`).
  - `async def inner_text(self)` / `async def extract(self)` → return visible page text (e.g. `await page.inner_text("body")`) for the `extract` verb. Keep it text, not HTML.
- `ref` resolution is the contract between this wrapper and perception: a `ref` is the `N` that `snapshot()` wrote as `data-skill-ref="N"`. Resolve strictly by that attribute so a stale ref fails loudly rather than clicking the wrong element.
- Module docstring should state: connects over CDP to a `browser_pool` Chrome (local/LAN only), reuses existing logged-in context, no model-facing JS escape hatch.

### 3. `backend/skills/perception.py` — the snapshot (ADR D2)
- Public: `async def snapshot(page, *, max_elements: int = DEFAULT_MAX_ELEMENTS) -> list[dict]`.
  - Inject one JS string via `await page.evaluate(JS)` that:
    1. selects visible `a, button, input, select, [role]` (skip hidden / zero-size / `display:none`),
    2. assigns each a sequential `data-skill-ref="0"`, `"1"`, … **in the DOM**,
    3. returns a compact list of `{ref, role, name, value}` where `role` = tag or ARIA role, `name` = accessible name (text / `aria-label` / `placeholder` / `value` fallback), `value` = current value for inputs/selects (empty string otherwise).
  - Each returned dict has **exactly** the keys `ref`, `role`, `name`, `value` (no extras) — this is asserted by #03's prompt builder and by the acceptance test.
  - `ref` in the returned dict must equal the `data-skill-ref` written in the DOM (so #02's `click(ref)` resolves the same element).
- **Token bound (hard requirement, ADR D2 + PRD §7 "Token blow-up on huge pages"):**
  - Cap the returned list at `max_elements` (define `DEFAULT_MAX_ELEMENTS` as a module constant; **document the default in the docstring** — pick a sane value, ~50, small enough to stay well under the ~32k cheap-model context). Truncate deterministically (first N in DOM order); reaching more elements is the `scroll` verb's job, not a bigger snapshot.
  - **Never** return `outerHTML` / raw DOM / a screenshot. Only the projected `[{ref,role,name,value}]` list crosses the boundary.
- **Testability split (so the default suite needs no browser):** factor the pure transform out of the I/O. Concretely, have the injected JS return a raw list and do the **cap + key-normalization + shape validation in Python** in a separate pure function, e.g. `project_snapshot(raw: list[dict], max_elements: int) -> list[dict]`. Then `snapshot(page)` = `project_snapshot(await page.evaluate(JS), max_elements)`. The unit test exercises `project_snapshot` directly (and/or calls `snapshot` with a fake `page` whose `evaluate` is an `AsyncMock` returning canned raw rows) — no Playwright, no Chrome. This mirrors how `backend/skills/distill.py` keeps parsing pure (`extract_json`, `to_skill_fields`) and DB/FS-free.

### 4. `tests/skills/test_perception.py`
- `tests/skills/` may not exist yet — create it (the PRD reserves `tests/skills/` for #07's live e2e; a non-live unit test lives here too). Add `tests/skills/__init__.py` if the test layout needs it.
- Assert, with **no browser**:
  - `project_snapshot` returns dicts whose keys are exactly `{"ref","role","name","value"}`.
  - `ref` values are sequential and match the input rows' assigned refs.
  - the list is capped at `max_elements` when given more rows than the cap.
  - the output contains no `html`/`outerHTML`/screenshot key.
- Optionally a `snapshot(fake_page)` test using `unittest.mock.AsyncMock` for `page.evaluate` (the project already uses `pytest-asyncio` with `asyncio_mode = "auto"`).
- This test must run and pass under the default invocation `pytest -m "not live"` (the suite enforces `--cov-fail-under=80`; keep the new modules covered by exercising `project_snapshot` and the page wrapper's pure bits, or the live-only Playwright lines will drag coverage — see "coverage" below).

### 5. `TESTING.md`
- Append a short subsection (Chinese is fine to match the file; e.g. "## Skill 执行回路（CDP 浏览器驱动）") noting:
  - `playwright install chromium` is required for the skill execute loop on Windows (`win32` dev/CI).
  - the loop **connects over CDP** (`connect_over_cdp`) to an already-running Chrome supplied by `browser_pool` (the same Chrome the existing Tests 1–10 start with `--remote-debugging-port=9222`), so no second browser is needed at runtime — only the Playwright driver.
  - the browser-dependent path is gated behind the existing `live` pytest marker; the default `pytest -m "not live"` does not need a browser.

### Coverage note (don't break `--cov-fail-under=80`)
`pyproject.toml` runs `--cov=backend --cov-fail-under=80`. Pure functions (`project_snapshot`, ref-resolution helpers) are unit-tested here. The Playwright-touching lines in `page.py` / `snapshot()`'s `evaluate` call are only reachable with a real browser; if they pull total coverage under 80, either (a) keep those branches thin and exercise them with an `AsyncMock` `page`, or (b) add the new browser-only modules' live-only lines to `[tool.coverage.run] omit` **only if** mocking can't cover them — prefer mocking. Do not lower the global threshold.

## Acceptance criteria

Falsifiable; run from the repo root `D:/projects/opencli-admin`.

1. **Dependency present + importable.** `playwright` appears in `pyproject.toml` `[project].dependencies`, and after install `python -c "from playwright.async_api import async_playwright; print('ok')"` prints `ok` (no ImportError).
2. **`SkillPage` connects over CDP.** `backend/skills/page.py` defines an async `SkillPage` and an `open_skill_page(cdp_endpoint)` factory that calls `chromium.connect_over_cdp(cdp_endpoint)` and exposes `goto(url)`, `click(ref)`, `type(ref, text, submit)`, `select(ref, value)`, `scroll(dir)`, and `inner_text()`/`extract()`. Static check: `python -c "import inspect, backend.skills.page as p; assert all(hasattr(p.SkillPage, m) for m in ['goto','click','type','select','scroll','inner_text','extract']); assert inspect.iscoroutinefunction(p.open_skill_page)"`.
3. **Snapshot shape + ref tagging.** `backend/skills/perception.py` exposes `snapshot(page) -> list[dict]` where **every** dict has exactly the keys `ref, role, name, value`; visible interactive elements get a sequential `data-skill-ref="N"` set in the DOM and the returned `ref` equals that `N`. Verified by the unit test against `project_snapshot` (and/or a mocked `page`).
4. **Token-bounded, no raw DOM/screenshots.** `snapshot()` caps the returned element count at a configurable limit with a documented default (`DEFAULT_MAX_ELEMENTS`), and returns neither `outerHTML`/raw DOM nor a screenshot. Verified by the cap test and by a `grep` showing no `outerHTML` / screenshot return path in `perception.py`.
5. **Non-live unit test, browser-free.** `pytest tests/skills/test_perception.py -m "not live"` passes **without a browser** (the JS-eval boundary is mocked / the pure transform is tested directly). The full default suite `pytest -m "not live"` still passes and still meets `--cov-fail-under=80`.
6. **TESTING.md updated.** `TESTING.md` documents `playwright install chromium` and states that the loop connects over CDP to a `browser_pool` Chrome.
7. **(Optional, manual) Live smoke against real Chrome.** With a Chrome started per `TESTING.md` (`--remote-debugging-port=9222`), a throwaway script: `open_skill_page("http://127.0.0.1:9222")` → `await sp.goto("https://example.com")` → `await snapshot(sp.page)` returns a non-empty `[{ref,role,name,value}]` list and the DOM shows `data-skill-ref` attributes. (Full automation of this is #07 under the `live` marker; not required to close this issue.)

## Out of scope / non-goals

- **No model, no loop, no prompt.** The cheap-model step loop, the 9-element system prompt, and the OpenAI/Qwen tool-calling harness are **#03**. This issue ships only the page + perception primitives they call.
- **No action dispatch / risk logic.** Mapping the fixed verb set to these ops, `red_lines` / high-risk pattern matching, `auto_confirm`, and the `awaiting_confirm` status are **#02 / #04**. `SkillPage` exposes raw ops only; it makes **no** risk decisions.
- **No run / event / DB plumbing.** Do not touch `SkillChannel.collect`, `backend/pipeline/pipeline.py`, `backend/pipeline/runner.py`, `backend/pipeline/events.py::emit`, `ChannelResult` metadata, or any migration. Those are **#05 / #04**.
- **No record leg, no re-distill, no trace.** `journey_trace_v1` emission and re-distill (`backend/skills/trace.py`, `correction.py`, dock "重蒸技能") are **#06**.
- **No NAT/edge execution.** Local + LAN CDP endpoints only (ADR D1); driving NAT edge nodes via `agent_server` is v2.
- **Rejected by ADR-0003 — do not add:** raw-DOM/`outerHTML` dumps, screenshots, vision-model perception, or a model-facing `evaluate(js)` escape hatch (D2/D3). The single internal `evaluate` for scroll/snapshot stays server-side and is never surfaced to the model.
