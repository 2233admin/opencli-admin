# 02 — Plans table + CRUD

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0009)

## What to build

Persistence for authored Plans: a plans table storing the graph JSON plus
name/version/draft state, and CRUD endpoints following the repo's list/detail
conventions. Saving validates through the issue-01 validator and returns 422 with
node-anchored errors on invalid graphs. Draft semantics: a Plan containing Draft
Source Nodes (no source_id yet) may be saved but is marked draft and reported as
such; draft source nodes never enter the control loop (stories 8, 9, 27).

## Acceptance criteria

- [ ] Create/read/update/delete/list Plans over HTTP with the standard ApiResponse/pagination envelope
- [ ] Save rejects invalid graphs with 422 + node-anchored error details (reuses issue-01 validation)
- [ ] A Plan with unmaterialized Draft Source Nodes saves successfully and is flagged draft; materialized-only Plans are flagged runnable
- [ ] Version increments on update; graph JSON round-trips byte-faithfully
- [ ] Single alembic head; migration adds only the plans table
- [ ] HTTP-seam tests cover CRUD, draft flagging, validation failure, pagination

## Blocked by

- 01-ir-schema-degenerate-projection
