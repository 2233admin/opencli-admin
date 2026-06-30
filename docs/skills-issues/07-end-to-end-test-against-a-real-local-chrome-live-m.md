# 07 End-to-end test against a real local Chrome (live marker)

> Source of truth: `docs/adr/0003-skill-execute-loop-architecture.md` (decisions D1–D8) and `docs/skills-execute-loop-PRD.md` (§3 flows, §6 integration points, §7 risk *"Windows Playwright install"*, §8 cut-line, issue **07**). This file is self-contained: an implementer should not need to re-derive anything from chat. It assumes issues **01–05** have landed (the skill execute loop is wired end to end through `SkillChannel.collect`); issue **06** (trace emission + re-distill) is optional for the richer trace assertion.

---

## Context

The skill subsystem closes a **record → distill → store → execute → correct** loop (ADR-0003). Issues 01–06 build the *execute* leg in unit/integration-level isolation against fakes (a stub `SkillPage`, a scripted cheap model). Nothing yet proves the whole v1 path against a **real browser**. This issue adds **one** end-to-end test that drives a genuine local Chrome over CDP and asserts the loop actually *perceives → acts → extracts → ends on `done`*, plus that the headless write-gate aborts on a high-risk action.

How it fits the loop and which decisions it exercises:
- **D1 (placement: center-side, Playwright over CDP)** — the test connects over CDP to a Chrome from `backend.browser_pool` and drives it in-process via Playwright `connect_over_cdp`, exactly as `SkillChannel.collect` does. Local/LAN only.
- **D2/D3 (injected-JS snapshot + fixed verb set)** — the skill navigates and `extract`s on a deterministic local page; the test asserts an extract record reaches `ChannelResult.items`.
- **D4 + D8 (risk-tiered confirm, headless abort)** — the test exercises the headless gate: a high-risk action with `auto_confirm` **off** must produce an `awaiting_confirm` outcome with **no silent write**.
- **D5 (stay in the spine, no `collect()` contract change)** — the loop emits per-step `TaskRunEvent`s via `backend.pipeline.events.emit`; the test asserts those rows exist.

The whole test is gated behind the **existing** `live` pytest marker so the default coverage suite (run with `-m 'not live'`, `--cov-fail-under=80`) never needs a browser. This is the v1 cut-line item "e2e against a real local Chrome (behind `live` marker)" and the PRD §7 *"Windows Playwright install"* risk made reproducible.

---

## Scope

**In scope**
- `tests/skills/test_execute_loop_live.py`, marked `@pytest.mark.live`, that:
  - serves a **deterministic local/static page** (a fixture HTML served by a localhost http server inside the test, or a `file://` URL) — no external-site dependence;
  - acquires a **real local Chrome CDP endpoint** from `backend.browser_pool` (or a configured endpoint env var) and runs an **inline `SKILL.md`** skill through the real spine (`SkillChannel.collect`, ideally via `run_pipeline` / `run_collection_pipeline`);
  - asserts: at least one `extract` record reaches `ChannelResult.items` (or stored records when run through the full pipeline), the loop **ends on `done`**, and `TaskRunEvent`s were emitted for the run's steps (perceive / step / extract / done);
  - asserts the **headless gate**: a high-risk action with `auto_confirm` off yields an `awaiting_confirm` outcome and performs **no write**.
- `tests/skills/__init__.py` (package marker; `tests/skills/` does not exist yet).
- `TESTING.md`: a new section documenting how to run the live skill test on **Windows** (`playwright install chromium`, a running Chrome CDP endpoint, the exact `pytest -m live` command, env vars).

**Out of scope** (deferred to v2 or owned by other issues)
- CI gating changes beyond *honoring* the existing `live` marker (no new CI jobs/workflows; the default suite must keep deselecting `live`).
- Testing NAT/edge-node execution via `agent_server` (v2).
- Any flaky external-site dependence — the page under test is deterministic and local.
- Cross-process pause/resume of an `awaiting_confirm` run (v2). The test asserts the **abort**, not a resume.
- Building the loop/channel/risk-gate themselves (issues 01–06). This issue only *tests* them.

