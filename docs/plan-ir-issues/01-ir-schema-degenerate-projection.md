# 01 — Prefactor: Plan IR schema + degenerate-plan projection

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0008/0009)

## What to build

The Plan IR itself: a versioned JSON schema for graphs — nodes (source / transform /
merge / sink) with typed params and port-referenced edges — plus structural
validation (cycles, orphan merges, missing required params, port type mismatches)
that reports node-anchored errors. Expose two read-only things: the documented IR
schema (agents author Plans through it, story 27) and a projection endpoint that
renders any existing Data Source as its degenerate single-node Plan (story 18 — the
zero-migration bridge; pure function of the source's channel config, no persistence).

## Acceptance criteria

- [ ] IR schema is versioned and documented as an API contract
- [ ] Validation rejects cyclic graphs, orphan merges, missing required params, and port type mismatches, each with a node-anchored error payload
- [ ] Any existing source (every channel type) projects to a valid single-node Plan via the read-only endpoint; the projection round-trips against the IR validator
- [ ] Source nodes carry a source_id reference or an explicit draft marker; transforms/merges/sinks carry no entity references
- [ ] HTTP-seam tests cover schema fetch, valid/invalid graph validation, and degenerate projection for all channel types

## Blocked by

None - can start immediately
