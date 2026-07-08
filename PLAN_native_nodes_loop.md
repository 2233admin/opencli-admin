# OpenCLI Admin Native Nodes Loop

> Status: completed first native-runtime loop
> Scope: first-loop native node system
> Related ADR: `docs/adr/0010-native-runtime-nodes-and-managed-external-graphs.md`

## Goal

Build the first durable loop of OpenCLI Admin's native node system: a real workflow can be assembled from packaged nodes, validated through capability availability and typed ports, run through the backend, merged with lineage, accepted into records through a gate, and inspected through run trace.

This loop is not a throwaway demo. It is the foundation that later LangGraph, LangChain, Pi, and other external runtimes must enter through.

## Definition of Done

A real workflow can run end to end:

`Packaged Source Node -> Normalize Transform -> Merge Node -> Record Acceptance Gate -> Record Sink -> Run Trace`

The first loop is done when all of these are true:

- Capability Catalog is the authoritative source for runnable node capabilities.
- Capability Manifest declares each packaged capability's schema, resources, permissions, runtime binding, trace mapping, and probes.
- Capability Availability reports whether each declared capability is ready, blocked, missing resources, missing dependencies, permission-gated, or probe-failed.
- Packaged Node Presets are discoverable by the Canvas and grouped by Node Preset Family.
- Typed Ports prevent incompatible edges and let AI assemble plans without glue code.
- At least one real Source preset runs against a real collection source.
- Normalize Transform produces Record Candidates from source output.
- Merge Node supports typed fan-in and preserves lineage.
- Record Acceptance Gate decides whether Record Candidates become Records.
- Record Sink writes accepted Records into the existing records system.
- Run Trace records node lifecycle, tool call events, artifacts, timing, errors, and lineage pointers.
- AI can generate a Plan Draft from an operator intent, but cannot run it until it is materialized and approved on the Canvas.

## First-Loop Node Families

### Source

- One real source preset backed by an existing OpenCLI Admin adapter or OpenCLI command.
- It must emit a typed Record Candidate stream or Runtime Artifact stream that can be transformed into candidates.

### Transform

- Normalize Transform.
- Artifact Transform only if the first source emits HTML, screenshots, or raw artifacts before candidates.

### Flow

- Merge Node with concat as the minimum strategy.
- The implementation must preserve lineage even for concat.

### Control

- Record Acceptance Gate.
- Basic schema and lineage checks are required; quality and manual review rules may start minimal.

### Sink

- Record Sink into the existing records table/system.

### Runtime Package

- Placeholder only in the first loop.
- LangGraph, LangChain, Pi, and other imported runtimes are future extension points and must not drive the first implementation path.

## Original Non-Goals For First Loop

These were the original boundaries before the long-task scope was expanded by
the OpenCLI Admin native-runtime decisions. They remain useful as historical
guardrails for the first minimal loop, but the current active scope now includes
external-runtime import as native OpenCLI nodes and durable run recovery.

- No LangGraph importer in the minimal first-loop slice.
- No LangChain importer in the minimal first-loop slice.
- No Pi executor.
- No full external-runtime checkpoint implementation in the minimal first-loop slice.
- No large site-node library.
- No frontend-only fake nodes.
- No direct primitive tool access for imported runtimes.

## Implementation Order

1. Audit the current workflow capability, registry, node catalog, trace, and records paths.
2. Align existing code with the domain model in `CONTEXT.md`.
3. Establish the Capability Manifest and Capability Availability shape.
4. Project the Capability Catalog to the frontend node palette.
5. Add or adapt Packaged Node Presets for the first source, normalize, merge, record acceptance, and record sink.
6. Enforce Typed Ports at plan compile/materialization time.
7. Implement Merge Node lineage.
8. Implement Record Acceptance Gate.
9. Wire Record Sink and Run Trace evidence for the full loop.
10. Add AI Plan Draft generation only after the catalog and typed ports are real.

## Verification

- Unit or integration tests must prove capability projection and availability.
- Compile/materialization tests must reject incompatible typed edges and unresolved resources.
- Runtime tests must execute the first-loop workflow and assert Records, lineage, and Run Trace events.
- Frontend smoke should show packaged presets from backend metadata rather than hardcoded fake palette nodes.