---

## Depends on

- **05 — Run integration: wire `SkillChannel.collect` into the spine** (`backend/channels/skill_channel.py`, `backend/pipeline/pipeline.py`, `backend/pipeline/runner.py`). Issue 07 cannot pass until 05 makes `SkillChannel.collect` actually perceive/act/extract and return real `ChannelResult.items` + `metadata["awaiting_confirm"]`. (05 transitively requires 01–04.)
- **06 — `journey_trace_v1` emission** is *optional* for this issue: if 06 has landed you may also assert `ChannelResult.metadata["trace"]` is a `journey_trace_v1`-shaped dict; if not, assert only the `TaskRunEvent` step rows. Do **not** block 07 on 06.

---

## Files

| File | Create / Edit | One-line purpose |
|---|---|---|
| `D:/projects/opencli-admin/tests/skills/test_execute_loop_live.py` | create | The single `live`-marked e2e: real CDP Chrome + deterministic local page → assert extract→items, step events, `done` termination, and the headless `awaiting_confirm` abort. |
| `D:/projects/opencli-admin/tests/skills/__init__.py` | create | Package marker so `tests/skills/` is importable (the dir does not exist yet). |
| `D:/projects/opencli-admin/TESTING.md` | edit | Add a *"技能执行环路 e2e（live marker，Windows）"* section: `playwright install chromium`, launch a Chrome with `--remote-debugging-port`, set the CDP endpoint env var, run `pytest -m live tests/skills/test_execute_loop_live.py`. |

> Optional helper if the static fixture HTML is large: `tests/skills/fixtures/skill_demo_page.html`. Inlining the HTML as a Python string in the test is also fine and keeps the test self-contained — pick one.

---

## Implementation notes (concrete to this codebase)

### 1. The `live` marker already exists — reuse it, broaden its meaning
`pyproject.toml` `[tool.pytest.ini_options]` already declares:
```toml
markers = [
  "live: tests that require a running API server and opencli daemon (deselect with -m 'not live')",
]
addopts = "--cov=backend --cov-report=term-missing --cov-fail-under=80"
asyncio_mode = "auto"
testpaths = ["tests"]
```
- Mark the test `@pytest.mark.live`. Do **not** add a new marker.
- You **may** widen the marker description to also cover *"a local Chrome reachable over CDP"* (one-line edit). Keep the `-m 'not live'` deselect contract intact — that is the whole point.
- `asyncio_mode = "auto"` means `async def test_...` functions run without a per-test decorator (matches existing tests).
- Because the loop writes `TaskRunEvent` rows via the **module-level** `backend.database.AsyncSessionLocal` (see `backend/pipeline/events.py::emit`), the in-memory `db_session` fixture in `tests/conftest.py` is **not** the DB the loop writes to. The live test must use the real configured DB — see step 4.

### 2. Acquire a real Chrome CDP endpoint from `browser_pool`
The skeleton already does `get_pool().acquire(endpoint=...)` and `connect_over_cdp` happens inside the loop (D1). For the test:
- Read the CDP endpoint from an env var (document it in `TESTING.md`), e.g. `SKILL_LIVE_CDP_ENDPOINT` (fall back to `OPENCLI_CDP_ENDPOINT`, the var `TESTING.md` already uses for Chrome). If unset, **skip** with a clear reason:
  ```python
  ep = os.environ.get("SKILL_LIVE_CDP_ENDPOINT") or os.environ.get("OPENCLI_CDP_ENDPOINT")
  if not ep:
      pytest.skip("set SKILL_LIVE_CDP_ENDPOINT to a running Chrome --remote-debugging-port endpoint")
  ```
