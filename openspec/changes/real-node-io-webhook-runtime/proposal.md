## Why

Canvas can now assemble HDA source slots, but the remaining runtime boundary is still easy to misread as hand-filled node configuration. The next change must make user demand input, adapter/source resolution, webhook ingress, EvidenceBatch output, and Canvas run state part of one real node contract instead of separate mock or mini surfaces.

## What Changes

- Define a real runtime I/O contract for workflow nodes: user need input, trigger/webhook input, adapter source input, normalized EvidenceBatch output, node run events, and blocked/missing-resource states.
- Require cookie, profile, worker pool, and raw OpenCLI command selection to be resolved through existing adapter/catalog/runtime metadata, not typed by the user or embedded in node params.
- Bind Canvas nodes, inspector forms, mini/full render states, run result, and trace panels to backend catalog/runtime contracts.
- Treat unsupported or unresolved nodes as blocked with structured reasons instead of silently rendering schedule defaults or fake runnable nodes.
- Keep existing 07/08/09 issue docs aligned with this contract and ready for agent execution.

## Capabilities

### New Capabilities

- `real-node-runtime-io`: Covers real workflow node inputs, implicit adapter/resource resolution, webhook ingress, runtime event linkage, and EvidenceBatch outputs.
- `canvas-runtime-binding`: Covers Canvas catalog projection, node rendering, inspector schema binding, mini/full states, run status patches, result panels, and trace attachment.

### Modified Capabilities

- None.

## Impact

- Backend workflow runtime registry, capability projection, compile API, webhook/run APIs, EvidenceBatch projection, and integration tests.
- Frontend workflow catalog, node internals, Canvas node cards, inspector binding, result workbench, trace panels, and run-state patch application.
- Existing docs in `docs/workflow-hda-demand-runtime-issues/07-evidencebatch-projection-api.md`, `08-browser-worker-profile-concurrency.md`, `09-canvas-runtime-binding-result-workbench.md`, `docs/workflow-hda-demand-runtime-io-webhook-linkage.md`, and `docs/workflow-node-capability-mapping.md`.
