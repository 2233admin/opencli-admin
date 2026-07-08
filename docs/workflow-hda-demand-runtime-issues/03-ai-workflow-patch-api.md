# 03 — AI WorkflowProject patch API

Labels: ready-for-agent
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Create the structured AI-facing workflow edit API. The AI may select existing nodes, connect nodes, update parameters, and package selected small nodes into an HDA node. The AI may not create primitive node implementations, backend executors, raw III payloads, raw OpenCLI commands, or arbitrary adapters.

The API should return a reviewable WorkflowProject patch and validation result. If the AI requests a missing capability, the system should return a missing-capability record rather than inventing a node.

## Acceptance criteria

- [x] AI patch schema supports add existing node, connect nodes, update parameters, and package selected nodes.
- [x] Patch validation rejects primitive creation, executor creation, raw III payloads, raw OpenCLI commands, and unknown adapters.
- [x] Missing capabilities are reported as explicit missing-capability outputs.
- [x] A valid patch can be applied to a WorkflowProject and compiled by the compile endpoint.
- [x] Tests cover allowed edits, forbidden edits, missing capability reporting, and compile-after-patch.

## Blocked by

- 01 — WorkflowProject compile entrypoint
- 02 — HDA/package node compile support