- Initialize the pool so `get_pool()` resolves and the endpoint is routable. `backend.browser_pool` is a module-level singleton initialized via `init_pool(endpoints, ...)`; the test should call `init_pool([ep])` (local pool) before the run. `pool.acquire(endpoint=ep)` then yields that exact endpoint string; `pool.get_mode(ep)` defaults to `"bridge"` — the skill loop uses Playwright `connect_over_cdp`, so set `pool.set_mode(ep, "cdp")` if the loop branches on mode.
- Pass the endpoint into the channel the same way the spine does: `parameters["chrome_endpoint"] = ep` (see `SkillChannel.collect`, which reads `parameters.get("chrome_endpoint")`).

### 3. Deterministic local page + inline `SKILL.md`
- **Page**: serve a tiny static HTML with `http.server.ThreadingHTTPServer` on `127.0.0.1:0` in a fixture (yield the `http://127.0.0.1:<port>/` URL, shut it down on teardown), or write a temp `.html` and use its `file://` URL. The page must contain:
  - extractable content with a stable selector (e.g. a list of `<div class="item">…</div>` or a `<table>`), so an `extract` action returns a record deterministically;
  - exactly one **high-risk** control for the abort case — a `<button>` whose name/role matches the high-risk pattern (`submit | pay | post | delete`), e.g. `<button id="delete-btn">Delete account</button>`, or wrap an `<input type="submit">` in a `<form>`. The risk classifier from issue 04 (`backend/skills/risk.py`) matches verb + element name/role.
- **Inline `SKILL.md`**: the channel accepts `config["skill_md"]` inline (`_resolve_skill_md` in `backend/channels/skill_channel.py`). Author **two** skills (or two configs):
  - a **read-only** skill whose `procedure` is "navigate to the page, extract the items, then done" and whose `terminal_conditions` are satisfied by the extract — drives the happy path;
  - a **high-risk** skill whose procedure leads the model to act on the delete/submit control — drives the abort. Include a matching `red_lines` entry so the gate is authoritative (D4: `red_lines` over the generic pattern).
- The cheap model: do **not** require a live LLM in this test. Inject a **deterministic/scripted executor** so the page interaction is real but the *action choice* is fixed (avoids `live`-test flakiness from a model). Drive it through whatever seam issue 03's loop exposes for the executor (e.g. a provider/model-call function you can monkeypatch, or a `config["provider"]` pointing at a fake). The browser side stays real; only the action sequence is scripted: `navigate{url}` → `extract{...}` → `done{...}` for the happy path, and `navigate{url}` → `click{ref=<delete button>}` for the abort path.

### 4. Run through the real spine and assert
Prefer exercising the **real** integration surface (D5) over calling internals:
- **Option A (preferred): full pipeline.** Create a `skill` `DataSource` (`channel_type="skill"`, `channel_config={"skill_md": ..., "auto_confirm": False}`) + a `CollectionTask` in the real DB, then call `backend.pipeline.runner.run_collection_pipeline(task_id, {"chrome_endpoint": ep})`. This routes `run_pipeline → collector.collect → SkillChannel.collect`, emits events through `events.emit(run_id, ...)`, and (issue 05) propagates `metadata["awaiting_confirm"]` to set `TaskRun.status = "awaiting_confirm"` in Phase 4. To do this the test needs the real schema present: create tables once against the configured engine, e.g.
  ```python
  from backend.database import engine, Base, AsyncSessionLocal
  import backend.models  # noqa: F401 — register all models
  async with engine.begin() as conn:
      await conn.run_sync(Base.metadata.create_all)
  ```
  (Use the default sqlite DB or a throwaway file DB via `DATABASE_URL`; document this in `TESTING.md`.)
- **Option B (lighter): channel direct.** Call `SkillChannel().collect(config, {"chrome_endpoint": ep, "run_id": run_id})` directly and assert on the returned `ChannelResult`. You still must create a `TaskRun` row first if you want to assert `TaskRunEvent`s (the FK `task_run_events.run_id → task_runs.id`).

