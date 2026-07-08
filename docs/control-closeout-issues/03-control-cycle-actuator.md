---
labels: ready-for-agent
---

# 03 — Control Cycle + Actuator (PR-Control-4 core)

## Parent

docs/control-closeout-PRD.md

## What to build

Close the act leg of the control loop. A dedicated background Control Cycle (asyncio task started/stopped in the app lifespan, period configurable, default 60s — ADR-0007, deliberately NOT the collection scheduler) runs a directly-invocable body function each tick:

1. For every source: run the shared decision path from issue 01 (measure → evaluate → record advisory rows; existing ledger dedup applies).
2. Judge ripe pending outcomes (existing `evaluate_pending_outcomes`) — the previously lazy evaluation now runs every cycle, so Recovery Rate accumulates unattended.
3. Execute, only when ALL gates pass:
   - global kill switch off (config setting + runtime API toggle; in-memory, resets to config on restart)
   - `CONTROL_MODE=automatic`
   - the (state, action_type) advisory-report bucket has `samples >= control_gate_min_samples` (default 10) AND `recovery_rate >= control_gate_min_recovery_rate` (default 0.6) — both settings
   - per-(source, action_type) cooldown elapsed; global max-actions-per-hour not exhausted (both settings)
   - no unresolved identical executed row for the same (source, action_type, state) — idempotency/in-flight dedup

Actuator whitelist is exactly three actions: `increase_interval` (bounded multiplicative backoff on the source schedule), `pause` (with TTL; the cycle auto-resumes expired pauses via the inverse op), `require_review` (sets a review flag on the source). Any suggestion outside the whitelist (`force_cursor_rescan`, `switch_write_strategy`) executes as `require_review` instead — the Require-Review Downgrade (ADR-0004) — with the original suggestion preserved in the ledger row payload.

Every execution is a new Evidence Ledger row with `mode="automatic"`, `executed=True` — same `control_actions` table, no new table; outcome judgment applies to executed rows identically. `CONTROL_MODE` ships defaulting to advisory and the kill switch ships off — the safe position.

The control-state endpoint stays a pure read for decisions AND executions (no acting on the GET path).

## Acceptance criteria

- [ ] Cycle body is a plain async function taking session + `now`, invocable in tests without the asyncio wrapper; wrapper has a start/stop smoke test
- [ ] In Advisory Mode the cycle writes ledger rows but NEVER mutates a data source (mirror of the existing zero-mutation test)
- [ ] Gate math tested per bucket: below min samples → no execution; below recovery rate → no execution; both pass → execution
- [ ] Cooldown, max-actions-per-hour, and idempotency dedup each independently block re-execution (tests)
- [ ] `pause` writes TTL; a later cycle past expiry auto-resumes the source and records the inverse action in the ledger
- [ ] Dangerous suggestions downgrade to `require_review` execution with original suggestion preserved (test)
- [ ] Kill switch (config and runtime toggle via API) short-circuits all execution (integration test)
- [ ] Executed rows appear with `mode="automatic"`, `executed=True` and get outcome-judged
- [ ] Outcome evaluation runs as part of the cycle (no longer only lazy)
- [ ] Full pytest suite green, coverage ≥80%, single alembic head (migration only if the review-flag/pause-TTL fields need columns)

## Blocked by

- 01-prefactor-unified-decision-path
- 02-per-source-objective-override

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- Respect ADR-0004/0005/0006/0007 and CONTEXT.md Control vocabulary (Actuator, Control Cycle, Evidence Ledger, Recovery Rate, Require-Review Downgrade)
- Reuse: `control_actions` ledger, `evaluate_pending_outcomes`, advisory-report bucketing, error taxonomy — do not build parallel mechanisms
- Run: `uv run --directory D:\projects\opencli-admin pytest` (full suite) before declaring done
