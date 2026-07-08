# 05 Run integration: wire SkillChannel.collect into the task/run/pipeline spine

> Self-contained issue. Source of truth: `docs/adr/0003-skill-execute-loop-architecture.md` (ADR-0003) and `docs/skills-execute-loop-PRD.md` (§4 D5, §5, §6, §8). Repo root: `D:/projects/opencli-admin`. Read those two docs + the files listed below before starting; everything you need to implement this issue is named here.

## Context

This is the **execute** leg's "make it actually run inside the existing system" issue. Issues 03 (cheap-model step loop + 9-element prompt + tool-calling harness) and 04 (risk-tiered confirm gate + `auto_confirm` + `awaiting_confirm` status) build the loop and the gate as standalone backend/skills modules. This issue replaces the stub body of `backend/channels/skill_channel.py::SkillChannel.collect` with a call into that loop, and threads it through the existing **task → run → pipeline → events → record** spine **without changing any channel contract**. This realizes ADR-0003 **D5 (Run integration: stay in the spine, no `collect()` contract change)** and the `awaiting_confirm` half of **D8 (v1 interactive-first; headless aborts cleanly on a confirm-required action)**. After this issue, a `skill` `DataSource` runs end-to-end through the same `run_pipeline` that `opencli`/`rss` use: per-step `TaskRunEvent`s show up in the run-events UI, `extract` records land in the store via the normal normalize/dedup/AI/notify path, and a paused loop drives the run to `awaiting_confirm` instead of a false `completed`/`failed`.

The seam is already open (PRD §2): `SkillChannel.collect(config, parameters)` is invoked by `collector.collect`, already acquires a CDP endpoint from `browser_pool`, already resolves the SKILL.md (inline `config["skill_md"]`) and the cheap-executor `provider`. What is stubbed is everything between "I have a CDP endpoint" and "here are the extracted records": today it returns one `proposed_step` dict with `executed=False, skeleton=True` and stops at the gate. This issue makes it drive the real loop.

## Scope

**In scope**
- `backend/channels/skill_channel.py` — replace the skeleton body of `collect` with the real perceive→gate→act loop: load SKILL.md, resolve the cheap-executor provider, acquire the browser (already wired), run the loop (issues 03/04), emit per-step `TaskRunEvent`s via `events.emit(run_id, ...)`, return `extract` records as `ChannelResult.items`, and propagate `awaiting_confirm` in `ChannelResult.metadata`.
- `backend/pipeline/pipeline.py::run_pipeline` — add a `channel_type == "skill"` branch in the pre-step + collect-event block that injects `params["run_id"] = run_id` (and `params["chrome_endpoint"]` from a browser binding when one exists), mirroring the existing `opencli` special-case; build a `skill`-flavored collect-event `detail`; and propagate `channel_result.metadata["awaiting_confirm"]` into the returned `PipelineResult.metadata`.
- `backend/pipeline/runner.py::run_collection_pipeline` Phase 4 — when the pipeline reports a paused outcome (`pipeline_result.metadata.get("awaiting_confirm")`), set `run.status = "awaiting_confirm"` (and a matching `task.status`) instead of forcing `completed`/`failed`.
- `tests/skills/test_skill_channel.py` — new test module (creating it creates the `tests/skills/` dir) covering the wiring: events emitted, items stored, `awaiting_confirm` status. Must run under `-m "not live"`.

**Out of scope (deferred to other issues / v2)**
- **Changing `AbstractChannel.collect(config, parameters)` signature — forbidden** (ADR-0003 D5). The loop must receive `run_id` and `chrome_endpoint` through `parameters`, not via a new arg.
- **The loop internals and the risk gate themselves** — issues 03 and 04. This issue *calls* them; it does not reimplement the perceive/act/gate logic, the verb schema, the tool-calling harness, or the risk classifier.
- **`journey_trace_v1` trace assembly + re-distill / correction path + dock "重蒸技能"** — issue 06. This issue may pass through a `trace` value if the loop returns one, but does not build the trace or wire re-distill.
- **The human *record* leg** ("录这站", the record-leg producer) — separate TODO (PRD §1 non-goals).
- **`skill_id` / `(domain, capability)` → DB resolution** — may stay deferred per the existing skeleton TODO (`_resolve_skill_md`) as long as inline `config["skill_md"]` works. Do not block this issue on a `SkillService`.
- **Cross-process pause/resume** of a headless run that hit `awaiting_confirm` — v2. v1 simply stops at that status.
- **The `awaiting_confirm` anchor migration + run-list/run-detail API + dock legend surfacing** — owned by issue 04 (PRD §5). This issue only needs Phase 4 to *set* the status; since `TaskRun.status` is free-text `String(50)`, storing the value needs no schema change.

## Depends on