**Assertions — happy path (read-only skill, `auto_confirm` off but no high-risk action reached):**
- `result.success is True` and `result.items` (the `ChannelResult.items` from `ChannelResult.ok(items, ...)`) contains **≥ 1** extracted record with the expected field(s) from the page. If using Option A, equivalently assert `pipeline_result.stored >= 1` (records reached `storer`).
- The loop ended on `done`: assert a `skill_done`-style `TaskRunEvent` exists (the loop ends on `done{}` or max-step cap — D6), and `result.metadata.get("awaiting_confirm")` is falsy.
- `TaskRunEvent` rows exist for the run's steps. Query `TaskRunEvent` by `run_id` and assert the `step` set includes the loop's perceive/step/extract/done markers. Per PRD §6 the new `step` values are: `skill_perceive`, `skill_step`, `awaiting_confirm`, `skill_extract`, `skill_done`, `self_eval` (`TaskRunEvent.step` is free-text `String(50)`, so match on whatever issue 03/04 actually emit — read those modules to get the exact strings; the assertion should require at least one perceive, one step/extract, and one done event).
- *(Optional, only if issue 06 landed)* `result.metadata["trace"]` is a dict with `summary.domain`, `label`, `trace_id`, a `steps[]` array, and an `outcome` block (the `journey_trace_v1` shape `distill_trace` reads).

**Assertions — headless abort (high-risk skill, `auto_confirm` off):**
- The run does **not** silently perform the write. Assert an `awaiting_confirm` `TaskRunEvent` was emitted **and** the result signals the pause: `result.metadata.get("awaiting_confirm") is True` (Option B), or `TaskRun.status == "awaiting_confirm"` after `run_collection_pipeline` (Option A — issue 05 must set this in runner Phase 4, *not* force `completed`/`failed`).
- Assert the page side effect did **not** happen — e.g. the delete button's click handler sets a DOM flag (`window.__deleted`) or a counter; after the run, evaluate the page and assert the flag is still false. This is the load-bearing *"no silent write"* check (PRD §7 *"Risk classifier false-negatives are the danger"*).
- Whatever was extracted *before* the abort still flows through (PRD Flow B step 4) — if the high-risk skill extracts first, assert those items are present too.

### 5. Honor the fixed decisions (do not regress the design)
- **Do NOT change `AbstractChannel.collect(config, parameters)`** — the test calls it with the existing 2-arg signature; `run_id`/`chrome_endpoint` ride inside `parameters` (D5). `backend/channels/base.py` is frozen by this contract.
- **Reuse the spine**: events via `backend.pipeline.events.emit`; extract via `ChannelResult.ok(items, ...)` → `normalizer`/`storer`; paused status via `ChannelResult.metadata["awaiting_confirm"]` → `PipelineResult.metadata` → runner. Don't invent a parallel test-only path that bypasses these — the point is to prove the real wiring.
- **No `evaluate(js)` in the action space** (D3). The test may use Playwright `page.evaluate` for *its own* assertions (reading `window.__deleted`), but the *skill* must only use the fixed verb set.
- **Local/LAN only** (D1/D8). The CDP endpoint is `127.0.0.1`; no NAT/agent path.

