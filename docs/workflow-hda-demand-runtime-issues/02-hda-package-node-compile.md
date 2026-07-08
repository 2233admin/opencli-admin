# 02 — HDA/package node compile support

Labels: ready-for-agent
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Extend the compile path so package/HDA nodes are executable encapsulations, not visual labels. A package node should expose public parameters, carry locked/unlocked internals metadata, and compile into its internal small-node graph while preserving the outer package node as the observable runtime anchor.

This slice should support the Houdini-style model: package internals can be inspected and eventually edited, but the compiled runtime can still report status on both the outer package and selected internal nodes.

## Acceptance criteria

- [x] A package/HDA node can declare public parameters mapped into internal node parameters.
- [x] The compiler expands package internals into executable internal nodes while preserving the outer package node id.
- [x] Locked internals remain compileable but are marked as non-editable metadata for AI/frontend consumers.
- [x] Invalid parameter bindings fail with node-anchored errors.
- [x] Tests cover package expansion, public parameter binding, locked internals, and invalid binding rejection.

## Blocked by

- 01 — WorkflowProject compile entrypoint