- **03** — Cheap-model step loop + 9-element prompt + tool-calling harness (`backend/skills/loop.py`, `backend/skills/prompt.py`). Provides the callable the channel drives.
- **04** — Risk-tiered confirm gate + `auto_confirm` + `awaiting_confirm` status + anchor migration (`backend/skills/risk.py`, migration, `backend/channels/base.py` metadata usage). Provides the gate the loop consults and the `awaiting_confirm` status anchor.

If 03/04 land a concrete entrypoint name different from what this file assumes, adapt to the real symbol — the contract this issue depends on is: *something callable that, given a connected page + provider + SKILL.md elements + an `emit` callback + an `auto_confirm` flag, runs the loop and yields (extract records, awaiting_confirm flag, optional trace)*.

## Files

| File | Create / Edit | Purpose (one line) |
|---|---|---|
| `D:/projects/opencli-admin/backend/channels/skill_channel.py` | Edit | Replace the skeleton `collect` body with the real loop wiring: read `run_id`/`chrome_endpoint` from `parameters`, drive the loop, emit per-step events, return `extract` records as `items`, propagate `awaiting_confirm` in `metadata`. |
| `D:/projects/opencli-admin/backend/pipeline/pipeline.py` | Edit | Add `channel_type == "skill"` branch to inject `run_id` (+ `chrome_endpoint` from a binding) into `params` and build the collect-event `detail`; propagate `metadata["awaiting_confirm"]` into `PipelineResult.metadata`. |
| `D:/projects/opencli-admin/backend/pipeline/runner.py` | Edit | Phase 4: set `run.status="awaiting_confirm"` (+ `task.status`) when `pipeline_result.metadata["awaiting_confirm"]` is truthy, instead of `completed`/`failed`. |
| `D:/projects/opencli-admin/tests/skills/test_skill_channel.py` | Create | Drive `run_pipeline` / `run_collection_pipeline` for a `skill` source with a stubbed model + fake page; assert events emitted, items stored, and the `awaiting_confirm` path sets the run status. Runs under `-m "not live"`. |

## Implementation notes

Concrete to this codebase's symbols. Honor the fixed decisions: **do not change `AbstractChannel.collect`'s signature**, and reuse the spine — do not add a parallel runner for skills.

### 1. `run_pipeline` — inject `run_id` + endpoint for `skill` (mirror the `opencli` case)

In `backend/pipeline/pipeline.py::run_pipeline`:

- **Pre-step endpoint binding.** The existing block (around lines 45–55) only runs for `source.channel_type == "opencli"`:
  ```python
  if source.channel_type == "opencli" and not params.get("chrome_endpoint"):
      site = source.channel_config.get("site", "")
      ...
      binding = await browser_service.get_binding_by_site(session, site)
      if binding:
          params = {**params, "chrome_endpoint": binding.browser_endpoint}
  ```
  Add an analogous `skill` branch. A skill source's site key may live under a different config key than `opencli`'s `"site"` (e.g. `channel_config.get("site")` or a skill-specific binding); resolve `chrome_endpoint` from `browser_service.get_binding_by_site(session, site)` when a site is present, and otherwise leave it unset so `browser_pool.acquire(endpoint=None)` picks a default. Keep this best-effort (a missing binding is not an error — the pool can still acquire).
- **Inject `run_id` into `params`.** Critical: `SkillChannel.collect` only receives `(config, parameters)`. The loop needs `run_id` to call `events.emit(run_id, ...)`. Add, in the `if run_id:` collect block (around line 62), a `skill` branch that does `params = {**params, "run_id": run_id}` **before** `collector.collect(source, params)` is called (line 93). Do this for `skill` specifically (don't blanket-inject for all channels — other channels don't expect it, and the `opencli` detail-builder explicitly strips `chrome_endpoint` from params, so keep behavior scoped).
- **Collect-event `detail`.** In the same `if run_id:` block, give `skill` a flavored `collect_detail` (e.g. include `channel_type`, the skill char count if cheaply available, and the resolved `chrome_endpoint` presence) similar to how `opencli` builds a `command` string. Keep it small; this is just for the run-events UI.
- **Propagate `awaiting_confirm` up.** `run_pipeline` already returns `metadata=channel_result.metadata` in the success `PipelineResult` (line 253). That means if `SkillChannel` puts `awaiting_confirm` in `ChannelResult.metadata`, it already flows to `PipelineResult.metadata` on the success path — verify this and do not drop it. (A paused run is still a *successful pipeline execution* — collect/normalize/store all ran; it just paused. Return `success=True` with `metadata["awaiting_confirm"]=True`.)

### 2. `SkillChannel.collect` — drive the loop (replace the skeleton)

In `backend/channels/skill_channel.py`, keep `validate_config` and `_resolve_skill_md` as-is. Replace the body after the `async with pool.acquire(...) as cdp_endpoint:` line:

