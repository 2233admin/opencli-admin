# 03 Cheap-model step loop with 9-element prompt and tool-calling harness

> Self-contained issue. Source of truth: `docs/adr/0003-skill-execute-loop-architecture.md` (decisions **D1–D8**) and `docs/skills-execute-loop-PRD.md` (§4, §6, issue **03** in §9). You should be able to implement this in a fresh session from this file alone. Repo root: `D:/projects/opencli-admin`.

## Context

This wires the **perceive → propose → act** loop (ADR **D6**, "Loop control from the 9 elements"; D3 "Action space"; D5 "Run integration") that lets a *cheap* text model (e.g. `qwen3:4b`, ~32k ctx, no vision) drive a real Chrome page **one action per step**. Each step builds a system prompt from the SKILL.md 9 elements (`procedure`, `milestones`, `terminal_conditions`, `false_terminal_states`, `red_lines`) plus the current interactive snapshot (D2), asks the model for **exactly one** action using the tool-calling pattern already proven in the agent dock (`backend/api/v1/chat.py` — OpenAI `tool_calls` for normal models, the Qwen XML `<tool_use>` variant for `qwable`-style models), validates the action against issue **02**'s schema, executes it (issue **02**'s executor over issue **01**'s `SkillPage`), and loops until `done{}` (validated against `terminal_conditions` / `false_terminal_states`) or a `max_steps` cap. This issue is the **brain** of the loop; it stops short of the risk/confirm gate (issue 04) so every action auto-runs and the loop is independently testable with a stubbed model and a fake page.

## Scope

**In scope**
- `backend/skills/loop.py` — the step loop: per-step perceive → prompt → model call → parse → execute → feed back; `max_steps` cap; `done{}` validation against `terminal_conditions` / `false_terminal_states`; returns ordered step records + accumulated extract records.
- `backend/skills/prompt.py` — (a) build the step **system prompt** from the 9 elements (`Skill.elements` / inline `skill_md`) + the current `[{ref,role,name,value}]` snapshot; (b) define the **skill verb tool schema** (OpenAI function-shaped, the 7 verbs) **plus** a parallel text description for the XML-tool path — a **separate object** from `chat.py`'s `TOOLS`.
- Reuse (do not fork) the tool-call parsing *pattern* from `backend/api/v1/chat.py` (`_is_xml_tool_model`, `_parse_tool_use`, OpenAI `tool_calls`) to normalize both shapes into one action.
- `tests/skills/test_loop.py` — end-to-end loop test with a stubbed model (scripted tool calls) + a fake `SkillPage`, runnable under `-m "not live"`.

**Out of scope** (deferred — do **not** build here)
- The **risk / confirm gate** (issue **04**): here **every** action auto-runs. No `awaiting_confirm`, no `Proposal`, no `auto_confirm` branching.
- **Run / event integration & `ChannelResult` assembly** (issue **05**): no `events.emit`, no `SkillChannel.collect` wiring, no `parameters["run_id"]`. The loop returns plain Python data; the caller (issue 05) maps it to events + `ChannelResult`.
- **`journey_trace_v1` emission & re-distill** (issue **06**): the loop returns step records the trace builder will later consume, but it does **not** assemble the trace.
- The risk classifier itself, `awaiting_confirm` run status, the anchor migration — all issue 04.
- Playwright dependency, CDP `SkillPage`, perception snapshot (issue **01**); action executor + ref resolution (issue **02**). This issue **consumes** their interfaces.
- v2: cross-process pause/resume, auto-triggered re-distill, NAT/edge execution, vision/raw-DOM/screenshots, `evaluate(js)`.

**Hard rule:** Must **NOT** reuse `chat.py`'s `TOOLS` / `WRITE_TOOLS`. The skill loop defines its **own** verb schema and risk-marking. (PRD §4 D3: "do **not** overload the chat-console tools".)

## Depends on

- **01** — Playwright dep + CDP page wrapper + perception snapshot (`backend/skills/page.py`, `backend/skills/perception.py`). Provides the `SkillPage` object the loop perceives/acts through, and the `[{ref,role,name,value}]` snapshot shape.
- **02** — Action executor: verb set → Playwright ops, ref resolution (`backend/skills/actions.py`). Provides the action **schema/validator** and the `execute(action, page)`-style entry the loop calls per step.

