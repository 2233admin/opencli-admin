# 04 — Node Runtime Registry

Labels: ready-for-agent
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Introduce a central Node Runtime Registry that maps compiled node kind/capability/adapter metadata to runtime executor bindings. This prevents execution logic from being scattered across API handlers, frontend assumptions, and adapter-specific code.

For this slice, the registry must prove the OpenCLI path: OpenCLI collection nodes resolve to the existing III/OpenCLI execution binding, while unsupported nodes produce structured missing-runtime errors.

## Acceptance criteria

- [x] Runtime registry resolves node metadata to a runtime binding object.
- [x] OpenCLI source/HDA nodes resolve to an III collector-opencli binding.
- [x] Unsupported nodes fail with structured missing-runtime information.
- [x] The registry does not replace OpenCLIChannel, III collector-opencli, or ODP mapper.
- [x] Tests cover OpenCLI resolution, unsupported node rejection, and registry use from compiled plan output.

## Blocked by

- 01 — WorkflowProject compile entrypoint
