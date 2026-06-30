# 06 journey_trace_v1 emission + re-distill correction path + dock re-distill trigger

> Self-contained build unit. Authority: `docs/adr/0003-skill-execute-loop-architecture.md` (decisions **D5**, **D6**, **D7**, **D8**) and `docs/skills-execute-loop-PRD.md` (§3 Flow A step 5–6 / Flow B step 4, §4 D7 + the `journey_trace_v1` shape block, §6 integration table rows "Extract → records" / "Re-distill" / "Confirm contract / dock"). Read those two before starting; everything you need to implement this issue is pinned below.

## Context

This issue closes the **self-eval / correction loop** (ADR-0003 **D7**) on top of the already-wired execute run from issue **05**. After 05, a `skill` `DataSource` runs end-to-end through the spine (`run_pipeline → collector.collect → SkillChannel.collect`), emits per-step `TaskRunEvent`s, and returns extracted items. What is still missing is the *feedback* leg: every run must assemble a `journey_trace_v1`-shaped trace from its step events + outcome so that the future human **record** leg and this **correct** leg feed the **same** distiller (`backend/skills/distill.py::distill_trace`, which already reads `trace["summary"]["domain"]`, `trace["label"]`, `trace["trace_id"]`); compute a self-eval (outcome vs the skill's `terminal_conditions`/`milestones`) appended to `skills.evidence`; and let a human re-distill a failing skill from the dock. Per **D7**, **correction is re-distillation, never a hand-patch** — re-distill bumps `version`, appends `evidence`, and replaces `skill_md`/`elements` from `to_skill_fields`. Per **D8**, v1 re-distill is **human-triggered only**; auto-trigger after N consecutive fails is v2.

## Scope

**In scope**
- `backend/skills/trace.py` — define the `journey_trace_v1` schema **once** in a shared module (so the record leg and the correct leg target the same shape), plus `assemble_trace(step_events, outcome, skill=...)` and `self_eval(outcome, skill)`.
- `backend/skills/correction.py` — `re_distill(...)` service: load `Skill` + failing trace(s) + current `skill_md` → call `distill_trace` → `version += 1`, append `evidence`, replace `skill_md`/`elements` from `to_skill_fields`. No hand-patching of fields.
- Wire trace assembly + self-eval into the execute run so **every** run produces a `journey_trace_v1` (surfaced on `ChannelResult.metadata["trace"]`) and a self-eval appended to `skills.evidence`.
- `backend/api/v1/skills.py` (NEW file) + register its router in `backend/api/v1/__init__.py` — an authenticated endpoint that triggers re-distill for a given `skill_id` + trace and returns the new version.
- `frontend/src/labs/topology/AgentDock.tsx` — a `重蒸技能` action that calls the new endpoint, reusing the existing proposal/confirm-style synchronous flow.
- `tests/skills/test_correction.py` (+ `tests/skills/__init__.py`) — re-distill unit tests with `distill_trace` stubbed, green under `-m "not live"`.

**Out of scope (deferred)**
- **Auto-triggered re-distill after N consecutive fails** — explicitly **v2** (ADR-0003 D8; PRD §1 non-goals). Do not wire any automatic "N fails → re-distill" policy. v1 only *computes and logs* the self-eval signal.
- **The human record leg ("录这站")** that produces the *first* `journey_trace_v1` from a demonstration — separate TODO (PRD §1, §7). This issue only fixes the trace **shape** both legs share and produces it from execute runs.
- **Cross-process pause / resume** of an `awaiting_confirm` run — v2 (owned by issue 05 for the status itself; resume is v2).
- Everything else already owned by earlier issues: Playwright/page wrapper (01), action executor (02), step loop + prompt (03), risk gate + `awaiting_confirm` status + migration (04), spine wiring of `SkillChannel.collect` (05).

## Depends on

**05** — Run integration: `SkillChannel.collect` wired into the spine (`backend/channels/skill_channel.py`, `backend/pipeline/pipeline.py`, `backend/pipeline/runner.py`). This issue assembles the trace from the step events 03/05 already emit via `events.emit(run_id, ...)`, and returns it on the `ChannelResult` 05 already produces. (Transitively: 01–04.)

## Files

| File | Create/Edit | Purpose (one line) |
|---|---|---|
| `backend/skills/trace.py` | **Create** | Define `journey_trace_v1` shape once + `assemble_trace(step_events, outcome, skill)` + `self_eval(outcome, skill)`; forward-compatible with `distill_trace`. |
| `backend/skills/correction.py` | **Create** | `re_distill(session, skill, traces, provider)` — load → `distill_trace` → version++/evidence-append/replace `skill_md`+`elements` via `to_skill_fields`. |
| `backend/api/v1/skills.py` | **Create** | `POST /api/v1/skills/{skill_id}/redistill` (auth) → calls `correction.re_distill`, returns new `version`; plus a thin `GET` for listing skills if convenient for the dock. |
| `backend/api/v1/__init__.py` | **Edit** | Import `skills` and `v1_router.include_router(skills.router)` (it is **not** registered today). |
| `backend/channels/skill_channel.py` | **Edit** | After the loop, call `assemble_trace(...)` + `self_eval(...)`, append self-eval to `skills.evidence`, return trace on `ChannelResult.metadata["trace"]`. |
| `frontend/src/labs/topology/AgentDock.tsx` | **Edit** | Add a `重蒸技能` action that POSTs to the redistill endpoint via the existing proposal/confirm-style flow; toast the new version. |
| `tests/skills/test_correction.py` | **Create** | Assert re-distill bumps `version` by exactly 1, appends one `evidence` entry, replaces `skill_md`/`elements` (with `distill_trace` stubbed). |
| `tests/skills/__init__.py` | **Create** | Make `tests/skills` a package (dir does not exist yet — only `tests/unit`, `tests/integration`). |

## Implementation notes

These are tied to the real symbols in this repo (verified against the current tree). Honor the fixed decisions: **do NOT change `AbstractChannel.collect(config, parameters)`**, reuse the spine, reuse the chat proposal/confirm contract.

### 1. `backend/skills/trace.py` — the shared `journey_trace_v1` shape (D6, D7)

`distill_trace` (in `backend/skills/distill.py`) today reads exactly these keys, so the shape **must** include them unchanged:
- `trace["summary"]["domain"]` (→ skill domain; falls back to `"unknown"`)
- `trace["label"]` (→ capability slug fallback)
- `trace["trace_id"]` (→ `source_trace`)

Define a single builder so both legs target the same shape. Suggested API:

```python
TRACE_SCHEMA = "journey_trace_v1"

def assemble_trace(
    step_events: list[dict],   # one dict per loop step (from the run's step stream)
    outcome: dict,             # {"status": "success|failed|paused", "milestones_hit": [...], "terminal_check": ...}
    *,
    domain: str,
    label: str,
    trace_id: str,
    extra: dict | None = None,
) -> dict:
    return {
        "schema": TRACE_SCHEMA,
        "trace_id": trace_id,
        "label": label,
        "summary": {"domain": domain, **(extra or {})},
        "steps": step_events,     # at least one entry per loop step
        "outcome": outcome,       # success/failed/paused, milestones hit, terminal check
    }
```

Requirements (acceptance #1): at least `summary.domain`, `label`, `trace_id`, a `steps[]` array (one entry per loop step — each carrying action verb, ref/target, a snapshot digest, result, timing), and an `outcome` block. Keep it **forward-compatible**: `distill_trace` ignores unknown keys, so adding `schema`/`steps`/`outcome` does not break it. Add a doctest or unit assertion that a trace from `assemble_trace` survives a round trip through `distill_trace` (the distiller only needs the 3 keys above).

`self_eval(outcome, skill)` is a small pure function comparing the run outcome against the skill's `terminal_conditions` and `milestones` (read from `skill.elements` — keys per `distill.ELEMENT_KEYS`: `terminal_conditions`, `milestones`). Return e.g. `{"event": "executed", "passed": bool, "milestones_hit": [...], "terminal_met": bool, "outcome": "...", "trace_id": "...", "at": <iso8601>}`. This dict is what gets appended to `skills.evidence` (a JSON list on the model, default `list`).

### 2. Assemble + self-eval inside the run (D5, D7)

The step events already exist: issues 03/05 emit per-step `TaskRunEvent`s through the module-level `backend/pipeline/events.py::emit(run_id, step, message, level, detail, elapsed_ms)` with `step` values like `skill_step`, `skill_extract`, `skill_done` (PRD §6). For trace assembly, the loop should accumulate the same per-step dicts **in memory** as it emits them (don't re-query `TaskRunEvent` rows mid-collect — `emit` is best-effort/fire-and-forget and `collect()` has no DB session; build the `steps[]` list from the loop's own step records and pass it to `assemble_trace`). At loop end (`done` or cap or `awaiting_confirm` abort):
1. build `outcome` (status `success`/`failed`/`paused`, milestones hit, terminal check vs `terminal_conditions`),
2. `trace = assemble_trace(step_records, outcome, domain=..., label=..., trace_id=run_id-or-uuid)`,
3. `ev = self_eval(outcome, skill)` and append it to `skills.evidence` (open a short-lived `AsyncSessionLocal()` session inside `skill_channel` just like `events.emit` does — load the `Skill`, append to its `evidence` list, reassign the attribute so SQLAlchemy detects the JSON mutation, `commit`),
4. return on the existing result: `ChannelResult.ok(items, channel="skill", executed=True, trace=trace, self_eval=ev, awaiting_confirm=<bool>)`. `ChannelResult.ok(items, **metadata)` stores everything in `.metadata`, so the trace lands on `ChannelResult.metadata["trace"]` (acceptance #2). Items still flow through normalize/store unchanged (PRD §6 "Extract → records").

Note on the inline-skill case: `SkillChannel` today accepts inline `config["skill_md"]` with no DB `Skill` row (see `_resolve_skill_md`). When there is no persisted skill (no `skill_id`/`(domain,capability)`), still build the trace and `self_eval` (best-effort), but skip the `evidence` write (nothing to append to). Guard the evidence write behind "a resolvable Skill row exists".

### 3. `backend/skills/correction.py` — re-distill (D7)

`distill.py` gives you everything; do not reimplement extraction. `re_distill` must:
1. load the `Skill` row (by id) and the failing trace(s) — accept already-shaped `journey_trace_v1` dict(s) (caller passes them; the endpoint can accept a trace inline or by reference),
2. resolve the distill provider config the same way the existing distill path does — from a `ModelProvider` via `backend.skills.distill.provider_from_model(mp)` (mirror `runner.run_collection_pipeline` provider resolution: first enabled `ModelProvider` ordered by `created_at`), falling back to `distill._DEFAULT_PROVIDER`,
3. call `spec = await distill_trace(trace, provider)` (if multiple failing traces, distill the most recent / pass them combined — keep v1 simple: one trace),
4. `fields = to_skill_fields(spec)` and write back onto the **existing** row: `skill.version += 1`; `skill.skill_md = fields["skill_md"]`; `skill.elements = fields["elements"]` (reassign for JSON change-tracking); `skill.distill_model = fields["distill_model"]`; `skill.source_trace = fields["source_trace"]`; append one `evidence` entry `{"event": "corrected", "from_version": n, "to_version": n+1, "trace_id": ..., "at": ...}` (reassign `skill.evidence`),
5. `await session.commit()` and return the new version (and updated skill).

Hard rule (acceptance #3): **no field is hand-patched** — `skill_md`/`elements` come **only** from `to_skill_fields(spec)`. The only manual mutations are `version += 1` and the `evidence` append (the closed-loop bookkeeping the model is designed for — see `Skill` docstring).

### 4. API endpoint + registration

`backend/api/v1/skills.py` does **not** exist and is **not** in `backend/api/v1/__init__.py` — create both. Follow the existing router shape (see `backend/api/v1/chat.py` / `sources.py`): `APIRouter(prefix="/skills", tags=["skills"])`, `Depends(get_db)`, return `ApiResponse.ok(...)` from `backend/schemas/common.py`. Endpoint:

```
POST /api/v1/skills/{skill_id}/redistill
body: { "trace": <journey_trace_v1 dict>, ... }  # or a trace reference
-> ApiResponse.ok({"skill_id": ..., "version": <new int>, "domain": ..., "capability": ...})
```

Auth: match how the rest of the API authenticates (acceptance #4 says "authenticated"). Reuse the project's existing auth dependency exactly as the other write endpoints do — do not invent a new scheme; if the other v1 routers take no explicit auth dependency in this codebase, apply the same app-level dependency they rely on so this endpoint is no less protected than `/chat/confirm`. Then register: in `backend/api/v1/__init__.py` add `skills` to the import tuple and `v1_router.include_router(skills.router)`.

### 5. Dock `重蒸技能` action (D7, D8)

`AgentDock.tsx` already has the proposal→confirm primitives: it POSTs to `/chat`, renders a `Proposal{tool,args,summary,diff}` as an amber confirm card, and on confirm POSTs to `/chat/confirm` (see `confirm()` / the proposal card block). Add a `重蒸技能` affordance that:
- is shown when the current context is a failing skill (e.g. `contextNode.kind === "skill"`, or when a run surfaced `self_eval.passed === false`),
- on click, shows the same confirm-card style ("重新蒸馏技能「…」→ version n+1") and on confirm calls `apiClient.post('/skills/{id}/redistill', { trace })` — reusing the synchronous confirm flow, not auto-firing,
- on success `toast.success` with the new version and call `onApplied()` to refresh.

Keep it minimal and consistent with the existing dock styling; the point is reuse of the confirm contract, not a new UI paradigm. Do **not** wire any automatic trigger (D8).

### 6. Do-not-touch / reuse checklist
- `AbstractChannel.collect(config, parameters)` signature — **unchanged** (ADR-0003 D5). Trace + self-eval ride out on `ChannelResult.metadata`.
- Per-step events — reuse `events.emit` (don't add a new event sink). New trace work consumes the loop's own step records.
- Distillation — reuse `distill_trace` / `to_skill_fields` / `provider_from_model` verbatim. Correction = re-distill (D7).
- Proposal/confirm — reuse the `Proposal` shape + dock card (chat.py / AgentDock.tsx). Do not fork a second confirm mechanism.

## Acceptance criteria

Falsifiable. Run backend checks from the repo root (`D:/projects/opencli-admin`).

1. **Shared `journey_trace_v1` shape.** `backend/skills/trace.py` defines the schema with at least `summary.domain`, `label`, `trace_id`, `steps[]` (one entry per loop step), and an `outcome` block, and `assemble_trace(step_events, outcome, ...)` builds it. Forward-compatible with the distiller. Verify:
   ```bash
   python -c "import asyncio,json; from backend.skills.trace import assemble_trace; from backend.skills import distill; \
   t=assemble_trace([{'action':'navigate','target':'x','result':'ok','ms':5}], {'status':'success','milestones_hit':[],'terminal_check':True}, domain='binance', label='funding rates', trace_id='t1'); \
   print('steps' in t and t['summary']['domain']=='binance' and t['label']=='funding rates' and t['trace_id']=='t1' and 'outcome' in t)"
   # prints: True
   ```
   And the distiller reads it unchanged: with `distill.call_llm` monkeypatched to return a fixed JSON, `await distill.distill_trace(t)` returns a spec whose `domain == "binance"` and `source_trace == "t1"` (assert in a unit test).

2. **Every run emits a trace + self-eval.** After an execute run (issue 05 path), the returned `ChannelResult.metadata["trace"]` is a `journey_trace_v1` dict (has `summary.domain`, `steps`, `outcome`), and a `self_eval` result comparing outcome to the skill's `terminal_conditions`/`milestones` is appended to that skill's `skills.evidence` (one new list entry per run when a persisted `Skill` exists). Verify in a unit test that drives `SkillChannel.collect` with a stubbed loop/page: assert `result.metadata["trace"]["schema"] == "journey_trace_v1"` and that the loaded `Skill.evidence` grew by one entry whose `passed` reflects the outcome.

3. **`re_distill` re-distills, never hand-patches.** `correction.re_distill` loads a `Skill` + failing trace + current `skill_md`, calls `distill_trace`, and writes back: `skills.version` incremented by exactly 1, `evidence` has exactly one new appended entry, and `skill_md`/`elements` are **replaced from `to_skill_fields(spec)`** (no field set by hand). Covered by acceptance #5's test.

4. **Authenticated re-distill endpoint + dock wiring.** `POST /api/v1/skills/{skill_id}/redistill` exists, is authenticated like the other v1 write endpoints, and returns the new version. Verify:
   ```bash
   python -c "from backend.main import app; print(any(getattr(r,'path','').endswith('/skills/{skill_id}/redistill') for r in app.routes))"
   # prints: True
   ```
   And the dock `重蒸技能` button calls it through the existing proposal/confirm-style flow (manual check: with the backend up and a failing skill in context on `/labs/topology`, clicking `重蒸技能` shows a confirm card and, on confirm, toasts the bumped version; the skill row's `version` increments and `evidence` gains a `"corrected"` entry).

5. **`tests/skills/test_correction.py` passes under `-m "not live"`.** With `distill_trace` stubbed (monkeypatch `backend.skills.correction.distill_trace` — or the symbol it imports — to an async fn returning a fixed spec, e.g. `{"skill_name":"x","scope":"s","skill_md":"NEW MD","procedure":["p"],...,"domain":"d","capability":"c","source_trace":"t1","distill_model":"m"}`), feeding a failing trace through `re_distill` against a seeded `Skill` (version=1, known `skill_md`/`elements`/`evidence`) asserts: `version == 2` (bumped by exactly 1), `len(evidence) == prior + 1`, `skill_md == "NEW MD"`, and `elements` updated from `to_skill_fields`. Use the in-memory SQLite `db_session` fixture from `tests/conftest.py`. Run:
   ```bash
   pytest tests/skills/test_correction.py -m "not live" -q
   # passes; no network, no browser
   ```

6. **No automatic re-distill is wired.** Re-distill fires **only** from the endpoint/dock (human trigger). Grep proves no auto-after-N-fails policy exists:
   ```bash
   grep -rIn -e "consecutive" -e "auto.*re.?distill" -e "re.?distill.*auto" backend/skills backend/channels backend/pipeline
   # no automatic-trigger hits (only the human-triggered service/endpoint path)
   ```
   The self-eval signal is computed and logged to `evidence` (acceptance #2) but does not itself call `re_distill`.

## Verifying against a real local Chrome

Acceptance #2 is the only criterion that touches a live run, and it should be tested with **stubs** in the default suite (no browser) so `pytest -m "not live"` stays green. The end-to-end "real Chrome" path is owned by **issue 07** (e2e behind the `live` marker). If you want to smoke-test the trace on real hardware before 07 lands:
1. Have a Chrome reachable by `backend/browser_pool.py` (local/LAN CDP) — same substrate the opencli channel uses; `connect_over_cdp` attaches to the existing context, so a logged-in tab is reused.
2. Trigger a `skill` `DataSource` run (dock "run skill" or `trigger_task`), watch the run-events stream for `skill_step`/`skill_done`, then inspect the run's `ChannelResult.metadata["trace"]` (logged) and the skill's `evidence` JSON for the appended self-eval entry.
3. For correction, mark a run failed (outcome ≠ `terminal_conditions`), click `重蒸技能`, confirm, and verify the skill's `version` incremented and `skill_md`/`elements` changed. Keep this manual; the **automated** browser assertion lives in issue 07.

## Out of scope / non-goals

- **Auto-triggered re-distill after N consecutive failures** — v2 (ADR-0003 D8; PRD §1, §7). v1 only computes + logs the self-eval signal; the policy that turns N fails into an automatic re-distill is explicitly deferred.
- **The human record leg ("录这站")** producing the first `journey_trace_v1` from a demonstration — separate TODO. This issue only fixes the shared shape and emits it from execute runs.
- **Cross-process pause/resume** of an `awaiting_confirm` run — v2.
- **NAT / edge-node execution, vision/raw-DOM/screenshot perception, `evaluate(js)`** — rejected/deferred by the ADR; not part of this issue.
- Changing `AbstractChannel.collect` or adding a new run status — out (status `awaiting_confirm` and the migration are owned by issue 04; this issue only *reads* the outcome into the trace/self-eval).