> Implementer note: 01 and 02 may not be merged yet when you start. **Depend on their interfaces, not their internals.** Define the loop against a narrow typed boundary (a `SkillPage` Protocol for perceive/act, and a `validate_action` + `execute_action` import from `backend.skills.actions`). If the exact names from 01/02 differ at merge time, adapt the import/adapter only — the loop logic stays. Mirror the names the PRD uses (`SkillPage`, `actions.py`) and the snapshot keys (`ref, role, name, value`) so the seam lines up. The test uses a **fake** `SkillPage` and **scripted** model, so it does not require 01/02 to be present to pass.

## Files

| File | Create/Edit | Purpose (one line) |
|---|---|---|
| `backend/skills/prompt.py` | **create** | Build the 9-element + snapshot system prompt; define the skill verb tool schema (OpenAI-shaped) + XML-path text — separate from `chat.py` `TOOLS`. |
| `backend/skills/loop.py` | **create** | The perceive→propose→act step loop: one action/step, normalize OpenAI + XML tool calls, execute, feed back, terminate on `done{}` or `max_steps`; return step records + extracts. |
| `tests/skills/test_loop.py` | **create** | End-to-end loop test: stubbed model (scripted tool calls) + fake `SkillPage`; asserts step ordering, done-validation, cap. Passes under `-m "not live"`. |
| `tests/skills/__init__.py` | **create if missing** | Make `tests/skills` a package (the dir does not exist yet). |

> Note: `backend/skills/` currently contains only `distill.py` + `__init__.py`. `tests/skills/` does **not** exist yet — creating `tests/skills/test_loop.py` (and `__init__.py`) creates the directory. `pyproject.toml` already sets `testpaths = ["tests"]`, `asyncio_mode = "auto"`, and the `live` marker; **no pyproject edit is needed** for this issue.

## Implementation notes

Tie everything to existing symbols. Reuse the spine; honor the fixed decisions.

### A. `prompt.py` — system prompt from the 9 elements + snapshot

- **Inputs.** Accept the 9-element source two ways (Skill rows store both): a structured `elements: dict` (the `Skill.elements` JSON — keys per `backend/skills/distill.py::ELEMENT_KEYS`: `preconditions, procedure, milestones, terminal_conditions, false_terminal_states, recovery_policies, anti_drift_boundaries, red_lines`) **and/or** the raw `skill_md: str`. Write a small `build_system_prompt(*, skill_md: str | None, elements: dict | None, snapshot: list[dict], task: str | None, step_index: int, max_steps: int) -> str`.
  - The prompt **must** explicitly include, with clear labels: `procedure`, `milestones`, `terminal_conditions`, `false_terminal_states`, `red_lines`. Pull them from `elements` when present; otherwise fall back to embedding `skill_md` verbatim (it already contains them). Prefer structured `elements` so each section is addressable; degrade gracefully if a key is missing/empty.
  - State the loop contract in the prompt: "emit **exactly one** tool call per step"; "call `done` only when a `terminal_condition` is met"; "`false_terminal_states` are traps — do **not** `done` in those"; "address elements by `ref` from the snapshot below"; "no JS / no actions outside the verb set".
  - Render the snapshot compactly as the `[{ref, role, name, value}]` list (one line per element, e.g. `#<ref> <role> "<name>" = <value>`). Keep it token-bounded — the snapshot is already capped by issue 01's perception; do not re-expand it.
- **Skill verb tool schema (the core deliverable of this file).** Define a module-level `SKILL_TOOLS: list[dict]` in **OpenAI function-calling shape** (same shape as `chat.py::TOOLS`, i.e. `{"type":"function","function":{"name","description","parameters":{json-schema}}}`) covering the **7 verbs** from ADR D3 / PRD §4:
  - `navigate{url}` · `click{ref}` · `type{ref,text,submit?}` · `select{ref,value}` · `scroll{dir}` (enum e.g. `up|down`) · `extract{data}` (free-form object/record) · `done{status,note}` (`status` e.g. `success|failed|paused`).
  - Keep this schema **canonically aligned** with issue 02's action validator — the model proposes these verbs/args, 02 validates and executes them. If 02 exposes a schema/enum, import and reuse it rather than re-declaring divergent JSON.
  - Provide a parallel `SKILL_TOOLS_TEXT: str` describing the same 7 verbs for the **XML-tool path** (mirrors `chat.py::XML_TOOL_TEXT`), instructing the model to emit `<tool_use name="verb" id="...">{json args}</tool_use>` and nothing else.
  - Optionally expose a `SKILL_WRITE_VERBS` set (e.g. `{"click","type","select"}` — submit-ish writes) so **issue 04** can hang the risk gate off it. Defining the set here is fine; **using** it to gate is out of scope. Do not import `chat.py::WRITE_TOOLS`.

