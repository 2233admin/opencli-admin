# PRD — Skill execute loop (v1)

Status: draft · Owner: skills subsystem · Source of truth for architecture: `docs/adr/0003-skill-execute-loop-architecture.md` · Glossary: `docs/GLOSSARY.md`

> The 8 architecture decisions in ADR-0003 are **fixed**. This PRD turns them into a buildable v1: it states the goal, the flows, the concrete integration points in *this* codebase, the data-model delta, the risks, and a hard scope cut-line. The issue breakdown at the end decomposes v1 into independently grabbable units.

---

## 1. Goal & non-goals

### Goal
Close the **execute** leg of the skill subsystem: a `skill` channel that loads a distilled `SKILL.md` and lets a *cheap* text model (e.g. `qwen3:4b`) drive a real Chrome page step by step — perceive → propose → confirm → act — staying entirely inside the existing task / run / pipeline / events spine, reusing the agent dock's proposal→confirm guardrail, and emitting a `journey_trace_v1`-shaped trace so a failing run can be fed back to the **same** distiller (`backend/skills/distill.py`) for correction (re-distill, never hand-patch).

A skill `DataSource` must be runnable two ways with the *same* loop:
1. **Dock interactive** — a human watches in the agent dock, confirms high-risk actions synchronously.
2. **Headless / scheduled** — runs unattended; aborts cleanly with run status `awaiting_confirm` the moment a confirm-required action is reached (unless the skill is risk-free or the source is marked `auto_confirm`).

### Non-goals (v1)
- **The human *record* leg ("录这站")** that produces the *first* `journey_trace_v1` from a human demonstration. v1 only fixes the trace **shape** both legs must share; producing it from a recording is a separate TODO.
- **Cross-process pause / resume.** A headless run that hits a confirm-required action stops at `awaiting_confirm`; resuming it later (re-attaching the page, replaying state) is **v2**.
- **Auto-triggered re-distill after N consecutive failures.** v1 re-distill is **human-triggered** from the dock. The self-eval signal (outcome vs `terminal_conditions`/`milestones`) is computed and logged to `skills.evidence` in v1, but the *automatic* "after N fails, re-distill" policy is v2.
- **NAT / edge-node execution.** v1 reaches **local + LAN** CDP endpoints only (via `browser_pool`). Driving NAT edge nodes through `agent_server` is deferred, mirroring how `opencli collect` added agent mode after local mode.
- **Vision models, raw-DOM dumps, screenshots, `evaluate(js)`.** Rejected by ADR on token / capability / safety grounds.

---

## 2. Background — what STEP 1 already landed

The record→distill→store skeleton and the channel shell already exist:

| Area | File / symbol | State |
|---|---|---|
| Distiller (the single converter for both legs) | `backend/skills/distill.py` — `distill_trace(trace, provider)`, `provider_from_model(mp)`, `to_skill_fields(spec)`, `call_llm`, `extract_json`, `ELEMENT_KEYS` | Done. Pure (no DB/FS writes); takes a `journey_trace_v1` trace + provider config → 9-element spec. |
| Skill model | `backend/models/skill.py` — `Skill` | Done. `(domain, capability)` unique; `skill_md`, `elements` JSON, `evidence` JSON, `source_trace`, `distill_model`, `status`/`version`/`enabled`. |
| Migration | `backend/migrations/versions/m3h4i5j6k7l8_add_skills.py` | Done. Current Alembic head. |
| Skill channel shell | `backend/channels/skill_channel.py` — `SkillChannel(channel_type="skill")` | **Skeleton.** Validates config, acquires a browser from `browser_pool`, resolves provider + `auto_confirm`, returns a single `proposed_step` stub and stops at the confirm gate. **No perceive/act loop, no events, no extract.** |
| Registration | `backend/channels/registry.py` — `skill_channel` imported in `_load_all_channels()` | Done. `get_channel("skill")` resolves. |

So the seam is open: `SkillChannel.collect()` already gets `config` + `parameters`, already binds a CDP endpoint string. What's missing is everything between "I have a CDP endpoint" and "here are the extracted records + a trace".

