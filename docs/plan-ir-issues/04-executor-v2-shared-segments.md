# 04 — Plan executor v2: shared segments + Two-Tier Attribution

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0009)

## What to build

Multi-source execution: a Plan with several source nodes wired through a merge into
sequential server-side transforms and a store sink. Transform set v1 is deliberately
minimal: merge, dedupe, store. Every item flowing through a shared segment carries
source-tagged provenance. Shared-segment execution records Plan Health (per plan
node, its own storage) — and NEVER writes into any source's measurement or control
state (stories 7, 12, 15, 16, 17; the Two-Tier Attribution contract of ADR-0009).

## Acceptance criteria

- [ ] A two-source Plan (merge → dedupe → store) runs end-to-end via the manual run endpoint
- [ ] Stored records from shared segments carry source-tagged provenance
- [ ] Plan Health rows are recorded per shared node (success/failure/duration) and readable over HTTP
- [ ] HARD TEST: a shared-segment failure (e.g. dedupe raises) records Plan Health failure and leaves every upstream source's measurements/control-state byte-identical to before the run
- [ ] Source segments in a multi-source Plan still produce normal per-source TaskRuns/measurements
- [ ] Executor-seam tests cover ordering, provenance, partial failure (one source fails, other proceeds), and the attribution contract

## Blocked by

- 03-executor-v1-degenerate-run