## Operating Rule

When implementation pressure creates a choice, prefer the smallest real end-to-end loop over adding more node types. A node that cannot be traced, typed, and materialized is not part of the first loop.

## Progress

### 2026-07-05

- Added first-loop native node vocabulary to `CONTEXT.md` and recorded ADR-0010.
- Added backend workflow schema support for `flow`, `control`, `sink`, `merge`, and `accept`.
- Added catalog/runtime bindings for:
  - `intelligence.flow.merge` -> `workflow.flow.merge`
  - `intelligence.control.record-acceptance` -> `workflow.gate.record-acceptance`
  - `intelligence.sink.records` -> `workflow.record-sink.records`
- Added frontend Packaged Node Presets and port contracts for Merge, Record Acceptance Gate, and Record Sink.
- Added compile tests proving the new native nodes project to runtime bindings and Plan IR ports.
- Verified focused backend tests, frontend typecheck, and ruff for touched Python files.

### 2026-07-05 Runtime Trace Slice

- Added standalone native Normalize runtime binding:
  - `intelligence.processing.normalize` -> `workflow.transform.normalize`
- Added run-trace behavior for native first-loop nodes:
  - Source fixture output emits typed `items[]` with lineage pointers.
  - Normalize consumes upstream items and emits `recordCandidate[]` trace details.
  - Merge consumes upstream candidates, emits strategy, typed input/output, and lineage-preservation details.
  - Record Acceptance Gate consumes merged candidates, emits schema, dedupe, lineage, accepted count, and review count details.
  - Record Sink consumes accepted records and emits target, write mode, stored refs, stored count, and lineage details.
- Updated HDA run projection so internal normalize is no longer a blocked missing-runtime node.
- Added `/api/v1/workflows/runs` integration coverage for a non-package native first-loop workflow.
- Verified deterministic item propagation through:
  - `Source fixtureItems -> Normalize -> Merge -> Record Acceptance Gate -> Record Sink`
- Verified focused backend tests, frontend typecheck, and ruff for the runtime trace slice.

### 2026-07-05 Record Sink Persistence Slice

- Wired `/api/v1/workflows/runs` to pass the request DB session into workflow run execution.
- Materialized workflow Source nodes into real `DataSource` rows when Record Sink needs ownership and no existing `sourceId` is bound.
- Materialized one `CollectionTask(trigger_type="workflow")` per origin Source node and workflow run.
- Updated Record Sink execution to group accepted Records by origin Source lineage, then persist through the existing `store_records` path.
- Preserved workflow lineage in stored record raw data and in Record Sink `storedRefs`.
- Added integration coverage proving:
  - `CollectedRecord` rows are written.
  - each row has real `source_id` and `task_id` ownership.
  - workflow lineage survives the sink boundary.

### 2026-07-05 AI Plan Draft Slice

- Extended reviewable workflow patch operations with `add_adapter` so AI drafts can add Source presets with real adapter bindings instead of hidden executor assumptions.
- Changed demand draft assembly from an OpenCLI HDA package shortcut to native OpenCLI Admin nodes:
  - OpenCLI Source preset
  - Normalize Transform
  - Merge Node
  - Record Acceptance Gate
  - Record Sink
- Demand drafts remain patches for Canvas review; they are compiled for validation but not dispatched by the draft endpoint.
- Added integration coverage for:
  - single-source demand draft generation into native nodes.
  - multi-source demand draft fan-in through Merge.
  - runtime bindings for normalize, merge, record acceptance, and record sink.

### 2026-07-05 Typed Port Gate Slice

- Added backend typed-port contracts for catalog-owned packaged presets:
  - OpenCLI Source Slot
  - Source Pool
  - Normalize
  - Dedupe
  - Merge
  - Record Acceptance Gate
  - Record Sink
  - Collection Output
  - Inbox Output
- Compile now rejects catalog-owned edges with invalid source ports, invalid target ports, or incompatible port types.
- Package internals are validated too, so locked HDA graphs cannot hide incompatible internal edges.
- Updated OpenCLI HDA template internals to use real port ids (`out -> in`) instead of type labels as port names.
- Aligned Collection Output to consume `recordCandidate[]`, matching native Normalize output.
- Added integration coverage proving:
  - incompatible `recordCandidate[] -> record[]` edges are rejected before materialization.
  - invalid typed port ids are rejected.
  - valid native first-loop and AI demand-draft graphs still compile.

