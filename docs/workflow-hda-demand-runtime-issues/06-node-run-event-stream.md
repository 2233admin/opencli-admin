# 06 — Node run event stream

Labels: ready-for-agent
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Add the node-level run event stream needed by the Canvas and AI clients. Execution should emit events that describe graph progress at node granularity: queued, started, blocked, batch ready, partial, completed, and failed. Events must carry node ids from the compiled WorkflowProject so the frontend can patch existing Canvas nodes rather than render a separate fake graph.

This slice should expose an API stream for a workflow run and a small persisted or replayable enough run state projection for clients joining late.

## Acceptance criteria

- [x] Runtime emits node lifecycle events with workflow run id and node id.
- [x] Blocked events include structured block reasons.
- [x] Batch-ready events include counts and batch/ODP references without raw record payloads.
- [x] Clients can subscribe to a run event stream.
- [x] Tests cover event shapes, node-id preservation, blocked reason, batch-ready event, and late-read projection.

## Blocked by

- 04 — Node Runtime Registry
- 05 — Multi Source OpenCLI HDA tracer
