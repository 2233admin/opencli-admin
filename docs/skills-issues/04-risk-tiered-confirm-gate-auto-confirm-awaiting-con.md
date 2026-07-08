# 04 Risk-tiered confirm gate + auto_confirm + awaiting_confirm run status + migration

> Self-contained build unit. Authority for the design is **ADR-0003**
> (`docs/adr/0003-skill-execute-loop-architecture.md`) and the PRD
> (`docs/skills-execute-loop-PRD.md` §4 D4/D5/D8, §5 data delta, §6 integration
> table). The 8 ADR decisions are **fixed** — do not re-litigate them. Read those
> two docs first; everything below is pinned to this codebase's real symbols.

## Context

The skill execute loop lets a cheap text model drive a real Chrome page one
action per step. **ADR-0003 D4 (Guardrail — risk-tiered confirm)** says reads /
navigation / scroll / extract auto-run, but an action that matches the skill's
`red_lines` **or** a high-risk verb pattern (`submit | pay | post | delete`)
requires confirm — "写前确认是硬底线". A source may opt a trusted skill into
unattended running with `channel_config.auto_confirm = true` (default **off**).
This issue builds the **pure risk classifier** plus the **gate** that sits
between the loop's chosen action and `execute_action`, and the **`awaiting_confirm`
run status** plumbing (**ADR-0003 D5 / D8**, PRD §5): in headless mode, hitting a
confirm-required action stops the loop and surfaces `awaiting_confirm` up to the
runner via `ChannelResult.metadata` instead of completing. Interactive
synchronous confirm (the dock round-trip) is **out** — that is issues 05/06; here
the testable behavior is the **headless abort**. Ships an anchor Alembic migration
that chains the current head so this feature owns its status string.

This is the safety spine of the loop. The dangerous failure mode is a **false
negative** (a write mis-classified as auto-run = a silent submit/pay/post), so the
classifier defaults to confirm on ambiguity and is unit-tested hard.

## Scope

**In scope**
- `backend/skills/risk.py` — pure `classify_action(action, element, skill)` →
  tier + `needs_confirm`. Conservative (ambiguous ⇒ `needs_confirm=True`).
  `red_lines` authoritative over the generic verb pattern.
- The **confirm gate** wired into the loop (`backend/skills/loop.py`): between the
  model's chosen action and `execute_action`, call `classify_action`; honor
  `auto_confirm`; on a blocked action in headless mode, stop and set the
  `awaiting_confirm` metadata contract.
- `auto_confirm` read from `config` (`DataSource.channel_config["auto_confirm"]`,
  default `False`) — no schema change.
- The **`awaiting_confirm` propagation contract** via `ChannelResult.metadata`
  (`metadata[AWAITING_CONFIRM] = True` + the proposed action), so it can ride the
  existing `PipelineResult.metadata` path up to the runner. Centralize the status
  string as a **constant**, not inlined.
- `backend/migrations/versions/n4i5j6k7l8m9_add_awaiting_confirm_run_status.py`
  with `down_revision = 'm3h4i5j6k7l8'` — the anchor migration for this feature.
  `upgrade()` may be a documented **no-op** (`TaskRun.status` is free-text
  `String(50)`; PRD §5).
- `tests/skills/test_risk.py` — covers auto-run tiers, generic high-risk verbs,
  `red_line` precedence, and `auto_confirm` bypass; passes under `-m "not live"`.

**Out of scope**
- Synchronous **dock confirm UI / endpoint round-trip** (interactive resume is the
  issue 05/06 surface). Here the only testable confirm behavior is the **headless
  abort**.
- The **Phase-4 status write** in `runner.py` and the `run_id`/endpoint injection
  in `pipeline.py` — that wiring is **issue 05**. This issue only defines the
  *contract* (the metadata key + constant) and proves it is observable at the
  `ChannelResult` boundary.
- **Cross-process pause/resume** of a paused headless run (v2).
- The loop itself, perception, action executor, provider resolution (issues
  01–03). This issue assumes `backend/skills/loop.py` exists from issue 03 and
  adds the gate to it.

## Depends on

- **03** — Cheap-model step loop + 9-element prompt + tool-calling harness
  (`backend/skills/loop.py`, `backend/skills/prompt.py`). The gate sits inside the
  loop's per-step path (model picks an action → **gate** → `execute_action`).
  Transitively 01 + 02 (page wrapper, action executor) ship the verb set the
  classifier reasons over.

## Files