### B. `loop.py` — the step loop

- **Signature (suggested):** `async def run_skill_loop(*, page: SkillPage, model_call, skill_md=None, elements=None, task=None, max_steps=20) -> LoopResult`. Keep it **pure of the spine**: no `events.emit`, no DB, no `ChannelResult`. Inject the model via a callable so the test can script it (see below).
  - `SkillPage` boundary: define a `typing.Protocol` (or import from issue 01 once present) covering what the loop needs — `await page.snapshot() -> list[{ref,role,name,value}]` (perceive) and whatever 01 exposes for current URL/title used in step records. **Actions go through issue 02's executor**, not directly on the page, so the loop stays thin.
  - `model_call` boundary: an `async (messages: list[dict], *, tools, model, xml: bool) -> RawModelReply` callable. In production this wraps the provider client. **Do not** hardcode a provider here — the executor model config arrives the same way `distill`'s does, via `backend/skills/distill.py::provider_from_model(mp)` (returns `{base_url, model, api_key, api_style, timeout}`). The loop receives the resolved `model` name + a `model_call` already bound to that provider; provider **resolution** is the caller's job (issue 05). Use `_is_xml_tool_model(model)` (reused from `chat.py`) to decide the OpenAI vs XML path.
- **Per-step algorithm:**
  1. `snapshot = await page.snapshot()` (perceive — D2).
  2. `system = build_system_prompt(...)`; assemble `messages` (system + a running transcript of prior `action -> result` turns so the model has context; keep it bounded).
  3. Call the model for **one** action:
     - Normal model: `tools=SKILL_TOOLS, tool_choice="auto"`; read `response.choices[0].message.tool_calls`. Reuse the OpenAI `tool_calls` reading pattern from `chat.py::chat`.
     - XML model (`_is_xml_tool_model(model)` true): put `SKILL_TOOLS_TEXT` in the system prompt; parse `<tool_use>` from message content with the **same regex/parser pattern** as `chat.py` (`_parse_tool_use`, `_TOOL_USE_RE`, strip `<think>` via `_THINK_RE`). Reuse `_safe_json` for arg parsing.
     - **Normalize both into one `Action`** = `(verb: str, args: dict)`. If the model returns >1 tool call, take the **first** and ignore the rest (one action/step is the contract; record that you truncated).
  4. **Validate** the action via issue 02 (`actions.validate_action(action)` or equivalent). On invalid: record an error step, feed the validation error back to the model as the step result, and continue (do not crash). This keeps a confused cheap model recoverable.
  5. If `verb == "done"`: run **done-validation** (see C) and **terminate** — do not execute it as a page op.
  6. Otherwise **execute** via issue 02 (`await actions.execute_action(action, page)` or equivalent). Capture its result/error.
  7. If `verb == "extract"`: append the extracted payload to an `extracts: list[dict]` accumulator (this is what issue 05 will surface as `ChannelResult.items`).
  8. Append a **step record** (ordered) — at least `{index, verb, args, ref/target, snapshot_digest, result, error, elapsed_ms}` — and feed `action + result` back into the transcript for the next step.
  9. Loop until `done` or `index == max_steps`.
- **Termination & return.**
  - **`max_steps`**: default **`MAX_STEPS = 20`** as a module constant (document it; PRD §4 D6 says "~20"). When hit without `done`, terminate with outcome `capped`.
  - **`done{}` validation (C):** when the model emits `done{status,note}`, check the claimed completion against the 9 elements: it is only an **accepted** done if it does **not** match any `false_terminal_states` entry and (best-effort) is consistent with `terminal_conditions`. Since the executor is a cheap model and conditions are NL, keep this a **conservative string/heuristic check** (e.g. flag a done whose `note`/current snapshot trips a `false_terminal_states` phrase → mark `done_rejected`, feed the rejection back, and continue the loop instead of stopping). Record `terminal_check: accepted|rejected` on the done step. Do **not** silently trust `done`.
  - **Return** a `LoopResult` (dataclass) with: `steps: list[StepRecord]` (ordered), `extracts: list[dict]`, `outcome: str` (`done_success | done_failed | capped | error`), and a small `summary` (e.g. milestones-hit best-effort, final status, step count). This is the raw material issues 05 (`ChannelResult`) and 06 (`journey_trace_v1`) consume — shape it forward-compatibly (plain dict-able).