### Substrate this builds on (already in the repo)
- **`backend/browser_pool.py`** — `get_pool().acquire(endpoint=None)` async-context yields a **CDP endpoint URL string**; `pool.get_mode(ep)` returns `"bridge"` or `"cdp"`. **No Playwright / CDP client dependency exists** — confirmed: zero `playwright`/`connect_over_cdp` references in `opencli_channel.py`, `agent_server.py`, or `pyproject.toml`. `agent_server` only shells `opencli collect`. **Playwright is a new backend dependency** (ADR D1).
- **Pipeline spine** — `backend/pipeline/runner.py::run_collection_pipeline` creates the `TaskRun`, resolves provider/agent config, calls `run_pipeline`. `backend/pipeline/pipeline.py::run_pipeline` runs collect→normalize→store→ai→notify and **already special-cases `channel_type=="opencli"`** to inject `chrome_endpoint` into `parameters` and to build a richer collect event. `backend/pipeline/collector.py::collect` dispatches `get_channel(source.channel_type).collect(source.channel_config, parameters)`.
- **Events** — `backend/pipeline/events.py::emit(run_id, step, message, level, detail, elapsed_ms)` writes one `TaskRunEvent` (best-effort, never raises). `TaskRunEvent` model in `backend/models/task.py`.
- **Guardrail** — `backend/api/v1/chat.py` is the proposal→confirm reference: `TOOLS` (OpenAI function schema), `WRITE_TOOLS` set, `_build_proposal`, `/chat/confirm`, `_is_xml_tool_model` + `_parse_tool_use` (Qwen XML `<tool_use>` variant). Frontend dock: `frontend/src/labs/topology/AgentDock.tsx` already renders `ChatReply{type:"proposal"}` as a diff card and posts to `/chat/confirm`.

---

## 3. v1 user / operator flows

### Flow A — Dock interactive run (the v1 happy path)
1. Operator opens the agent dock on `/labs/topology`, selects (or references) a `skill` `DataSource` and triggers a run (reuses the existing `trigger_task` proposal→confirm, or a thin "run skill" entry).
2. Backend creates a `CollectionTask` + `TaskRun` (`runner.run_collection_pipeline`), `run_pipeline` injects `run_id` + a resolved `chrome_endpoint` into `parameters`, and dispatches `SkillChannel.collect()`.
3. The loop, per step: **perceive** (inject JS, get `[{ref,role,name,value}]` snapshot) → build the step system prompt from the SKILL.md 9 elements + snapshot → **cheap model** emits **one** action (verb set) → **risk gate**:
   - read / navigate / scroll / extract → **auto-run**, emit a `skill_step` `TaskRunEvent`.
   - matches `red_lines` or high-risk pattern (submit/pay/post/delete) → emit an `awaiting_confirm` event carrying a **proposal** (same `Proposal` shape as chat); the dock shows the diff card; operator confirms; loop resumes and runs the action.
4. `extract{data}` actions accumulate as `ChannelResult.items`. Loop ends on `done{status,note}` (validated against `terminal_conditions` / `false_terminal_states`) or a max-step cap.
5. Items flow through the **normal** normalize → store → dedup → AI → notify pipeline. The run also emits a `journey_trace_v1` trace (assembled from the step events + outcome) and a self-eval summary, appended to `skills.evidence`.
6. If the run failed (self-eval says outcome ≠ terminal conditions), the operator can click **"重蒸技能 / re-distill"** in the dock → feeds the failing trace(s) + current `SKILL.md` back into `distill_trace` → `skills.version++`, `evidence` appended, new `SKILL.md`.

