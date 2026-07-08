# 03 — Plan executor v1: degenerate plans really run

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0009)

## What to build

The backend Plan executor, first cut: a manual run endpoint plus the executor body
function (the NEW test seam, precedent = Control Cycle body). Scope: single-source
(degenerate) Plans only — executing one must invoke the existing channel/runner
machinery and produce TaskRuns/records exactly as a direct source trigger does
today. This is the proof that the graph is the program without touching execution
behavior (stories 10, 13, 14, 18).

## Acceptance criteria

- [ ] Manual whole-plan run endpoint exists; draft Plans are refused with a clear error
- [ ] Running a degenerate Plan produces TaskRun/records indistinguishable in shape from today's direct source trigger
- [ ] ZERO-REGRESSION HARD ASSERTION: existing per-source control tests pass unmodified; per-source measurements/control-state produced via a plan run are unchanged in shape
- [ ] Executor body function is directly invokable in tests (deterministic, no scheduler timing)
- [ ] Executor-seam tests cover source-segment dispatch, error propagation, and refusal paths; HTTP-seam tests cover the run endpoint

## Blocked by

- 02-plans-table-crud