- **Reuse, don't fork.** Import the parsing helpers from `backend.api.v1.chat` (`_is_xml_tool_model`, `_parse_tool_use`, `_safe_json`, and the `_TOOL_USE_RE`/`_THINK_RE` if needed). If a clean import is awkward (they're underscore-private), it is acceptable to lift a *tiny* shared helper into a small module and import it from both — but the **default is reuse**; do not duplicate the regex logic. Do not change `chat.py`'s behavior.
- **Do not touch fixed seams.** Do **not** change `AbstractChannel.collect(config, parameters)` (`backend/channels/base.py`) — that is issue 05's integration surface and its signature is frozen (ADR D5). Do **not** call `browser_pool.acquire` here (issue 05 owns acquisition; the loop receives an already-bound `SkillPage`). Do **not** call `events.emit` here (issue 05).

### C. Symbols you will touch / reuse (quick map)

- Reuse pattern from `backend/api/v1/chat.py`: `TOOLS`-shape (as a template only), `_is_xml_tool_model`, `XML_TOOL_MODELS = ("qwable",)`, `_parse_tool_use`, `_TOOL_USE_RE`, `_THINK_RE`, `_safe_json`, and the OpenAI `tool_calls` loop in `chat()`. **Do not** import/reuse `TOOLS` or `WRITE_TOOLS` as the verb set.
- Reuse from `backend/skills/distill.py`: `provider_from_model(mp)` (provider config shape `{base_url, model, api_key, api_style, timeout}`) — referenced for how the executor model is resolved by the caller; `ELEMENT_KEYS` (the 9-element dict keys).
- Source of the 9 elements: `backend/models/skill.py::Skill.elements` (JSON) + `Skill.skill_md` (Text).
- Consume from issue 01: `SkillPage` (perceive `snapshot()`), snapshot keys `ref, role, name, value`.
- Consume from issue 02: action **schema/validator** + **executor** (`backend/skills/actions.py`).

## Acceptance criteria

Falsifiable. Run from repo root `D:/projects/opencli-admin` unless noted. The default suite enforces `--cov-fail-under=80` (per `pyproject.toml`), so the new code must be exercised by `test_loop.py`.

1. **9-element prompt.** `backend/skills/prompt.py::build_system_prompt(...)` returns a string that, given a `Skill.elements`-shaped dict (or inline `skill_md`) plus a `[{ref,role,name,value}]` snapshot, **contains** `procedure`, `milestones`, `terminal_conditions`, `false_terminal_states`, and `red_lines` content, **and** renders each snapshot element's `ref`. Verifiable:
   ```bash
   python -c "from backend.skills.prompt import build_system_prompt; \
   els={'procedure':['p1'],'milestones':['m1'],'terminal_conditions':['tc1'],'false_terminal_states':['fts1'],'red_lines':['rl1']}; \
   snap=[{'ref':'0','role':'button','name':'Search','value':''}]; \
   s=build_system_prompt(skill_md=None, elements=els, snapshot=snap, task='t', step_index=0, max_steps=20); \
   assert all(k in s for k in ['p1','m1','tc1','fts1','rl1','0','Search']), s; print('OK')"
   ```
2. **Separate verb schema, 7 verbs, two shapes.** `prompt.py` exposes `SKILL_TOOLS` (OpenAI function-shape) covering exactly the 7 verbs `navigate, click, type, select, scroll, extract, done`, **and** a `SKILL_TOOLS_TEXT` string for the XML path; `SKILL_TOOLS` is a **distinct object** from `backend.api.v1.chat.TOOLS`. Verifiable:
   ```bash
   python -c "from backend.skills.prompt import SKILL_TOOLS, SKILL_TOOLS_TEXT; \
   from backend.api.v1.chat import TOOLS as CHAT_TOOLS; \
   names={t['function']['name'] for t in SKILL_TOOLS}; \
   assert names=={'navigate','click','type','select','scroll','extract','done'}, names; \
   assert SKILL_TOOLS is not CHAT_TOOLS and names!={t['function']['name'] for t in CHAT_TOOLS}; \
   assert isinstance(SKILL_TOOLS_TEXT,str) and 'tool_use' in SKILL_TOOLS_TEXT; print('OK')"
   ```