### Flow B — Headless / scheduled run
1. A `CronSchedule` (or manual headless trigger) runs the same `skill` `DataSource` via `run_scheduled_pipeline` → `run_collection_pipeline` → identical loop. There is **no human** at a dock.
2. Auto-run tiers (read/navigate/scroll/extract) proceed unattended; `extract` records accumulate.
3. The moment a confirm-required action is proposed:
   - if `source.channel_config.auto_confirm == true` **or** the skill has **no** high-risk action → the action runs; the run completes headless.
   - otherwise → the loop **aborts**: emits an `awaiting_confirm` `TaskRunEvent` (with the proposed action), returns a `ChannelResult` that drives the run to status **`awaiting_confirm`**, and stops. (Resume is v2.)
4. Whatever was extracted before the abort still flows through normalize/store. The trace + self-eval are still emitted (outcome = "paused: awaiting_confirm").

---

## 4. Architecture — the 8 decisions, concrete to this codebase

> ADR-0003 is the authority. This section pins each decision to files/symbols so an implementer doesn't have to re-derive them.

**D1 — Placement: center-side, Playwright over CDP.**
The loop runs in the backend process. Acquire a CDP endpoint via `backend/browser_pool.py::get_pool().acquire(endpoint=...)` (already done in the skeleton), then drive it with **Playwright** `playwright.async_api.async_playwright().chromium.connect_over_cdp(cdp_endpoint)`. **Playwright is a NEW backend dependency** (add to `pyproject.toml`; `playwright install chromium` for the driver). Wrap the connection in a small `SkillPage` helper (new module under `backend/skills/`) exposing `goto`, `query interactive`, `click(ref)`, `type(ref,text,submit)`, `select(ref,value)`, `scroll(dir)`, `inner_text/extract`. Local + LAN endpoints only. `connect_over_cdp` attaches to the existing browser context, so a logged-in page (e.g. site cookies already present in that Chrome) is reused — same substrate the opencli channel relies on.

**D2 — Perception: injected-JS interactive snapshot.**
Each step injects JS (via `page.evaluate`) that walks visible `a, button, input, select, [role]`, assigns a sequential `data-skill-ref="N"` to each, and returns a compact `[{ref, role, name, value}]` list. No raw DOM, no screenshots (cheap model is text-only, ~32k ctx). The snapshot is **token-bounded / paginated** (cap element count; `scroll` to reach more). This lives in the perception module (new, under `backend/skills/`).

**D3 — Action space: small fixed verb set, ref-addressed.**
Exactly: `navigate{url}`, `click{ref}`, `type{ref,text,submit?}`, `select{ref,value}`, `scroll{dir}`, `extract{data}` (emits a record into `ChannelResult.items`), `done{status,note}`. **No `evaluate(js)`** exposed to the model. One tool call per step. Tool-calling reuses the chat harness pattern from `backend/api/v1/chat.py`: OpenAI `tool_calls` for normal models; the Qwen XML variant (`_is_xml_tool_model`, `_parse_tool_use`, `<tool_use name=...>`) for `qwable`-style models. The verb set is defined as its own `TOOLS`-shaped schema + `WRITE_TOOLS`-style risk set for the skill loop (do **not** overload the chat-console tools).

**D4 — Guardrail: risk-tiered confirm.**
`reads / navigate / scroll / extract` → **auto-run**. An action whose target/verb matches the skill's `red_lines` **or** a configured high-risk pattern (`submit | pay | post | delete`, applied to the verb + element name/role) → **confirm required**. Reuse the chat `Proposal{tool,args,summary,diff}` shape and the dock's confirm contract. `source.channel_config.auto_confirm == true` bypasses (default **off**). The risk classifier is a small pure function (testable in isolation).

**D5 — Run integration: stay in the spine, no `collect()` contract change.**
A `skill` `DataSource` flows through `run_pipeline → collector.collect → SkillChannel.collect`. `run_pipeline` must pass `run_id` into the channel via `parameters` (it already injects things into `parameters` for `opencli`; add a `skill` branch that sets `parameters["run_id"] = run_id` and, if a binding exists, `parameters["chrome_endpoint"]`). **`AbstractChannel.collect(config, parameters)` signature is unchanged.** The loop emits per-step events through the module-level `events.emit(run_id, ...)`. `extract` results return as `ChannelResult.items` and go through the **normal** `normalizer → storer` (dedup/AI/notify) path. A new paused run status **`awaiting_confirm`** is added (see §5). Cheap-executor provider config arrives the same way distill's does — from a `ModelProvider` via `provider_from_model`, surfaced into `config["provider"]` / `parameters`.

