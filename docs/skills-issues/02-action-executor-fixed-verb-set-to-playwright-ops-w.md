# 02 Action executor: fixed verb set to Playwright ops with ref resolution

> Self-contained build unit. Implementable in a fresh session from this file + `docs/adr/0003-skill-execute-loop-architecture.md` (ADR-0003) + `docs/skills-execute-loop-PRD.md` alone. Repo root: `D:/projects/opencli-admin`.

## Context

The skill subsystem closes a **record → distill → store → execute → correct** loop. The **execute** leg is a `skill` channel where a *cheap* text model (e.g. `qwen3:4b`) drives a real Chrome page step by step: **perceive → propose → confirm → act**. This issue builds the **act** primitive — the deterministic layer that takes *one* structured action the model already chose and performs it on the page, returning a structured result. It implements ADR-0003 decision **D3 (Action space: small fixed verb set, ref-addressed)** and is the executor the step loop (issue 03) calls once per step. It must obey the safety constraint baked into D3: **no `evaluate(js)` escape hatch** — arbitrary JS is the uncontrollable red line and never reaches the model. It is consumed downstream by D4 (the risk gate, issue 04) and D5 (run integration, issue 05); `extract` results become `ChannelResult.items` and `done` ends the loop. This issue does **not** decide *which* action to run (that is the model loop, issue 03) and does **not** classify risk or touch events/DB.

## Scope

**In scope**
- New module `backend/skills/actions.py`:
  - An action **schema/validator** for the exact 7 verbs `{navigate, click, type, select, scroll, extract, done}`, rejecting any other verb (including `evaluate`/`js`) with a structured error rather than raising.
  - `execute_action(page, snapshot, action)` — async dispatch that maps one validated action onto a `SkillPage` (the CDP/Playwright wrapper from issue 01).
  - **ref → element resolution**: resolve `action["ref"]` against the current `snapshot` (the `data-skill-ref` interactive list from issue 01) *before* acting; a missing/stale/out-of-range ref returns a structured error result.
  - **per-action result objects**: every call returns a uniform structured result (`ok`/`error`, the echoed verb, any extracted record, a `terminal` flag), never an exception for the expected failure cases (unknown verb, bad ref, missing field).
  - `extract{data}` → **record mapping**: returns a result carrying a record dict destined for `ChannelResult.items`; performs **no page write**.
  - `done{status,note}` → **terminal signal**: returns a result distinctly flagged as terminal.
- New test `tests/skills/test_actions.py` driving `execute_action` against a **fake/mock `SkillPage`** for every verb (happy path + bad-ref + unknown-verb), passing in the default `-m "not live"` suite.

