# Data Node IDE convergence workflow

## Product boundary

OpenCLI Admin is a data-node execution IDE centered on **collect → transform → deliver**. Automation and multi-agent execution reuse the same node runtime; they do not form a second engine.

## Evidence workflow

1. Inventory promises from conversation, Wayfinder, ADRs, and existing code.
2. Mark each promise as implemented, partial, or missing with file evidence.
3. Prefer compatibility-preserving changes that reuse the current canvas, shell, compiler, adapters, and pages.
4. Implement one dependency-ordered vertical slice at a time.
5. Do not call a prototype resolution or installed component a production implementation.

## Delivery order

- [x] Reframe the existing sidebar as a dense data-node IDE without moving routes.
- [x] Add persistent `Project → WorkflowDraft → immutable WorkflowVersion`.
- [x] Pin versioned WorkflowRuns to a concrete WorkflowVersion while preserving the legacy stateless run path.
- [ ] Migrate Automation from `executor` JSON to versioned entrypoint references.
- [ ] Add canonical Artifact and minimal Data Feed publish/read path.
- [ ] Add durable Gate facts and make Inbox their projection.
- [ ] Model Agent invocation as a workflow node; multi-agent execution becomes normal graph composition.
- [ ] Add Dify import beside the existing n8n compatibility path.
- [ ] Add real processing and delivery workspaces before exposing empty top-level navigation.
- [ ] Bind Switchboard Card to real overview facts; do not use random lights as fake telemetry.
- [ ] Execute the deferred [performance-driven Rust offload](../performance-driven-rust-offload/README.md) PRD only after profiling proves an SLO miss.

## Non-goals

- No second workflow or multi-agent engine.
- No rewrite of the mature React Flow canvas.
- No forced Agent dependency for deterministic collection, cleaning, or delivery.
- No fake Marketplace, knowledge base, processing, or delivery pages before their underlying assets exist.