- Read `run_id = parameters.get("run_id")`. Build a tiny per-step emit helper that calls the module-level `from backend.pipeline import events` → `await events.emit(run_id, step, message, level=..., detail=..., elapsed_ms=...)` — but **no-op when `run_id` is None** (so a direct unit-test call without the pipeline still works). `events.emit` is best-effort and never raises.
- Connect to the page over CDP (Playwright wrapper from issue 01, `backend/skills/page.py`) using `cdp_endpoint`. (Issues 01–03 own the page/loop; from this file you just hand the connected page + provider + SKILL.md + emit + `auto_confirm` to the loop entrypoint.)
- Resolve the SKILL.md 9 elements: for v1, parse from inline `skill_md` (already loaded) / `config` per issue 03's prompt builder. `provider = config.get("provider", {})` is the cheap-executor config (same shape as `backend/skills/distill.py` provider). `auto_confirm = bool(config.get("auto_confirm", False))`.
- Run the loop (issue 03 entrypoint). The loop must emit per-step events through the emit helper. **Step names** (free-text `TaskRunEvent.step`, `String(50)`) — use exactly these so the UI/tests can key on them: `skill_perceive`, `skill_step`, `skill_extract`, `awaiting_confirm`, `skill_done` (PRD §6 also lists `self_eval`, which belongs to issue 06).
- Collect `extract{data}` results into an `items: list[dict]`. Return:
  ```python
  return ChannelResult.ok(
      items,
      channel="skill",
      chrome_mode=mode,
      executed=True,
      awaiting_confirm=<bool>,   # True iff the loop paused at the gate
      # trace=<journey_trace_v1>,  # optional pass-through; assembly is issue 06
  )
  ```
  `ChannelResult.ok(items, **metadata)` (see `backend/channels/base.py`) folds every keyword into `.metadata`, so `awaiting_confirm` lands in `metadata` automatically. Keep the existing `try/except` that maps a browser/exec failure to `ChannelResult.fail(...)`.
- The current stub returns `executed=False, skeleton=True` — remove those.

### 3. `runner.py` Phase 4 — honor the paused status

In `backend/pipeline/runner.py::run_collection_pipeline`, Phase 4 (around lines 158–184) currently branches only on `pipeline_result.success`: success → `completed`, else → `failed`. Insert a paused branch **before** the success/failure decision:

```python
if pipeline_result.metadata.get("awaiting_confirm"):
    if task:
        task.status = "awaiting_confirm"
        task.error_message = None
    if run:
        run.status = "awaiting_confirm"
elif pipeline_result.success:
    ... existing completed branch ...
else:
    ... existing failed branch ...
```

`run.finished_at`, `run.duration_ms`, `run.records_collected` are still set (a paused run did collect/store whatever it got before pausing). `TaskRun.status` and `CollectionTask.status` are free-text `String(50)` (see `backend/models/task.py`), so no migration is needed here to store `"awaiting_confirm"` — the anchor migration is issue 04's. Leave the return dict shape unchanged (callers read `success`/`run_id`/`stored`).

### 4. The spine you are reusing (do not duplicate)

