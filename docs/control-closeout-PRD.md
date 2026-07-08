---
labels: ready-for-agent
branch: refactor/thin-channel-thick-runner
adrs: [0004, 0005, 0006, 0007]
---

# PRD: Control-Loop Closeout — Actuator, Fleet Auth, and Residual Zeroing

## Problem Statement

The operator runs a data collection control system that can observe (rich sensors, PR-Control-2/C0-C2), decide (advisory evaluator, PR-Control-3), and record evidence (Evidence Ledger, PR-Control-3.5) — but cannot act. Every suggestion still requires the operator to notice it in the UI and intervene by hand, and the decision loop itself only runs while the UI is polling: close the browser and the system goes blind. Meanwhile the system is about to be reachable from the whole NetBird fleet LAN with no authentication, including a channel that executes arbitrary binaries. A handful of known residuals (per-source objectives not storable, sources without measurement history showing no trend, three frontend gaps from PR #4 review, CLI ctrl+c handling, a hanging gitea push) keep the phase from being honestly closeable.

## Solution

Close the control loop and the phase in one closeout:

1. **Actuator + Control Cycle (PR-Control-4).** A dedicated background Control Cycle measures every source on a fixed period, records decisions to the Evidence Ledger, judges pending outcomes, and — only in Automatic Mode, only when the per-(state, action_type) evidence gate passes — executes whitelisted safe actions. Dangerous suggestions get the Require-Review Downgrade (ADR-0004). Automatic Mode ships default-off; the gate is enforced in code, so flipping the mode on later requires no code change (ADR-0007).
2. **Fleet-LAN auth.** Static bearer token on every API endpoint plus a default-empty binary allowlist on the CLI channel (ADR-0005).
3. **Residual zeroing.** Per-source objective storage, trend fallback for pre-measurement sources, topology ODP node + action history UI, the three PR #4 frontend review gaps, CLI ctrl+c handling, and the gitea push credential fix. Deferred items are recorded, not silently dropped (ADR-0006; heartbeat producer and error-kind histogram go to backlog).

After this closeout the codebase has no known debt in the control domain: the loop is complete (observe → decide → act → verify → adapt), and opening Automatic Mode is a data-driven operational decision, not an engineering task.

## User Stories

1. As an operator, I want a background Control Cycle that runs whether or not any UI is open, so that the system keeps observing and deciding while I am away.
2. As an operator, I want the Control Cycle to judge pending Evidence Ledger outcomes on every period, so that Recovery Rate data accumulates without anyone requesting a report.
3. As an operator, I want the actuator to execute `increase_interval` on a rate-limited source automatically (in Automatic Mode), so that a misbehaving source backs off without my intervention.
4. As an operator, I want the actuator to execute `pause` with a TTL that auto-expires, so that a paused source resumes by itself instead of being forgotten forever.
5. As an operator, I want the actuator to execute `require_review` by flagging the source for me, so that sources needing human judgment surface in the UI instead of being silently acted on.
6. As an operator, I want suggestions for `force_cursor_rescan` and `switch_write_strategy` downgraded to a require-review flag, so that nothing automated ever mutates data integrity (ADR-0004).
7. As an operator, I want Automatic Mode gated per (state, action_type) bucket on minimum sample size and Recovery Rate from the Evidence Ledger, so that the system only automates decisions it has evidence for.
8. As an operator, I want Automatic Mode default-off with the gate enforced in code, so that turning it on later is a config flip and the gate still protects me.
9. As an operator, I want a global kill switch, so that I can stop all automatic execution instantly without hunting per-source settings.
10. As an operator, I want per-source-and-action cooldowns and a global actions-per-hour cap, so that the controller cannot oscillate or storm the system it supervises.
11. As an operator, I want action idempotency and in-flight dedup, so that the same unresolved state does not stack duplicate executions.
12. As an operator, I want every automatic execution written to the same Evidence Ledger as advisory suggestions (mode `automatic`, `executed=true`), so that one auditable record explains everything the controller ever did and why.
13. As an operator, I want the control-state endpoint to remain a pure read, so that opening the UI never triggers decisions or executions as a side effect.
14. As an operator, I want every API request to require a bearer token when the server listens beyond localhost, so that fleet-LAN reachability does not equal operability.
15. As an operator, I want the server to refuse to bind a non-localhost address without a token configured, so that I cannot accidentally expose an unauthenticated instance to the fleet.
16. As an operator, I want the CLI channel to execute only binaries on a configured allowlist that defaults to empty, so that even a stolen token does not grant arbitrary code execution.
17. As an operator, I want the frontend to send the token automatically once configured, so that auth does not add friction to daily use.
18. As an operator, I want to set a per-source objective override and see it applied in control-state classification and outcome judgment, so that a source with unusual tolerances is not misclassified by the global default.
19. As an operator, I want sources that predate the measurement table to still show a trend derived from their run history, so that older sources are not second-class in the control view.
20. As an operator, I want the topology canvas to show the ODP system as a node with its live state, so that shared-plane backpressure is visible where I already look.
21. As an operator, I want an action history view showing Evidence Ledger rows (suggestion vs executed, outcome verdicts), so that I can audit what the controller suggested and did over time.
22. As an operator, I want the three frontend gaps flagged in PR #4 review closed, so that the phase carries no known review debt.
23. As an operator, I want the CLI to handle ctrl+c cleanly, so that interrupting a run does not leave orphaned state.
24. As an operator, I want the repo pushed to the gitea remote again, so that my self-hosted mirror is not stale.
25. As a future maintainer, I want deferred items (heartbeat producer, error-kind histogram, crawl4ai call-time SSRF) recorded in ADRs/backlog, so that "not done" is always distinguishable from "forgotten".
26. As a future maintainer, I want the actuator's gate thresholds and cycle period as configuration, so that tuning the controller never requires a code change.

## Implementation Decisions

- **Control Cycle** is a new module in the backend control layer: an asyncio background task started/stopped in the app lifespan, period configurable (default 60s). Each tick, its body function runs: measure every source through the existing aggregation path → evaluate → record to the Evidence Ledger (existing recorder, existing dedup) → judge ripe pending outcomes (existing `evaluate_pending_outcomes`) → if gates allow, execute. The body is a plain async function taking a session and `now`, so it is directly invocable in tests; the asyncio wrapper stays thin. It deliberately does NOT reuse the collection scheduler (ADR-0007).
- **Actuator** executes exactly three whitelisted actions: `increase_interval` (bounded multiplicative backoff on the source's schedule), `pause` (with TTL; the Control Cycle auto-resumes expired pauses), `require_review` (sets a review flag on the source, surfaced in UI). Suggestions outside the whitelist execute as `require_review` instead — the Require-Review Downgrade — with the original suggestion preserved in the ledger row (ADR-0004).
- **Execution gate**, all conditions AND-ed, evaluated per execution: global kill switch off; `CONTROL_MODE=automatic`; the (state, action_type) bucket in the advisory report has `samples >= control_gate_min_samples` (default 10) and `recovery_rate >= control_gate_min_recovery_rate` (default 0.6); per-(source, action_type) cooldown elapsed; global max-actions-per-hour not exhausted; no identical in-flight/unresolved executed row for the same (source, action_type, state).
- **Kill switch** is a config setting plus a runtime API toggle (in-memory, resets to the configured value on restart — single-operator fleet does not need persistence).
- **Evidence Ledger reuse**: executed actions are new rows in the existing `control_actions` table with `mode="automatic"`, `executed=True`; outcome judgment applies to them identically. No new ledger table.
- **Auth** is a FastAPI middleware validating a single static bearer token from settings on every `/api` route; startup refuses a non-localhost bind without a token. The frontend reads the token from its build/runtime config with a local-storage override. MCP server (separate stdio process) is out of the middleware's path and unaffected.
- **CLI allowlist** is enforced in the CLI channel before execution: configured list of absolute binary paths, default empty meaning deny-all; violation is a permanent (non-retryable) error through the existing error taxonomy.
- **Per-source objective** is stored as a nullable JSON override on the data source, merged over the default `SourceObjective`; the control-state endpoint, Control Cycle, and outcome judgment all resolve it through one shared helper (replacing the two documented "objective overrides not stored yet" comment sites). Exposed via a PATCH-style sources API and included in the control-state response. Requires a migration.
- **Trend fallback**: when a source has no measurement rows, trend is derived from recent task-run history via the existing PR-Control-2 fallback path instead of returning no trend; the response keeps signalling which path produced it (coverage stays honest).
- **Topology ODP node** renders from the existing odp-state endpoint through the existing node-kit registry (reuse ControlBadge/SensorCoverageBadge patterns); **action history** is a new read-only view over a ledger listing endpoint (filter by source, mode, outcome).
- **Frontend gaps ×3 and CLI ctrl+c**: scope is defined by the PR #4 review findings that were deliberately deferred ("scope外") — the implementing issue recovers the exact three findings from the PR #4 review threads before coding.
- **gitea push** is an environment/credential task, not code: diagnose the hang (credential/cert prompt), fix durably, push the branch. Credentials come from the operator, not from filesystem excavation.
- Everything lands on the existing working branch; Automatic Mode and the kill switch ship in the safe position (advisory, off).

## Testing Decisions

- Tests assert external behavior only: HTTP responses, ledger rows, data-source field changes, emitted events — never internals of the cycle or actuator.
- **Primary seam — HTTP API integration** (existing async-client integration suite): auth middleware (401 without token, 200 with, localhost/no-token dev posture, non-localhost bind refusal), advisory report, objective PATCH + its effect on control-state, ledger listing endpoint, kill-switch toggle.
- **Only new seam — the Control Cycle body function**, invoked directly with an injected session and `now` (same pattern as the existing outcome-evaluation tests): gate math per bucket, cooldown/rate-cap/dedup behavior, TTL pause expiry and auto-resume, Require-Review Downgrade, ledger rows for executed actions, kill-switch short-circuit. The asyncio wrapper gets a start/stop smoke test only.
- **Existing channel unit seam**: CLI allowlist (empty=deny-all, listed binary passes, unlisted rejected as permanent error), ctrl+c handling.
- **Existing frontend node --test seam**: data-mapping logic for the ODP topology node and action history view; visual verification is manual QA.
- Zero-mutation guarantee stays: the existing test asserting `GET control-state` never mutates a data source must keep passing byte-identically in advisory mode; a mirror test asserts the Control Cycle in advisory mode writes ledger rows but never mutates a data source.
- Prior art: the control API integration tests, the sources API zero-mutation test, the ledger/outcomes unit tests, contract tests for channels.
- Acceptance bar per issue: full pytest suite green, coverage gate (≥80%) holds, single alembic head.

## Out of Scope

- Executing `force_cursor_rescan` or `switch_write_strategy` — permanently out until ADR-0004 is revisited; they surface as suggestions only.
- odp-store heartbeat producer (Rust) and error_kinds per-item histogram — deferred to backlog; sensors keep reporting `unavailable` honestly.
- crawl4ai call-time SSRF workaround — risk accepted (ADR-0006).
- Multi-user auth, sessions, roles — single-operator fleet (ADR-0005).
- Actually operating the system to accumulate advisory evidence and flipping Automatic Mode on — an operational act after closeout, not an engineering task.
- Redis-backed cross-worker rate limiting / domain concurrency upgrades.

## Further Notes

- Vocabulary per CONTEXT.md Control section: Advisory Mode, Automatic Mode, Actuator, Evidence Ledger, Recovery Rate, Require-Review Downgrade, Control Cycle.
- Sequencing: auth, residuals, and UI are independent of the actuator and can proceed in parallel; the Control Cycle issue is the largest and should not be split mid-loop (gate + actuator + cycle are one coherent unit).
- The gitea push issue needs operator-supplied credentials; the implementing agent must ask, not excavate.
- Deployment note: once auth lands, starting the server on the fleet requires `API_AUTH_TOKEN` (name per existing settings conventions) in the environment.