### 2026-07-05 Source Batch Ingest Slice

- Added `WorkflowRunStartRequest.sourceOutputs` as an explicit runtime batch-ingest seam for external worker/source outputs.
- Workflow run execution now consumes `sourceOutputs[nodeId]` as typed `items[]` before checking node fixtures, bound tasks, or OpenCLI dispatch.
- Runtime source output lineage is marked with the `sourceOutputs` artifact so traces can distinguish external batch input from node-param fixtures and persisted task records.
- Added a workflow source-output ingestion boundary for Source nodes bound to an existing `taskId`, `collectionTaskId`, or `boundTaskId`.
- When a Source node has a bound task and a DB session is available, workflow run execution now loads that task's `CollectedRecord` rows as typed `items[]` before dispatching a new OpenCLI batch.
- Loaded source records carry lineage with:
  - source node id
  - source group
  - `collected_records` artifact marker
  - record id
  - task id
  - source id
- Downstream Normalize, Merge, Record Acceptance Gate, and Record Sink consume those bound task records through the same native node path as fixture-driven items.
- Added integration coverage proving a non-fixture workflow run can read real persisted task records, propagate them through the native first-loop chain, and write workflow-owned records through Record Sink.
- Added integration coverage proving request-level runtime source outputs can drive the same first-loop chain without `fixtureItems` in node params.
- Added `/api/v1/workflows/runs/{run_id}/source-outputs` continuation for source batches that arrive after a run has already started.
- Continuation merges late `sourceOutputs`, reruns the same WorkflowProject with the same run id and trace id, and appends new node events after the existing sequence.
- Added integration coverage proving a dispatch-first empty run can later continue with source outputs, append trace events, and persist records through the native sink chain.

### 2026-07-05 Capability Manifest Slice

- Extended capability projection rows with a structured `manifest` field.
- Added first-loop manifests declaring:
  - schema id
  - input and output typed ports
  - required resources
  - permissions
  - runtime binding
  - trace event mapping
  - probes
- Added manifests for:
  - Collection Need / demand draft
  - OpenCLI Source Slot
  - Source Pool
  - Normalize Transform
  - Merge
  - Record Acceptance Gate
  - Collection Output
  - Record Sink
- Updated frontend capability typing to accept capability manifests.
- Added capability API integration coverage proving manifest runtime binding, ports, resources, permissions, trace mapping, and probes are present for first-loop nodes.

### 2026-07-05 Persisted Run Trace Slice

- Added persisted workflow run trace tables:
  - `workflow_runs`
  - `workflow_run_events`
- Workflow runtime now persists:
  - original `WorkflowRunStartRequest`
  - latest `WorkflowRunProjection`
  - replayable node event payloads ordered by sequence
- `/api/v1/workflows/runs/{run_id}` and `/events` can recover from the database when the process-local run cache is empty.
- `/api/v1/workflows/runs/{run_id}/source-outputs` can continue a run from the persisted request/projection/events, then append the new replay sequence.
- Added integration coverage proving:
  - run trace rows are written.
  - projection and event replay survive clearing the in-memory cache.
  - late source-output continuation works after DB recovery.
- Added Alembic migration coverage with a temporary SQLite `upgrade head` run.

### 2026-07-05 Checkpoint And Trace Query Slice

- Added a durable workflow run checkpoint descriptor derived from persisted request, projection, and event sequence.
- Added `/api/v1/workflows/runs/{run_id}/checkpoint` so Canvas and AI agents can recover:
  - run id
  - trace id
  - checkpoint id
  - latest global sequence
  - node states
  - source-output resume summary
  - continuation and trace query paths
- Added `/api/v1/workflows/runs/{run_id}/trace` with query filters:
  - `afterSequence`
  - `nodeId`
  - `eventType`
  - `limit`
- Extended `/api/v1/workflows/runs/{run_id}/events` with the same event filters for lightweight replay.
- Added frontend proxy routes and TypeScript client helpers for checkpoint, trace query, event filtering, and late source-output continuation.
- Added integration coverage proving:
  - checkpoints recover from DB after clearing the in-memory run cache.
  - trace query uses a global sequence cursor.
  - event filtering works for node, event type, cursor, and limit.