### 6. `TESTING.md` — Windows reproducibility section
Add a section (Chinese, matching the file's existing voice) covering, for a fresh dev on `win32`:
1. Install Playwright + its Chromium driver:
   ```bash
   uv pip install playwright      # or: pip install playwright (already a backend dep after issue 01)
   playwright install chromium
   ```
   Note (from PRD §7): the loop *connects over CDP* to an already-running Chrome, so the bundled Chromium is needed for the **driver**, not necessarily a second browser.
2. Launch a local Chrome with a CDP debug port (Windows path):
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 `
     --no-first-run --no-default-browser-check
   ```
3. Point the test at it and run **only** the live skill test:
   ```powershell
   $env:SKILL_LIVE_CDP_ENDPOINT = "http://127.0.0.1:9222"
   pytest -m live tests/skills/test_execute_loop_live.py
   ```
4. State explicitly that the **default** suite excludes it:
   ```powershell
   pytest -m "not live"   # the --cov-fail-under=80 suite; no browser required
   ```
5. Mention the DB used by the live test (default sqlite or a throwaway `DATABASE_URL`) and that `playwright install chromium` is a one-time setup per machine.

---

## Acceptance criteria (falsifiable)

1. **Deselected by default.** `pytest -m 'not live'` does **not** run `tests/skills/test_execute_loop_live.py`, and the default suite still passes `--cov-fail-under=80` **without a browser**. Verify:
   ```powershell
   pytest -m "not live" --collect-only -q | Select-String "test_execute_loop_live"   # → no matches
   pytest -m "not live"                                                              # → passes, no Chrome needed
   ```
2. **Real CDP + deterministic page → items + `done`.** With a Chrome CDP endpoint running and `SKILL_LIVE_CDP_ENDPOINT` set, `pytest -m live tests/skills/test_execute_loop_live.py` passes; the read-only skill connects over CDP (endpoint from `backend.browser_pool` / the env var), runs on a deterministic local page, and the test asserts **≥ 1** extract record reached `ChannelResult.items` (or `pipeline_result.stored >= 1`) and the loop ended on `done` (a `skill_done` event present; `metadata["awaiting_confirm"]` falsy).
3. **Step events emitted.** The live test queries `TaskRunEvent` by `run_id` and asserts events for the run's steps were written — at least one perceive event, at least one step/extract event, and one done event (exact `step` strings taken from issues 03/04, e.g. `skill_perceive` / `skill_step` / `skill_extract` / `skill_done`).
4. **Headless gate exercised, no silent write.** With `auto_confirm` off and a high-risk action (matching `submit|pay|post|delete` or the skill's `red_lines`), the live test asserts an `awaiting_confirm` outcome (`ChannelResult.metadata["awaiting_confirm"] is True`, or `TaskRun.status == "awaiting_confirm"` via `run_collection_pipeline`) **and** that the page write did not occur (a DOM flag set by the high-risk control is still false after the run).
5. **Reproducible on Windows.** `TESTING.md` documents, for a fresh dev: `playwright install chromium`, launching Chrome with `--remote-debugging-port`, setting `SKILL_LIVE_CDP_ENDPOINT`, the exact `pytest -m live` command, and the `pytest -m "not live"` default — sufficient to reproduce the test on `win32` from scratch.

**How to verify against a real local Chrome:** start Chrome with `--remote-debugging-port=9222`, `set SKILL_LIVE_CDP_ENDPOINT=http://127.0.0.1:9222`, run `pytest -m live tests/skills/test_execute_loop_live.py`; with no endpoint set the test must `pytest.skip(...)` with an actionable message rather than fail.

---

## Out of scope / non-goals

- **No new CI jobs or workflow files.** Honor the existing `live` marker only; the default `-m 'not live'` run must keep working browser-free.
- **No external-site dependence.** The page under test is a deterministic local/static fixture (localhost http server or `file://`). Do not point the test at a real website.
- **No NAT/edge execution** via `agent_server` (v2). CDP endpoint is local/LAN only.
- **No cross-process resume.** The abort path asserts the run stops at `awaiting_confirm`; resuming it is v2.
- **No live LLM requirement.** The cheap model's action choice is scripted/injected so the test is deterministic; only the **browser** is real. Testing real model tool-calling is covered by issue 03's unit tests, not here.
- **Do not implement the loop, channel, risk gate, trace, or re-distill here** — those are issues 01–06. Issue 07 is the e2e proof only.
