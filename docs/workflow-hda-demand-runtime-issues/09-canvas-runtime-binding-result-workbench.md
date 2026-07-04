# 09 — Canvas runtime binding and result workbench

Labels: ready-for-agent
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Wire the frontend Canvas to the real workflow runtime. The user should be able to submit or accept an AI WorkflowProject patch, run the workflow, watch node statuses update on the existing Canvas, inspect run trace details, and view evidence/cluster/result projections.

This slice should reuse existing WorkflowProject, React Flow, Zustand node data, RunTrace-style panel, sourceAnchor, and runArtifact surfaces. The Canvas must remain the workflow spine; this is not a separate monitoring graph.

## Acceptance criteria

- [ ] Frontend can apply/review an AI WorkflowProject patch.
- [x] Frontend can trigger a compiled workflow run.
- [x] Frontend subscribes to node run events and patches existing Canvas nodes.
- [x] Run trace panel shows real runtime events instead of only local simulation for this path.
- [ ] Result workbench shows evidence batches, clusters, partial results, missing sources, and node-linked artifacts.
- [ ] Frontend tests cover patch reducer, event-to-node-status reducer, and result projection view model.

## Implementation note

- Canvas Run now uses the backend workflow run axis instead of local run artifacts.
- Run Trace shows `WorkflowRunProjection`, latest SSE node events, blocked reasons, batch counts, and item counts.
- Node state patching handles both top-level nodes and HDA internals by mapping backend `package::internal` runtime ids onto visible Canvas `package__internal` node ids.

## Blocked by

- 03 — AI WorkflowProject patch API
- 06 — Node run event stream
- 07 — EvidenceBatch and projection API