**D6 — Loop control from the 9 elements.**
Each step's system prompt carries the SKILL.md `procedure`, `milestones`, `terminal_conditions`, `false_terminal_states`, `red_lines` (from `Skill.elements` / `skill_md`) **plus** the current snapshot. `false_terminal_states` are listed explicitly so the model doesn't `done` prematurely; `terminal_conditions` validate a claimed `done`; the loop ends on `done{}` or a max-step cap (config, e.g. `max_steps`, default ~20).

**D7 — Self-eval & correction: unified re-distill.**
Every execute run assembles a `journey_trace_v1`-shaped trace from its step events + outcome (so the human record leg and the correct leg feed the **same** `distill_trace`). Self-eval compares outcome against `terminal_conditions`/`milestones` and writes a result into `skills.evidence`. On **human trigger** (v1) — the dock "重蒸技能" button — the failing trace(s) + current `SKILL.md` are passed to `distill_trace` → `skills.version++`, `evidence` appended, `skill_md`/`elements` replaced. **Correction is re-distillation, never a hand-patch.** (Auto-trigger after N fails = v2.)

**D8 — v1 scope: interactive-first.**
v1 ships dock-driven interactive execution with **synchronous** confirm (reuse chat proposal→confirm). Headless/scheduled runs abort with `awaiting_confirm` + event on a confirm-required action; risk-free or `auto_confirm` skills run fully headless. Cross-process pause/resume + auto re-distill = v2. v1 re-distill = human-triggered from the dock. Record leg = separate TODO; execute loop only fixes the `journey_trace_v1` shape.

### `journey_trace_v1` shape (the contract both legs share)
The distiller (`distill_trace`) already reads: `trace["summary"]["domain"]`, `trace["label"]`, `trace["trace_id"]`. v1 must emit **at least** these, plus a `steps[]` array (one entry per loop step: action, ref/target, snapshot digest, result, timing) and an `outcome` block (success/failed/paused, milestones hit, terminal check). Define the schema once in a shared module (e.g. `backend/skills/trace.py`) so the future record leg targets the same shape. Keep it forward-compatible (extra keys ignored by the distiller).

---

## 5. Data model changes

The `Skill` table is **already** present (model + migration) and needs **no schema change** for v1 (`version`, `evidence`, `status`, `enabled` already exist; re-distill mutates rows, not columns).

### New: `awaiting_confirm` run status
- `TaskRun.status` (in `backend/models/task.py`) is a free-text `String(50)` — no DB enum to alter — so **no Alembic column change is strictly required** to store the value. However, v1 **must**:
  1. Treat `awaiting_confirm` as a recognized terminal-ish status in `runner.run_collection_pipeline` Phase 4 (do **not** force it to `completed`/`failed` when the pipeline reports a paused outcome).
  2. Surface it wherever run statuses are enumerated/filtered (run-list/run-detail API + the dock/run UI legend).
- `PipelineResult` / `ChannelResult` need a way to signal "paused, awaiting confirm" up to the runner so Phase 4 sets `run.status = "awaiting_confirm"` instead of `completed`. Carry it in `ChannelResult.metadata` (e.g. `metadata["awaiting_confirm"] = True` + the proposed action) → `PipelineResult.metadata` → runner.
- **Migration:** add a **data/comment migration** `n4i5j6k7l8m9_add_awaiting_confirm_run_status` with `down_revision = 'm3h4i5j6k7l8'` (current head). Even though `status` is free-text, ship the migration as the **anchor** for this feature (and to update any check-constraint/comment the project later adds, and to keep the chain explicit). Its `upgrade()` may be a no-op/comment if no column changes — but it documents the new status and keeps Alembic head ownership clear for the feature branch.