3. **One action/step, both tool-call shapes normalized.** The loop emits **one** action per step and parses **both** OpenAI `tool_calls` and Qwen XML `<tool_use>` into a single normalized `(verb, args)`, feeding the action result + next snapshot back into the next step. Asserted in `test_loop.py` with two scripted models (one returning OpenAI-shaped tool calls, one returning XML content) producing the **same** executed action sequence on the same fake page.
4. **Termination: `done` (validated) and `max_steps` cap.** The loop terminates on `done{}` — and the claimed done is validated against `terminal_conditions` / `false_terminal_states` (a done that trips a `false_terminal_states` phrase is **rejected** and the loop continues, not silently accepted) — **or** on the configurable `max_steps` cap (default `20`, documented as a module constant). It returns an **ordered** list of step records + the accumulated extract records. Asserted in `test_loop.py`: (a) a happy-path script ending in a clean `done` → `outcome` reflects success, steps ordered; (b) a script whose `done` matches a `false_terminal_states` entry → `terminal_check == "rejected"` and the loop does not stop on it; (c) a script that never emits `done` with `max_steps=3` → loop stops after exactly 3 steps with `outcome == "capped"`.
5. **End-to-end test passes under `not live`.**
   ```bash
   pytest tests/skills/test_loop.py -m "not live" -p no:cacheprovider --no-cov -q
   ```
   passes, using a **stubbed model** (scripted tool calls) and a **fake `SkillPage`** (no Playwright, no real Chrome — this issue's test must not require either). The test asserts: step ordering, done-validation (accept + reject paths), and cap behavior. Extract actions in the script accumulate into the returned `extracts` list in order. (`--no-cov` is only to run this file in isolation; the **full** `pytest -m "not live"` run must still meet `--cov-fail-under=80`, so ensure `loop.py`/`prompt.py` are covered.)

### Verifying against a real local Chrome (optional, out of this issue's required tests)

This issue's loop is provider/page-agnostic and its required tests use stubs, so a real browser is **not** needed to land it. The real-Chrome path is exercised end-to-end in issue **07** (behind the `live` marker, `playwright install chromium` per `TESTING.md`). If you want a manual smoke before 05/07 land: with issues 01+02 present and a Chrome reachable via `browser_pool`, construct a real `SkillPage` over a `connect_over_cdp` endpoint, pass a `model_call` bound to a local `qwen3:4b` (Ollama, via `provider_from_model`-shaped config), and run `run_skill_loop(page=..., model_call=..., skill_md=<a tiny inline SKILL.md>, task="...", max_steps=5)` against a benign read-only page; confirm the loop perceives, the model emits single verbs, and it ends on `done`/cap. Keep it read-only (no submit/pay/post/delete) since the **risk gate does not exist yet** in this issue — every action auto-runs.

## Out of scope / non-goals

- **No risk/confirm gate** (issue 04): every action auto-runs here; no `awaiting_confirm`, no `Proposal`, no `auto_confirm`, no high-risk classifier.
- **No run/event/spine integration** (issue 05): no `events.emit`, no `SkillChannel.collect`, no `parameters["run_id"]`/`chrome_endpoint`, no `ChannelResult` assembly, no provider **resolution** (the loop takes an already-bound `model_call`). **Do not** change `AbstractChannel.collect`'s signature.
- **No `journey_trace_v1` / re-distill** (issue 06): the loop returns step records the trace builder will consume; it does not build the trace or call `distill_trace`.
- **No browser/CDP/perception/executor implementation** (issues 01/02): consumed via interfaces only.
- **Do not reuse `chat.py`'s `TOOLS`/`WRITE_TOOLS`** as the verb set — define the skill's own.
- v2 (explicitly not here): cross-process pause/resume, auto-triggered re-distill, NAT/edge execution, vision/raw-DOM/screenshot perception, `evaluate(js)` escape hatch.