- `backend/pipeline/collector.py::collect` already does `get_channel("skill").collect(source.channel_config, parameters)` — **no change** (it's dispatch-only). `skill` is already registered (`backend/channels/registry.py` imports `skill_channel`).
- `backend/pipeline/events.py::emit(run_id, step, message, level="info", detail=None, elapsed_ms=None)` writes one `TaskRunEvent` row, best-effort. Reuse verbatim; do not add a new event writer.
- `extract` records returned in `ChannelResult.items` go through `normalizer.normalize_items(items, source.id)` then `storer.store_records(session, task_id, source.id, triples, channel_type="skill")` — the **same** path every channel uses (pipeline.py lines 130 & 143). Make `extract` payloads dict-shaped records (e.g. include a `url`/`title`/`content`-ish key the normalizer/dedup expects) so they store + dedup like any other record. No change to normalizer/storer.
- `browser_pool.get_pool().acquire(endpoint=...)` and `pool.get_mode(ep)` are already wired in the skeleton — keep them.

## Acceptance criteria

Falsifiable. Run from repo root `D:/projects/opencli-admin`. The suite default is `addopts = --cov=backend --cov-report=term-missing --cov-fail-under=80` with `asyncio_mode = "auto"`; the `live` marker is deselected with `-m "not live"`.

1. **Contract unchanged.** `AbstractChannel.collect(config, parameters)` signature is byte-for-byte unchanged in `backend/channels/base.py` (no new positional/keyword arg). `SkillChannel.collect` drives the perceive→gate→act loop and, on a clean run, returns `ChannelResult.ok(items=<extract records>, channel="skill", executed=True, awaiting_confirm=False)`. Verify: `git diff backend/channels/base.py` touches nothing in the `collect` signature; `grep -n "skeleton" backend/channels/skill_channel.py` returns nothing.

2. **`run_id` + endpoint injection.** `run_pipeline` has a `channel_type == "skill"` branch that sets `params["run_id"] = run_id` (and `params["chrome_endpoint"]` when a binding exists) **before** `collector.collect` is dispatched; `SkillChannel.collect` reads `run_id` from `parameters` and calls `events.emit(run_id, step, ...)` for each step. Observable: a skill run produces `TaskRunEvent` rows whose `step` ∈ {`skill_perceive`, `skill_step`, `skill_extract`, `skill_done`} (and `awaiting_confirm` on the paused path) for that `run_id`.

3. **Extracts flow through the normal store path.** `extract` records returned in `ChannelResult.items` pass through `normalizer.normalize_items` and `storer.store_records` unchanged: a skill run whose loop emits N `extract` records produces stored `CollectedRecord`s (and `PipelineResult.stored == <new count>`), with no skill-specific store branch added.

4. **Paused run → `awaiting_confirm` (not completed/failed).** When the loop pauses at the gate, `ChannelResult.metadata["awaiting_confirm"]` is `True`, it propagates to `PipelineResult.metadata["awaiting_confirm"]`, and `runner.run_collection_pipeline` Phase 4 sets `run.status == "awaiting_confirm"` (and `task.status == "awaiting_confirm"`) — **not** `completed`/`failed`. A clean run (no pause) still sets `run.status == "completed"` exactly as before (existing `test_run_pipeline_*` tests stay green).

5. **Integration test under `-m "not live"`.** `tests/skills/test_skill_channel.py` drives `run_collection_pipeline` (or `run_pipeline`) for a `skill` `DataSource` with **(a)** a stubbed cheap model (patch the loop's model call / tool-calling harness so it returns a scripted action sequence — e.g. `extract` then `done`) and **(b)** a fake page (patch the Playwright page wrapper from issue 01 so no real Chrome/CDP is needed), and asserts: (i) `TaskRunEvent`s were emitted for the run (query rows by `run_id`, assert the expected `step` values appear); (ii) items reached the store (assert `stored`/`CollectedRecord` count); (iii) the `awaiting_confirm` script drives `run.status == "awaiting_confirm"`. Command: `python -m pytest tests/skills/test_skill_channel.py -m "not live" -q` passes. Follow the patch style in `tests/unit/pipeline/test_pipeline.py` (patch `backend.pipeline.collector.collect`, `backend.pipeline.storer.store_records`, `backend.database.AsyncSessionLocal`) and the SQLite in-memory `db_session` fixture in `tests/conftest.py`.

6. **No regressions.** `python -m pytest tests/unit/pipeline -m "not live" -q` stays green (the `opencli` auto-binding path and all `run_pipeline` success/failure/AI/notify tests are unaffected), and the full `python -m pytest -m "not live"` suite still meets `--cov-fail-under=80`.

### Verifying against a real local Chrome (optional, behind `live`)

This issue's required tests are headless (stub model + fake page). To smoke-test the wiring against a real browser without writing the full e2e (issue 07 owns that): with a Chrome reachable via `browser_pool` (a `live`-marked or manual run), create a `skill` `DataSource` with an inline `channel_config["skill_md"]` for a read-only task (only auto-run verbs: `navigate`/`extract`/`done`), trigger it through `run_collection_pipeline`, and confirm in the run-events UI (`/labs/topology`) that `skill_perceive`/`skill_step`/`skill_extract`/`skill_done` events appear and the run ends `completed` with stored records. A skill containing a high-risk verb (submit/pay/post/delete) with `auto_confirm` unset must end the run at `awaiting_confirm`. Gate any such test behind the `live` marker so the default suite needs no browser.

## Out of scope / non-goals

- Changing `AbstractChannel.collect(config, parameters)` — **forbidden** (ADR-0003 D5). `run_id`/`chrome_endpoint` travel via `parameters`.
- Implementing the loop, prompt builder, tool-calling harness, verb schema, or risk classifier — issues 03/04. This issue only *calls* them.
- `journey_trace_v1` assembly, re-distill / correction service+endpoint, dock "重蒸技能" button — issue 06.
- The `awaiting_confirm` anchor migration + run-list/run-detail API filter + dock/run-UI status legend — issue 04 (and its UI follow-up). This issue only needs Phase 4 to *set* the status.
- The human *record* leg ("录这站") / record-leg producer — separate TODO.
- `skill_id` / `(domain, capability)` → DB resolution — may stay deferred (inline `skill_md` suffices for v1).
- Cross-process pause/resume of an `awaiting_confirm` run — v2.
- NAT/edge-node execution via `agent_server`; vision/raw-DOM/screenshot perception; `evaluate(js)` — rejected by ADR-0003 (D1/D2/D3).
