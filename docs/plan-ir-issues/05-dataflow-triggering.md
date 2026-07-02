# 05 — Dataflow triggering

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0009)

## What to build

Wire Plans into the live scheduling world with dataflow semantics: schedules stay
attached to sources (zero migration); when any source node's scheduled collection
delivers new data, the downstream shared segment of every runnable Plan containing
that source runs incrementally over just that delivery, with provenance intact.
No plan-level cron. Two sources on different cadences in one Plan must coexist
without lockstep (stories 11, 12).

## Acceptance criteria

- [ ] A scheduled (or manually triggered) source delivery causes the downstream shared segment to run incrementally for that delivery only
- [ ] Two sources with different cadences in one Plan each trigger the shared segment independently; no whole-plan lockstep
- [ ] Sources not part of any runnable Plan behave exactly as today (no new behavior)
- [ ] Incremental runs record Plan Health and provenance identically to manual runs
- [ ] Executor-seam tests cover incremental trigger, dedupe across successive deliveries, and no-plan sources; HTTP-seam test observes an end-to-end scheduled flow

## Blocked by

- 04-executor-v2-shared-segments
