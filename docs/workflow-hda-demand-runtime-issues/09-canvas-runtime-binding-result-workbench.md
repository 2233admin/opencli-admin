# 09 — Canvas runtime binding and result workbench

Labels: ready-for-agent, contract-hardened
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Wire the frontend Canvas to the real workflow runtime. The user should be able to submit or accept an AI WorkflowProject patch, run the workflow, watch node statuses update on the existing Canvas, inspect run trace details, and view evidence/cluster/result projections.

This slice should reuse existing WorkflowProject, React Flow, Zustand node data, RunTrace-style panel, sourceAnchor, and runArtifact surfaces. The Canvas must remain the workflow spine; this is not a separate monitoring graph.

The product shell for this spine is Build. `/build/workflow` is the canonical route; primary navigation exposes only Build, while `/canvas` and `/studio` are compatibility redirects. ResultWorkbench and Run Trace stay inside the same WorkflowEditor tree rather than becoming independent pages.

## Contract

The Canvas input point is a real node, not a side panel prompt. `intelligence.input.collection-need` must remain visible and editable as the user demand entrypoint. A user text such as "抓小红书热帖" is the business need; it must call demand-draft and assemble existing catalog/runtime nodes. It must not ask the user to fill OpenCLI command strings, cookie material, concrete profile ids, or worker policy.

Patch and run behavior:

- AI/user patches must apply to the existing WorkflowProject graph and preserve node ids.
- Patches may only create/update known catalog or primitive nodes accepted by the backend registry.
- Patches must be rejected if they include hand-rolled executor definitions, raw OpenCLI commands, cookie/profile/session secrets, or unknown adapter ids.
- `/api/workflow/run` must require the current WorkflowProject payload. Invalid or missing project payloads should return `400`; it must not fall back to fixture/demo workflows.
- Run state must come from backend `/api/v1/workflows/runs`, `/events/stream`, and projection APIs.

Result workbench behavior:

- It reads issue `07` projection APIs by `runId`, `nodeId`, `sourceGroup`, and `batchId`.
- It shows evidence batch summaries, clusters, partial/failure states, missing sources, and node-linked artifacts.
- It links every displayed result back to a visible Canvas node or HDA internal trace id.
- It does not push raw evidence records through SSE or webhook responses.

## Acceptance criteria

- [ ] Frontend can apply/review an AI WorkflowProject patch.
- [ ] `intelligence.input.collection-need` is visible, editable, miniaturizes correctly, and is the only demand text entrypoint for this path.
- [ ] Demand-draft patches assemble existing real nodes and reject raw executor/OpenCLI command/cookie/profile/worker fields.
- [ ] `/api/workflow/run` rejects missing/invalid WorkflowProject payloads instead of running a fixture workflow.
- [x] Frontend can trigger a compiled workflow run.
- [x] Frontend subscribes to node run events and patches existing Canvas nodes.
- [x] Run trace panel shows real runtime events instead of only local simulation for this path.
- [ ] Result workbench shows evidence batches, clusters, partial results, missing sources, and node-linked artifacts.
- [ ] Frontend tests cover patch reducer, demand node input, invalid run payload rejection, event-to-node-status reducer, and result projection view model.

## Implementation note

- Canvas Run now uses the backend workflow run axis instead of local run artifacts.
- Run Trace shows `WorkflowRunProjection`, latest SSE node events, blocked reasons, batch counts, and item counts.
- Node state patching handles both top-level nodes and HDA internals by mapping backend `package::internal` runtime ids onto visible Canvas `package__internal` node ids.

## Blocked by

- 03 — AI WorkflowProject patch API
- 06 — Node run event stream
- 07 — EvidenceBatch and projection API

## Runtime verification

```powershell
npm run typecheck:frontend
npm run lint:frontend
npm run build:frontend
```

Route smoke checks must prove `/build/workflow` renders the editor and `/canvas`, `/studio`, and `/` redirect to it. Frontend assertions must also cover event-to-node and projection-to-node/edge patching, EvidenceBatch result summaries, blocked/missing reasons, and the absence of separate Workflow/Canvas primary navigation entries.
