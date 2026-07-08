# 05 — Multi Source OpenCLI HDA tracer

Labels: ready-for-agent
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Build the first real executable HDA: a Multi Source OpenCLI package node that fans out to multiple OpenCLI site/command tasks and dispatches them through the existing III collector-opencli path. This is the first end-to-end proof that an HDA node can drive real multi-source browser-native collection without rewriting the backend adapters.

The tracer should support a narrow, configurable set of source entries and carry workflow/run/node/source identifiers into the III payload so later event streams and projections can attach results back to Canvas nodes.

Scope guard: HDA source entries are declarative source-slot configs. `site`, `command`, and `args` in III payloads must be produced by catalog templates, the HDA materializer, or runtime resource resolution over existing OpenCLI adapter metadata. Users and AI patches must not be asked to provide `rawOpencliCommand`, cookie/profile/session values, or worker policy fields in node params. Missing resource resolution should emit a structured blocked/missing-resource reason, not mark the node runnable.

## Acceptance criteria

- [x] Multi Source OpenCLI HDA compiles into multiple OpenCLI task bindings.
- [x] Each OpenCLI task dispatches through existing III collector-opencli semantics.
- [x] III payloads include workflow run id, package node id, internal node id where applicable, source group, site, command, args, and trace id.
- [x] ODP ingest continues to use existing Record v2/OpenCLI mapping.
- [x] Tests cover fanout compilation, III payload shape, OpenCLI/ODP reuse, and no direct rewrite of OpenCLI adapter behavior.
- [x] Tests reject hand-rolled executor/raw OpenCLI command patches before they reach runtime dispatch.

## Blocked by

- 02 — HDA/package node compile support
- 04 — Node Runtime Registry