**Out of scope** (deferred to other issues / v2)
- **Deciding which action to run** — the cheap-model step loop, the 9-element prompt, the tool-calling harness (OpenAI `tool_calls` + Qwen XML). That is **issue 03** (`backend/skills/loop.py`, `backend/skills/prompt.py`).
- **The risk gate / confirm tiering** (`red_lines`, high-risk pattern `submit|pay|post|delete`, `auto_confirm`, `awaiting_confirm`). That is **issue 04** (`backend/skills/risk.py`). The executor just runs whatever validated action it is handed; gating happens *before* `execute_action` is called.
- **Events / DB / `ChannelResult` wiring / pipeline integration.** The executor never calls `events.emit`, never opens a DB session, never builds a `ChannelResult`. Mapping the executor's `extract` record into `ChannelResult.items` and the terminal flag into loop termination is **issue 05** (`backend/channels/skill_channel.py`, `backend/pipeline/pipeline.py`, `backend/pipeline/runner.py`).
- **The CDP page wrapper and perception snapshot themselves** — `SkillPage` (`backend/skills/page.py`) and the injected-JS snapshot (`backend/skills/perception.py`). Those are **issue 01** (this issue's dependency). This issue *consumes* their contract; it does not implement Playwright/`connect_over_cdp` or the injected JS.
- **No new verbs beyond the fixed 7; no `evaluate(js)` / raw-DOM / screenshot path** (ADR-0003 D2/D3 red line).
- **`journey_trace_v1` trace assembly** (issue 06) — the executor returns per-action results; turning a sequence of them into a trace is not here.

## Depends on

- **01 — Playwright dep + CDP page wrapper + perception snapshot** (`backend/skills/page.py`, `backend/skills/perception.py`, `pyproject.toml`, `TESTING.md`). Issue 02 imports the `SkillPage` type from issue 01 (for typing only) and is written against the **method contract** and **snapshot shape** issue 01 defines. The unit tests here fake `SkillPage`, so issue 02 is testable without a real browser, but the production dispatch targets issue 01's real methods.

### Contract issue 02 assumes from issue 01 (verify against `backend/skills/page.py` / `backend/skills/perception.py` when 01 lands)

If issue 01's names differ, adapt the dispatch in `actions.py` to the actual symbols and keep this section as the rationale.

- **Snapshot shape** (ADR-0003 D2, `docs/GLOSSARY.md` "ref"): a list of dicts `[{ "ref": <int|str>, "role": str, "name": str, "value": str }, ...]`. `ref` is the per-snapshot `data-skill-ref` id. Ref resolution = locate the snapshot entry whose `ref` equals the action's `ref` (compare as strings to be tolerant of int/str). "Resolution" here is membership/validity in the current snapshot; the actual element lookup on the page is done by `SkillPage` *by ref* (it set `data-skill-ref` during perception). So the executor validates the ref against the snapshot, then passes the ref through to the matching `SkillPage` method.
- **`SkillPage` async methods** (the verb → op map; ADR-0003 D1/D3, PRD §4 D1):
  - `await page.goto(url)` — for `navigate{url}`.
  - `await page.click(ref)` — for `click{ref}`.
  - `await page.type(ref, text, submit=False)` — for `type{ref,text,submit?}`; `submit=True` triggers an Enter/submit via the wrapper, `submit` omitted/false does not.
  - `await page.select(ref, value)` — for `select{ref,value}`.
  - `await page.scroll(dir)` — for `scroll{dir}` (`dir` ∈ `{up, down}` at minimum; pass through and let `SkillPage` clamp).
  - `extract{data}` does **not** call a write method. `data` is the model-supplied record dict; the executor returns it as the record. (If issue 01 exposes a read helper like `page.inner_text(ref)` for value pull-through, it may be used to enrich `data` — optional, keep `extract` a pure read.)
  - `done{status,note}` calls **no** page method.

## Files

| File | Create/Edit | Purpose (one line) |
|---|---|---|
| `D:/projects/opencli-admin/backend/skills/actions.py` | **Create** | Fixed 7-verb action schema/validator + `execute_action(page, snapshot, action)` dispatch with ref resolution, per-action structured results, `extract`→record, `done`→terminal. |
| `D:/projects/opencli-admin/tests/skills/test_actions.py` | **Create** | Unit tests driving `execute_action` against a fake `SkillPage` for every verb (happy + bad-ref + unknown-verb), runnable under `-m "not live"`. |
| `D:/projects/opencli-admin/tests/skills/__init__.py` | **Create** | Make `tests/skills/` a package (the existing suite uses package dirs, e.g. `tests/unit/channels/__init__.py`). Empty file. |

> Note: existing tests live under `tests/unit/...` and `tests/integration/...`. This feature's PRD fixes the skill test path as `tests/skills/...`; create that directory by writing the files above. `testpaths = ["tests"]` in `pyproject.toml` already collects it.

## Implementation notes

Tie everything to this codebase's existing symbols. **Honor the fixed decisions** — do NOT change `AbstractChannel.collect(config, parameters)` (`backend/channels/base.py`); reuse the spine; do not add verbs; do not add a JS escape hatch.

1. **Module shape — pure-ish, no I/O of its own.** `actions.py` imports nothing from `backend.pipeline`, `backend.database`, or `backend.models`. It may `from typing import TYPE_CHECKING` and import `SkillPage` only under `TYPE_CHECKING` (issue 01's `backend/skills/page.py`) so the module loads even before a browser/Playwright is present and so the unit test can pass a fake. The only async surface is `execute_action`; validation is a sync pure function. Mirror the existing pure-function + async-dispatch split already used in `backend/channels/opencli_channel.py` (pure `_parse_*` helpers tested directly, async `collect`/`_run_opencli` tested with mocks) and `backend/skills/distill.py` (pure `extract_json`/`slug`, async `call_llm`/`distill_trace`).

2. **Fixed verb set as the single source of truth.** Define a module-level constant of the 7 allowed verbs and their required/optional fields, e.g.:
   ```python
   VERBS = {
       "navigate": {"required": ("url",),  "optional": ()},
       "click":    {"required": ("ref",),  "optional": ()},
       "type":     {"required": ("ref", "text"), "optional": ("submit",)},
       "select":   {"required": ("ref", "value"), "optional": ()},
       "scroll":   {"required": ("dir",),  "optional": ()},
       "extract":  {"required": ("data",), "optional": ()},
       "done":     {"required": ("status",), "optional": ("note",)},
   }
   ```
   This is the analogue of `WRITE_TOOLS` / `TOOLS` in `backend/api/v1/chat.py` but it is the **skill loop's own** schema — do **not** import or overload the chat-console `TOOLS`/`WRITE_TOOLS` (PRD §4 D3, §6 "Tool-calling harness"). Provide a `validate_action(action: dict) -> str | None` that returns an error string (or `None` when valid): unknown/missing `verb`, a verb not in `VERBS` (explicitly including `evaluate`/`js`/anything else), and missing required fields each yield a distinct message.

3. **Structured result objects.** Define one result constructor used everywhere — a small dataclass or a plain dict factory; match the project's lightweight style (`ChannelResult` in `backend/channels/base.py` is a `@dataclass` with `ok`/`fail` classmethods — mirror that). Suggested shape:
   ```python
   @dataclass
   class ActionResult:
       ok: bool
       verb: str | None = None
       error: str | None = None
       record: dict | None = None      # only set by extract
       terminal: bool = False          # only True for done
       detail: dict = field(default_factory=dict)  # e.g. {"status","note"} for done, {"ref"} acted on
   ```
   Provide `ActionResult.success(verb, **kw)` and `ActionResult.failure(verb, error)` classmethods. **Never raise for the expected failure cases** (unknown verb, bad/stale ref, missing field, page-op error) — convert them to `ActionResult.failure(...)`. Wrap each `await page.*` call in `try/except` and turn an unexpected `Exception` into a structured error (same best-effort discipline as `events.emit` in `backend/pipeline/events.py`, which never raises).

4. **Ref resolution before acting.** Add a pure helper `resolve_ref(snapshot, ref) -> dict | None` that returns the snapshot entry matching `ref` (string-compare to tolerate int/str), or `None`. In `execute_action`, for the ref-addressed verbs (`click`, `type`, `select`), call it first; on `None` return `ActionResult.failure(verb, f"stale/unknown ref: {ref!r}")` **before** touching the page. This is the "invalid/stale ref returns a structured error rather than raising" guarantee. `navigate`, `scroll`, `extract`, `done` are not ref-addressed and skip resolution.

5. **Dispatch (`execute_action`).** Order: `validate_action` → (for ref verbs) `resolve_ref` → call the matching `SkillPage` method → build the result.
   - `navigate` → `await page.goto(action["url"])` → `ActionResult.success("navigate", detail={"url": ...})`.
   - `click` → `await page.click(ref)` → success.
   - `type` → `await page.type(ref, action["text"], submit=bool(action.get("submit", False)))`. **`submit:true` must trigger an Enter/submit via the wrapper; `submit` omitted/false must not** (acceptance #4). Pass the flag through to `SkillPage.type`; the actual key press lives in `SkillPage` (issue 01) — the executor's job is to pass `submit` correctly and not invent its own page op.
   - `select` → `await page.select(ref, action["value"])` → success.
   - `scroll` → `await page.scroll(action["dir"])` → success.
   - `extract` → **no page write**; return `ActionResult.success("extract", record=dict(action["data"]))`. The record is destined for `ChannelResult.items` (issue 05 appends `result.record` to the items list). Copy the dict so the caller can't mutate the action.
   - `done` → **no page call**; return `ActionResult.success("done", terminal=True, detail={"status": action["status"], "note": action.get("note")})`. This is the **distinctly-flagged terminal** result (acceptance #3): `terminal=True` and no other verb sets it.

6. **What downstream issues do with the result (do not implement here, just keep the shape compatible).**
   - Issue 03's loop calls `execute_action` once per model step; reads `result.terminal` to stop, and `result.record` to accumulate.
   - Issue 04's risk gate runs **before** `execute_action`; it decides confirm/auto-run and never relies on the executor for risk.
   - Issue 05 maps `result.record` → `ChannelResult.items` (via `ChannelResult.ok(items, ...)` in `backend/channels/base.py`) and emits per-step `TaskRunEvent`s via `backend/pipeline/events.py::emit(run_id, step, ...)` (`step` values like `skill_step`, `skill_extract`, `skill_done`). The executor itself stays out of `events`/DB.

7. **Tests (`tests/skills/test_actions.py`).** Follow the existing mock style (`from unittest.mock import AsyncMock, MagicMock` as in `tests/unit/channels/test_opencli_channel.py`). `asyncio_mode = "auto"` is set in `pyproject.toml`, so `async def test_*` need no decorator. Build a **fake `SkillPage`**: a `MagicMock` whose `goto/click/type/select/scroll` are `AsyncMock`s; assert both the returned `ActionResult` and that the right method was awaited with the right args (e.g. `page.type.assert_awaited_once_with("3", "hello", submit=True)`). Use a small fixed snapshot, e.g. `SNAP = [{"ref": "1", "role": "button", "name": "Search", "value": ""}, {"ref": "3", "role": "textbox", "name": "q", "value": ""}]`. Required cases (acceptance #5):
   - **Happy path per verb** (7): navigate, click, type (with and without `submit`), select, scroll, extract (asserts `result.record` returned and **no write method called**), done (asserts `result.terminal is True`).
   - **bad-ref**: `click`/`type`/`select` with a ref not in the snapshot → `result.ok is False`, error mentions the ref, and the page method was **not** awaited.
   - **unknown-verb**: `{"verb": "evaluate", "js": "..."}` and `{"verb": "frobnicate"}` → `result.ok is False`, distinct error, no page call. (Explicitly assert `evaluate`/`js` is rejected — the ADR red line.)
   - **submit toggle**: separate assertions that `submit:true` passes `submit=True` and omitting it passes `submit=False`.
   - Keep these as pure unit tests (no DB, no `client` fixture, no `live` marker) so they run in the default `pytest -m "not live"` collection.

## Acceptance criteria

Falsifiable. Run from repo root `D:/projects/opencli-admin` (activate the project venv; dev extras from `pyproject.toml [project.optional-dependencies] dev`).

1. **Fixed verb set + reject others.** `backend/skills/actions.py` defines exactly `{navigate, click, type, select, scroll, extract, done}` and `validate_action` (or `execute_action`) **rejects any other verb — including `evaluate`/`js` — with a structured error**, never a raise. Verify:
   ```bash
   python -c "from backend.skills.actions import VERBS, validate_action; \
   assert set(VERBS) == {'navigate','click','type','select','scroll','extract','done'}, VERBS; \
   assert validate_action({'verb':'evaluate','js':'x'}); \
   assert validate_action({'verb':'frobnicate'}); \
   assert validate_action({'verb':'navigate'}); \
   assert validate_action({'verb':'navigate','url':'http://x'}) is None; \
   print('verbset-ok')"
   ```
   (Adjust the import names to the final symbols, but the verb set and the evaluate-rejection are non-negotiable.)
2. **Ref resolution → structured error, no raise.** `execute_action` resolves `{ref}` against the snapshot and calls the matching `SkillPage` method; an invalid/stale ref returns a failure result and the page method is **not** awaited. This is asserted by the bad-ref tests below; `execute_action` must not propagate an exception for a stale ref.
3. **`extract` → record, no write; `done` → terminal.** `extract{data}` returns a result whose record is a dict (destined for `ChannelResult.items`) and performs **no** page write (no `goto/click/type/select/scroll` awaited). `done{status,note}` returns a result with a distinct terminal flag (`terminal=True`) that no non-terminal verb sets. Asserted by the extract/done tests.
4. **`type` submit toggle.** `type{ref,text,submit:true}` triggers a submit/Enter via the wrapper (the executor calls `page.type(ref, text, submit=True)`); `submit` omitted/false calls it with `submit=False`. Asserted by two test cases.
5. **Tests pass in the default suite.** `tests/skills/test_actions.py` drives `execute_action` against a fake/mock `SkillPage` for **every** verb (happy path + bad-ref + unknown-verb) and passes with the browser-requiring tests deselected:
   ```bash
   pytest tests/skills/test_actions.py -m "not live" -p no:cacheprovider -q
   ```
   All tests pass with no real browser and no network. (The default `addopts` enforces `--cov=backend --cov-fail-under=80`; if running only this file trips the global coverage gate, run with `--no-cov` for the isolated check, but the file must pass as part of the full `pytest -m "not live"` run.)
6. **Lint clean.** `ruff check backend/skills/actions.py tests/skills/test_actions.py` passes (repo selects `E,F,I,N,W,UP`, line-length 100 — see `pyproject.toml [tool.ruff]`).

### Verifying against a real local Chrome (optional, not required to close this issue)
This issue's deliverable is unit-testable without a browser; ref resolution and dispatch are proven against a fake `SkillPage`. The *real* page-driving is issue 01's `SkillPage` and is exercised end-to-end by the **issue 07** e2e test (behind the `live` marker — see `pyproject.toml [tool.pytest.ini_options] markers`, deselected by `-m "not live"`). If you want a manual smoke once issue 01 has landed: from a Python REPL, acquire a CDP endpoint via `backend.browser_pool.get_pool().acquire(...)`, build a real `SkillPage`, take a snapshot via the issue-01 perception fn, then call `await execute_action(page, snapshot, {"verb":"navigate","url":"https://example.com"})` and `{"verb":"click","ref":<a real ref>}` and confirm the page reacts and a structured `ActionResult` returns. Do **not** add this to the default suite — it requires a running Chrome (ADR D8, PRD §7 "Windows Playwright install").

## Out of scope / non-goals

- Choosing which action to emit (issue 03 loop + prompt + tool-calling harness).
- Risk classification / confirm tiering / `auto_confirm` / `awaiting_confirm` (issue 04).
- `ChannelResult` construction, `events.emit`, DB, and pipeline wiring (issue 05); `journey_trace_v1` assembly (issue 06); e2e against real Chrome (issue 07).
- Implementing `SkillPage` / the perception snapshot / Playwright / `connect_over_cdp` (issue 01).
- Any new verb, any `evaluate(js)`/raw-DOM/screenshot path, vision models (ADR-0003 D2/D3, hard red line).
- Cross-process pause/resume, auto-triggered re-distill, NAT/edge-node execution (v2; PRD §1 non-goals, §8 cut-line).
- Changing `AbstractChannel.collect` signature or the chat-console `TOOLS`/`WRITE_TOOLS` (reuse the spine; define the skill verb schema separately).
