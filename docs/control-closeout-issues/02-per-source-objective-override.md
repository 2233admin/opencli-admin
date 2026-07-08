---
labels: ready-for-agent
---

# 02 — Per-source objective override

## Parent

docs/control-closeout-PRD.md

## What to build

Let the operator store a per-source objective override so a source with unusual tolerances is not misclassified by the global default `SourceObjective`. Store it as a nullable JSON column on the data source (migration required). Add one shared resolve helper (override merged over defaults) and use it at BOTH consumption sites — the control-state decision path (via issue 01's service function) and the outcome judgment pass. Both sites currently carry "per-source objective overrides are not stored yet" comments; this issue removes them.

Expose the override through a PATCH-style sources API (set, update, clear with null) with field validation against the objective schema, and include the resolved objective in the control-state response so the operator can see what classification is actually using.

## Acceptance criteria

- [ ] Migration adds nullable objective-override column; single alembic head preserved
- [ ] PATCH API sets/updates/clears the override; invalid objective fields rejected 422
- [ ] Control-state classification for a source with an override uses the merged objective (integration test proves a state flip that only the override explains)
- [ ] Outcome judgment uses the same resolve helper (unit test)
- [ ] Control-state response includes the resolved objective
- [ ] Both "not stored yet" comment sites are gone
- [ ] Full pytest suite green, coverage ≥80%

## Blocked by

- 01-prefactor-unified-decision-path

## Agent rules

- Do NOT use the Agent tool; write all code yourself
- Do NOT commit; leave changes in the working tree for the operator's acceptance gate
- Respect ADR-0004/0005/0006/0007 and CONTEXT.md Control vocabulary
- Run: `uv run --directory D:\projects\opencli-admin pytest` (full suite) before declaring done