### `auto_confirm` source flag
Stored in `DataSource.channel_config` JSON (`channel_config["auto_confirm"]: bool`, default `false`) — **no schema change**. `SkillChannel.validate_config` should accept it; the risk gate reads it from `config`.

---

## 6. Integration points (exact functions)

| Concern | Exact site | Change |
|---|---|---|
| Pass `run_id` + endpoint into the channel | `backend/pipeline/pipeline.py::run_pipeline` (pre-step + collect block, currently special-casing `channel_type=="opencli"`) | Add a `channel_type=="skill"` branch: set `params["run_id"]=run_id`; resolve `chrome_endpoint` from a browser binding if present (reuse `browser_service.get_binding_by_site`-style logic or a skill-specific binding). Build a `skill`-flavored collect event detail. |
| Dispatch (unchanged) | `backend/pipeline/collector.py::collect` | No change — already `get_channel("skill").collect(config, params)`. |
| Per-step events | `backend/pipeline/events.py::emit(run_id, step, ...)` | Reuse as-is. New `step` values: `skill_perceive`, `skill_step`, `awaiting_confirm`, `skill_extract`, `skill_done`, `self_eval`. (`TaskRunEvent.step` is free-text `String(50)`.) |
| Extract → records | `backend/channels/base.py::ChannelResult.ok(items, **metadata)` | `extract` actions append to `items`; loop returns `ChannelResult.ok(items, channel="skill", executed=True, awaiting_confirm=<bool>, trace=<journey_trace_v1>)`. Items then hit `normalizer.normalize_items` → `storer.store_records` unchanged. |
| Paused status up the stack | `backend/pipeline/pipeline.py::run_pipeline` return + `backend/pipeline/runner.py::run_collection_pipeline` Phase 4 | Propagate `metadata["awaiting_confirm"]`; in Phase 4 set `run.status="awaiting_confirm"` (not `completed`) when set. |
| Cheap executor provider | `backend/skills/distill.py::provider_from_model` (pattern) + `runner` provider resolution (lines ~94–141) | Resolve the executor model the same way; surface into `config["provider"]`. May differ from the distill model. |
| Tool-calling harness | `backend/api/v1/chat.py` — `_is_xml_tool_model`, `_parse_tool_use`, OpenAI `tool_calls` loop | Reuse the *pattern* (extract a tiny shared helper if convenient); define a **separate** skill verb schema + risk set. Do not reuse the chat-console `TOOLS`. |
| Confirm contract / dock | `backend/api/v1/chat.py::Proposal` + `/chat/confirm`; `frontend/src/labs/topology/AgentDock.tsx` | Interactive confirm reuses the `Proposal{tool,args,summary,diff}` shape and the dock's diff-card → confirm flow. The "重蒸技能" trigger is a new dock action that calls a new re-distill endpoint. |
| Re-distill | `backend/skills/distill.py::distill_trace` + `to_skill_fields` | New service/endpoint loads the `Skill` + failing trace(s), calls `distill_trace(trace, provider)`, bumps `version`, appends `evidence`, writes `skill_md`/`elements`. |
| Browser driving | `backend/browser_pool.py::get_pool().acquire` (done) + **new** Playwright wrapper | `connect_over_cdp(cdp_endpoint)`; new dep. |

---

## 7. Risks & open items