### 2026-07-05 External Runtime Import Slice

- Added `external.tool.capability` as an OpenCLI Admin catalog capability for imported external-runtime tool nodes.
- Registered its manifest with:
  - unknown typed input/output ports
  - external workflow origin resource
  - canvas review permission
  - pending OpenCLI executor binding
- Added `/api/v1/workflows/import/external-runtime` for LangGraph and LangChain graph import.
- Import preserves external graph structure by mapping:
  - external nodes to OpenCLI Admin WorkflowProject nodes.
  - external edges to WorkflowProject edges.
  - external ids/types into `ui.externalWorkflow` and `params.externalWorkflow`.
- External runtime nodes do not carry raw executors or direct tool calls into Canvas.
- Tool-like/unknown external nodes import as `external.tool.capability`.
- External merge/join nodes import as native `intelligence.flow.merge`.
- Parser/transform-like nodes import as native `intelligence.processing.normalize`.
- Added frontend proxy and TypeScript helper for external runtime imports.
- Added integration coverage proving:
  - LangGraph list-node graphs import as OpenCLI catalog nodes.
  - LangChain dict-node graphs and edge-only nodes import without losing structure.
  - imported tool nodes compile with an OpenCLI Admin Tool Capability binding requirement instead of pretending to have an external executor.

### 2026-07-05 Tool Capability Executor Seam

- Added `workflow.external-tool.capability` runtime binding for imported OpenCLI Admin Tool Capability nodes.
- `external.tool.capability` is now a runnable catalog node type, but each node still needs an explicit node-level `params.toolCapability` binding.
- Unbound imported tool nodes now block with `missing_tool_capability_binding`.
- Bound imported tool nodes can run through a guarded fixture executor:
  - `params.toolCapability.id`
  - `params.toolCapability.executor.mode = fixture`
  - `params.toolCapability.executor.output` or `outputs`
- Runtime trace now emits node lifecycle events plus explicit `tool_call_started` and `tool_call_completed` events for bound OpenCLI Tool Capability nodes.
- Fixture outputs preserve external workflow provenance and append OpenCLI Admin lineage.
- Importer now carries explicit `toolCapability` or `toolCapabilityId` + `executor` declarations from LangGraph/LangChain node metadata into native node params.
- Added integration coverage proving:
  - unbound imported tool nodes remain blocked at runtime binding.
  - bound imported tool nodes compile to `workflow.external-tool.capability`.
  - bound imported tool nodes run through the backend and feed downstream native Normalize.

### 2026-07-05 Tool Capability Registry Slice

- Added an OpenCLI Admin Tool Capability registry.
- Added `/api/v1/workflows/tool-capabilities` for registered tool capability discovery.
- Registered `tool.search.fixture` as the first deterministic fixture-backed Tool Capability for external-runtime import review.
- Projected registered Tool Capabilities into `/api/v1/workflows/capabilities` as resource capabilities so the main capability surface can see available tool resources.
- Runtime now requires `params.toolCapability.id` to resolve against the registry before binding.
- Unknown tool capability ids block with `unknown_tool_capability` even when a fixture executor is present.
- `external.tool.capability` manifest now declares `tool_capability_registry` as a required resource.
- `external.tool.capability` and registered tool capability manifests now declare explicit tool-call trace events, so tool calls remain runtime events instead of Canvas nodes.
- Added frontend proxy and TypeScript client helper for workflow tool capability discovery.
- Added integration coverage proving:
  - registered tool capabilities are discoverable through the API.
  - registered tool capabilities are visible through the main capability projection.
  - known tool capabilities bind and run.
  - unknown tool capabilities remain blocked.

Remaining first-loop work:

- Production hardening: add richer probe execution rather than manifest-declared probe names only.
- Production hardening: add real guarded executor adapters beyond the deterministic fixture-backed Tool Capability seam.

These are follow-on hardening items. They do not block the completed first
native-runtime loop because the current goal is proven through native catalog
capabilities, typed ports, backend runtime binding, persisted trace/checkpoint
recovery, external-runtime import into OpenCLI nodes, Tool Capability registry
binding, and explicit runtime tool-call trace events.
