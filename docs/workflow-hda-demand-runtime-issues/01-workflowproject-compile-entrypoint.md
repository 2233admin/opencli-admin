# 01 — WorkflowProject compile entrypoint

Labels: ready-for-agent
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Create the first backend seam that accepts a Canvas-authored WorkflowProject as the authoritative workflow input and compiles it into an executable plan shape without dispatching real workers. This is the tracer bullet that proves the Canvas graph is not a fake projection: the same graph the user edits can be validated, compiled, and returned with node ids preserved for later runtime events.

The slice should reuse the existing Plan IR vocabulary where possible, but it must preserve WorkflowProject/HDA-facing concepts needed by the frontend: node ids, adapter bindings, public parameters, package markers, source anchors, and run artifact anchors.

## Acceptance criteria

- [x] A backend API accepts a WorkflowProject-like graph payload and returns a compiled executable-plan preview with stable node ids.
- [x] The compiler rejects malformed graphs with node-anchored validation errors that the Canvas can render in place.
- [x] The compiled plan distinguishes authoring graph data from runtime execution metadata.
- [x] Existing Plan IR and source/task behavior remains compatible; this is additive.
- [x] Tests cover valid compile, invalid graph, missing adapter binding, and node-id preservation.

## Blocked by

None - can start immediately