- **Record leg is a separate TODO.** v1 fixes only the `journey_trace_v1` *shape*. Until the record leg exists, the **only** trace source is execute runs (correct leg). Initial `SKILL.md` cards must be seeded another way (inline `skill_md`, or a hand-written trace) — acceptable for v1 since the channel already accepts inline `config["skill_md"]`.
- **Windows Playwright install.** Dev/CI is Windows (`win32`). Playwright needs `playwright install chromium` and the matching driver; document this in `TESTING.md` and gate the e2e test behind the existing `live` pytest marker (`-m "not live"` deselects it) so the default `--cov-fail-under=80` suite doesn't require a browser. The loop *connects over CDP* to an already-running Chrome (from `browser_pool`), so the bundled Chromium is only needed for the driver, not necessarily a second browser.
- **Cross-process resume = v2.** A headless run that hits a confirm-required action **cannot** be resumed in v1; it ends at `awaiting_confirm`. Operators must re-run interactively (or set `auto_confirm`) to get past it. Make this explicit in the dock/run UI.
- **Auto re-distill = v2.** v1 computes & logs self-eval to `evidence` but only **human**-triggers re-distill. Don't wire an automatic "N fails → re-distill" loop.
- **Risk classifier false-negatives are the danger.** A high-risk action mis-classified as auto-run is a silent write. Keep the classifier conservative (default to confirm on ambiguity), unit-test it hard, and keep `red_lines` authoritative over the generic pattern.
- **Token blow-up on huge pages.** Snapshot must be bounded/paginated; an unbounded interactive list will exceed the cheap model's ~32k context. Cap element count and rely on `scroll`.
- **`connect_over_cdp` reuses live state.** Driving a shared logged-in Chrome means the loop can see/affect real sessions — another reason the write-gate is a hard line, and why v1 is local/LAN only.
- **`step` / `status` are free-text.** Convenient (no enum migrations) but means typos won't be caught by the DB; centralize the string constants.

---

## 8. v1 scope cut-line

**In v1:**
- Playwright dep + `connect_over_cdp` page wrapper + injected-JS perception snapshot.
- Fixed verb set executor (ref resolution → Playwright ops), one action/step.
- Cheap-model step loop reusing the chat tool-calling harness pattern (OpenAI + Qwen XML), driven by the 9 elements + snapshot, ending on `done`/cap.
- Risk-tiered confirm gate + `auto_confirm` + `awaiting_confirm` run status + anchor migration.
- Run integration: `run_id` via `parameters`, per-step `events.emit`, `extract → ChannelResult.items` → normal store, paused status propagation, `SkillChannel.collect` fully wired.
- `journey_trace_v1` emission from a run + human-triggered re-distill (service/endpoint + dock "重蒸技能" button) + self-eval logged to `evidence`.
- e2e against a real local Chrome (behind `live` marker).

**Out (v2+):** record leg ("录这站"); cross-process pause/resume; auto-triggered re-distill after N fails; NAT/edge-node execution via `agent_server`; vision/raw-DOM/screenshot perception; `evaluate(js)`.

---

## 9. v1 issue breakdown (build order)

Each issue is implementable in a fresh session from this PRD + ADR-0003 alone. IDs are build order; `depends_on` is explicit.

1. **01 — Playwright dep + CDP page wrapper + perception snapshot** (`backend/skills/page.py`, `backend/skills/perception.py`, `pyproject.toml`, `TESTING.md`). No deps.
2. **02 — Action executor: verb set → Playwright ops, ref resolution** (`backend/skills/actions.py`). Depends 01.
3. **03 — Cheap-model step loop + 9-element prompt + tool-calling harness** (`backend/skills/loop.py`, `backend/skills/prompt.py`). Depends 01, 02.
4. **04 — Risk-tiered confirm gate + auto_confirm + awaiting_confirm status + migration** (`backend/skills/risk.py`, migration, `backend/models/task.py` usage, `backend/channels/base.py` metadata). Depends 03 (gate sits in the loop; can be developed against the loop's action stream).
5. **05 — Run integration: wire SkillChannel.collect into the spine** (`backend/channels/skill_channel.py`, `backend/pipeline/pipeline.py`, `backend/pipeline/runner.py`). Depends 03, 04.
6. **06 — journey_trace_v1 emission + re-distill correction path + dock "重蒸技能"** (`backend/skills/trace.py`, `backend/skills/correction.py`, new API endpoint, `frontend/src/labs/topology/AgentDock.tsx`). Depends 05.
7. **07 — e2e against a real local Chrome (live marker)** (`tests/skills/`). Depends 05 (06 optional for the trace assertion).

See the structured output for full per-issue files / acceptance criteria / dependencies.
