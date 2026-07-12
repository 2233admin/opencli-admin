---
title: Ship the end-to-end collection golden path
label: wayfinder:map
tracker: local-markdown
---

## Destination

Produce an implementation-ready specification for the first usable end-to-end collection path: a user creates a Project and Collection Request, runs the resulting Workflow on a compatible local or remote Worker, preserves evidence and derived data, publishes a Data Feed, queries it with a freshness bound, and resolves operational exceptions through Overview, Live Canvas, and Inbox.

## Notes

- Canonical domain language lives in [CONTEXT.md](../../../CONTEXT.md); settled architecture lives in [ADRs](../../adr/).
- Use the research notes in [docs/research](../../research/) rather than repeating third-party investigation.
- UX is the first-order constraint. The engine remains node-based and hardware/vendor neutral.
- This map plans decisions. Execution follows through `to-spec`, `to-tickets`, and one `implement` ticket at a time.

## Decisions so far

- [Audit the existing golden-path seams](audit-existing-golden-path-seams.md) — Reuse the canvas/compiler/run-event and reverse-Worker foundations; add the missing persistent product backbone and converge legacy facts through adapters.
- [Prototype the collection-to-consumption journey](prototype-collection-to-consumption-journey.md) — Keep the familiar Dify-style application journey and operations dashboard, backed by a deeper packaged Node system; collection is the first vertical rather than the product boundary.

## Not yet specified

- The first production integration set depends on the minimum quality gates and the capability placement contract.

## Out of scope

- Cross-Workspace Signal federation and a public Integration marketplace.
- Implementing or redistributing the EigenFlux or Hyperspace network runtimes.
- Exhaustive text, image, audio, and video integrations in the first vertical slice.
- Hardware-specific product modes such as a Mac cluster, RTX 3080 mode, or RTX 5080 mode.

## Child tickets

- [Audit the existing golden-path seams](audit-existing-golden-path-seams.md)
- [Prototype the collection-to-consumption journey](prototype-collection-to-consumption-journey.md)
- [Define the persistent golden-path facts](define-persistent-golden-path-facts.md)
- [Resolve heterogeneous Worker placement and fallback](resolve-worker-placement-and-fallback.md)
- [Define golden-path search and evidence quality gates](define-search-evidence-quality-gates.md)
- [Bridge the legacy collection pipeline into Workflow Runs](bridge-legacy-pipeline-into-workflow-runs.md)
- [Converge Gate, Finding, and Inbox facts](converge-gate-finding-inbox-facts.md)