| File | Create/Edit | Purpose (one line) |
|---|---|---|
| `backend/skills/risk.py` | **create** | Pure `classify_action(...)`, the `RiskTier` enum, `HIGH_RISK_VERBS`, and the `AWAITING_CONFIRM` status constant. No DB / no I/O. |
| `backend/skills/loop.py` | **edit** (from issue 03) | Insert the confirm gate between chosen action and `execute_action`; read `auto_confirm` from `config`; on a blocked headless action, stop and set the awaiting-confirm metadata. |
| `backend/migrations/versions/n4i5j6k7l8m9_add_awaiting_confirm_run_status.py` | **create** | Anchor Alembic migration; `down_revision='m3h4i5j6k7l8'`; `upgrade()` documented no-op. |
| `tests/skills/test_risk.py` | **create** | Unit tests for the classifier + gate decision; runs under `-m "not live"`. |

> If issue 03 has **not** landed yet, still create `risk.py`, the migration, and
> `test_risk.py` (all standalone), and add a `TODO(05)` marker where the gate call
> will be inserted in `loop.py` — the classifier and its tests must be green
> independently. `tests/skills/` does not exist yet; create it (with
> `tests/skills/__init__.py` if the suite uses package dirs).

## Implementation notes

### 1. `backend/skills/risk.py` — pure classifier

The classifier reasons over **one action** (the verb set from ADR-0003 D3:
`navigate{url}`, `click{ref}`, `type{ref,text,submit?}`, `select{ref,value}`,
`scroll{dir}`, `extract{data}`, `done{status,note}`) plus the **resolved element**
it targets (the `{ref, role, name, value}` snapshot entry from the perception
layer — issue 01) plus the `Skill` (for `red_lines` from `Skill.elements`).

```python
from dataclasses import dataclass
from enum import Enum

# Centralized run-status string (PRD §7: status is free-text — typos won't be
# caught by the DB, so define it once). Imported by loop.py / runner (issue 05).
AWAITING_CONFIRM = "awaiting_confirm"

# Generic high-risk verbs (ADR-0003 D4). Matched against the action verb AND the
# target element's name/role/value, case-insensitive, word-ish.
HIGH_RISK_VERBS = ("submit", "pay", "post", "delete")

# Verbs that are inherently safe regardless of target (ADR-0003 D4: reads /
# navigation / scroll / extract auto-run).
AUTO_RUN_VERBS = ("navigate", "scroll", "extract", "done")

class RiskTier(str, Enum):
    AUTO = "auto"          # read/navigate/scroll/extract — runs unattended
    CONFIRM = "confirm"    # write/high-risk — needs confirm

@dataclass(frozen=True)
class RiskDecision:
    tier: RiskTier
    needs_confirm: bool
    reason: str            # why (for the event detail + tests)
    matched_red_line: str | None = None

def classify_action(action: dict, element: dict | None, skill) -> RiskDecision:
    ...
```

Decision order (this order is the contract — tests assert it):

1. **`red_lines` first and authoritative.** Read the skill's red lines
   (`skill.elements.get("red_lines")` — a list of strings; also accept a plain
   dict/`Skill`-like object so the classifier is testable without a DB row). If
   the action (verb + target element name/role/value, lowercased) matches any red
   line, return `tier=CONFIRM, needs_confirm=True, matched_red_line=<the line>`.
   **This wins even when the verb would otherwise be auto-run** (e.g. an
   `extract` named in `red_lines`). This is acceptance criterion 2 — red_lines
   take precedence over the generic pattern.
2. **Generic high-risk pattern.** If the verb is `click`/`type`/`select` **and**
   the verb token or the element name/role/value contains a `HIGH_RISK_VERBS`
   token (`submit|pay|post|delete`) — e.g. a button named "Submit order", role
   `button` with name "Delete", a `type{...,submit:true}` — return
   `tier=CONFIRM, needs_confirm=True`.
3. **Auto-run tiers.** `navigate` / `scroll` / `extract` / `done`, and any
   plain read-style `click`/`select` that matched nothing above → `tier=AUTO,
   needs_confirm=False`. **Any read is auto.**
4. **Ambiguous default ⇒ confirm.** If the action verb is unrecognized, the
   target element can't be resolved for a write-ish verb
   (`click`/`type`/`select` with `element is None`), or matching is uncertain →
   `tier=CONFIRM, needs_confirm=True, reason="ambiguous-default-confirm"`. PRD §7:
   "Keep the classifier conservative (default to confirm on ambiguity)."

Pure function: **no DB session, no Playwright, no events** — it takes plain data
and returns a `RiskDecision`. This is what makes acceptance criterion 6 (unit
tests, `-m "not live"`, no browser) trivial.

`type{...,submit:true}` is a write regardless of the element name — treat the
`submit` flag as a high-risk signal in step 2.

### 2. Gate wiring in `backend/skills/loop.py`

The loop (issue 03) runs: perceive → cheap model emits one action → **gate** →
`execute_action` → emit event → repeat until `done`/cap. Insert the gate between
the chosen action and `execute_action`:

```python
from backend.skills.risk import classify_action, RiskTier, AWAITING_CONFIRM

decision = classify_action(action, target_element, skill)
if decision.needs_confirm and not auto_confirm:
    # headless v1: abort cleanly (interactive resume = issue 05/06)
    await events.emit(
        run_id, AWAITING_CONFIRM,
        f"awaiting confirm: {action.get('verb')} ({decision.reason})",
        level="warning",
        detail={"action": action, "decision": decision.reason,
                "matched_red_line": decision.matched_red_line},
    )
    return ChannelResult.ok(
        items,                       # whatever extracted before the gate still flows
        channel="skill",
        executed=True,
        **{AWAITING_CONFIRM: True},  # metadata key == the status constant
        proposed_action=action,      # what the operator must confirm
    )
# auto-run, or auto_confirm bypass:
result = await execute_action(action, ...)
```

Honor these existing seams (do **not** change their signatures):

- `auto_confirm` comes from `config` — i.e. `DataSource.channel_config["auto_confirm"]`
  (default `False`). `SkillChannel.collect(config, parameters)` already reads it
  (`backend/channels/skill_channel.py` line 62:
  `auto_confirm = bool(config.get("auto_confirm", False))`). Thread that value into
  the loop; `SkillChannel.validate_config` already tolerates the key.
- **Do NOT change `AbstractChannel.collect(config, parameters)`**
  (`backend/channels/base.py`). The metadata rides `ChannelResult.metadata` — that
  is the contract change, and it's additive (`ChannelResult.ok(items, **metadata)`
  already exists, line 20).
- Per-step events use the module-level `backend/pipeline/events.py::emit(run_id,
  step, message, level, detail, elapsed_ms)` (best-effort, never raises). `step` is
  free-text `String(50)`; use `AWAITING_CONFIRM` as the step value so it's the
  centralized constant, not an inlined literal.
- The proposal payload shape should mirror chat's
  `backend/api/v1/chat.py::Proposal{tool,args,summary,diff}` and the `WRITE_TOOLS`
  set / `_is_xml_tool_model` / `_parse_tool_use` pattern (line 144, 460, 465) so
  issues 05/06 can reuse the dock's diff-card → `/chat/confirm` flow. v1 only needs
  the *action* in metadata; full `Proposal` rendering is 06.

### 3. `awaiting_confirm` propagation contract (no runner change here)

The runner's Phase 4 (`backend/pipeline/runner.py`, lines ~158–184) currently
forces `run.status` to `"completed"`/`"failed"`. The **status write** that reads
the metadata and sets `run.status = AWAITING_CONFIRM` is **issue 05's** edit.
This issue's job is to make the signal **exist and propagate to the
`ChannelResult` boundary**:

- The loop sets `ChannelResult.metadata[AWAITING_CONFIRM] = True` + `proposed_action`.
- `backend/pipeline/pipeline.py::run_pipeline` already passes channel metadata
  straight through on the success path:
  `return PipelineResult(..., metadata=channel_result.metadata)` (line 253). So the
  flag reaches `runner` Phase 4 via `pipeline_result.metadata` for free — **no
  pipeline.py change needed for the carry**.
- Document in this issue's note (and a `TODO(05)`) that Phase 4 must read
  `pipeline_result.metadata.get(AWAITING_CONFIRM)` and set
  `run.status = AWAITING_CONFIRM` instead of `"completed"`. Wiring + the run-list /
  dock legend is issue 05.

### 4. Anchor migration

`backend/migrations/versions/n4i5j6k7l8m9_add_awaiting_confirm_run_status.py`:

```python
"""add awaiting_confirm run status (anchor for the skill confirm gate)

Revision ID: n4i5j6k7l8m9
Revises: m3h4i5j6k7l8
Create Date: 2026-06-30
"""
from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "n4i5j6k7l8m9"
down_revision = "m3h4i5j6k7l8"   # current head (m3h4i5j6k7l8_add_skills)
branch_labels = None
depends_on = None

def upgrade() -> None:
    # No-op: TaskRun.status is free-text String(50); the new 'awaiting_confirm'
    # value needs no DDL. This migration is the anchor so the skill confirm-gate
    # feature owns the Alembic head and the status string is documented in the
    # chain. (PRD §5.)
    pass

def downgrade() -> None:
    pass
```

`m3h4i5j6k7l8` is verified to be the current single head with **no child
revision yet** (versions dir ends at `m3h4i5j6k7l8_add_skills.py`). Keep the
`abc…l8 / l8…m9` style ID so it sorts after the existing chain.

## Acceptance criteria

Run from `D:/projects/opencli-admin`. The suite default is `--cov-fail-under=80`;
these tests are non-live, so `-m "not live"` keeps them browser-free.

