# 08 — Collection Canvas observe lens + plan runs

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0008)

## What to build

The second lens on the same canvas: toggling to observe overlays the existing
control badges (per-source control state, sensor coverage) and live run states onto
the Plan graph — source nodes show their per-source truth, shared nodes show Plan
Health. A run button triggers the manual plan run (issue 03/04) and node-level
execution states stream/poll onto the graph as the backend run progresses. Plan runs
surface in the Run Inbox like any other run (stories 13, 20, 28). i18n discipline
applies.

## Acceptance criteria

- [ ] Edit/observe lens toggle on one canvas — no separate page
- [ ] Observe lens shows per-source control badges on source nodes and Plan Health on shared nodes (honest degraded/unknown states, never fake healthy)
- [ ] Run button executes a runnable Plan via the backend and reflects per-node backend execution state on the graph (running/success/error)
- [ ] Draft Plans show a disabled run affordance with the reason
- [ ] Plan runs appear in the Run Inbox / task views like normal runs
- [ ] View-model logic (backend run → node state projection, lens state) covered by node --test; all new strings via t()

## Blocked by

- 03-executor-v1-degenerate-run
- 07-canvas-edit-lens