1. **Auto-run tiers + reads.**
   `classify_action` returns `needs_confirm=False` (tier `AUTO`) for `navigate`,
   `scroll`, `extract`, and any read-style `click`/`select` that matches no
   high-risk token and no red line. Verify:
   ```bash
   uv run pytest tests/skills/test_risk.py -m "not live" -q
   ```
2. **Generic high-risk verbs ⇒ confirm.** An action whose verb token **or** target
   element name/role/value matches `submit|pay|post|delete` (e.g. `click` on a
   button named "Submit", `delete`-named control, or `type{...,submit:true}`)
   returns `needs_confirm=True`. (test in the same file)
3. **`red_line` precedence.** An action that matches a skill `red_line` is
   `needs_confirm=True` **even when the verb would otherwise auto-run** (e.g. an
   `extract`/`navigate` named in `red_lines`); `RiskDecision.matched_red_line` is
   set. Asserts red_lines beat the generic pattern.
4. **Ambiguous ⇒ confirm.** Unrecognized verb, or a write-ish verb
   (`click`/`type`/`select`) with `element is None`, returns `needs_confirm=True`
   with `reason="ambiguous-default-confirm"`.
5. **`auto_confirm` bypass.** With `auto_confirm=True` a `needs_confirm` action is
   allowed to run (gate does not abort); with `auto_confirm` absent/`False` it is
   not auto-run. Tested at the gate-decision level (a tiny helper that takes
   `decision + auto_confirm` and returns run/abort), so no browser is needed.
6. **Headless abort surfaces the contract.** A loop run in headless mode (no
   `auto_confirm`) that reaches a `needs_confirm` action stops and the returned
   `ChannelResult.metadata["awaiting_confirm"] is True` with the proposed action
   present (`metadata["proposed_action"]`); a skill with **no** high-risk action
   runs fully through (`metadata` has no `awaiting_confirm` / it is falsy).
   - If issue 03's loop is landed, assert this against the loop with a fake action
     stream / monkeypatched `execute_action` (still `-m "not live"`).
   - If the loop is not yet landed, assert the **gate helper** returns abort vs run
     for the same inputs and leave the loop assertion as a `TODO(05)` xfail. The
     classifier + gate-decision tests must be green regardless.
7. **Status string is a constant.** `grep` proves `awaiting_confirm` is not
   inlined where it's used as a status/step:
   ```bash
   uv run python -c "from backend.skills.risk import AWAITING_CONFIRM; print(AWAITING_CONFIRM)"
   # -> awaiting_confirm
   ```
   `loop.py` (and later `runner.py`) import `AWAITING_CONFIRM`, not the literal.
8. **Migration chains cleanly.** The file exists with
   `down_revision = "m3h4i5j6k7l8"`, and the Alembic chain is single-headed and
   round-trips:
   ```bash
   uv run alembic heads        # -> n4i5j6k7l8m9 (single head)
   uv run alembic upgrade head # clean (upgrade is a no-op)
   uv run alembic downgrade -1 # clean
   uv run alembic upgrade head
   ```

### Verifying against a real local Chrome (optional, issue 05/07 territory)

The classifier and gate are **pure / unit-level** — no Chrome needed, which is the
point of the design. The end-to-end "headless run hits a high-risk action over a
real CDP page and the run lands at `awaiting_confirm`" check belongs to the live
e2e (issue 07, `live` marker) and the runner status write (issue 05). If you want
a smoke check here: construct a `Skill` with a `red_lines` entry, feed the gate a
synthetic `click` action on an element whose name matches it, and assert the gate
returns the `awaiting_confirm` `ChannelResult` — no browser required.

## Out of scope / non-goals

- Interactive **synchronous confirm** (dock diff-card → `/chat/confirm` →
  resume). v1 headless behavior is **abort at `awaiting_confirm`**; the
  interactive round-trip + `Proposal` rendering is issues **05/06**.
- The Phase-4 `run.status = awaiting_confirm` write in `runner.py`, the
  `run_id`/`chrome_endpoint` injection in `pipeline.py`, and run-list / dock
  status-legend surfacing — **issue 05**.
- **Cross-process pause/resume** of a paused run (v2). A headless run that hits a
  confirm-required action ends; operators re-run interactively or set
  `auto_confirm`.
- **Auto-triggered re-distill** after N failures (v2).
- Any change to `AbstractChannel.collect(config, parameters)` (forbidden by
  ADR-0003 D5) — the only contract change is additive `ChannelResult.metadata`.
- Schema changes to `DataSource.channel_config` (`auto_confirm` is JSON, no
  migration) or to `TaskRun.status` (free-text `String(50)`; the migration is a
  documented no-op anchor).
