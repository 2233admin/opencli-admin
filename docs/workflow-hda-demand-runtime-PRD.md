# PRD: Workflow HDA Demand Runtime

Status: ready-for-agent
Date: 2026-07-05
Grounding: Plan IR & Collection Canvas PRD, ADR-0009 free graph/two-tier attribution, ODP Enterprise plan, current OpenCLIChannel / III collector-opencli / ODP mapper implementation.

## Problem Statement

OpenCLI Admin already has strong collection primitives: OpenCLI channels, browser/agent registration, III workers, and ODP record ingestion. The missing product capability is not another rewritten backend or another adapter layer. The missing capability is a high-concurrency orchestration layer where the node canvas is the real execution plan, human and AI requests become node graph changes, and multi-source browser-native collection can run across many Docker/browser workers while the operator sees exactly which node is running, blocked, batching, normalizing, clustering, or producing results.

Today, a user can manage sources, tasks, workers, and plans, and the frontend canvas already has WorkflowProject, node catalog, primitives, package/HDA-like nodes, internals, and n8n translation. But the system still needs a runtime bridge that treats the canvas graph as the authoritative program. A fake projection of a backend-only demand plan is not acceptable: the user wants Houdini-style nodes and HDA packages as the workflow spine.

AI also needs a precise interface. AI should not invent primitive nodes or emit raw OpenCLI/III payloads. It should translate user intent into structured WorkflowProject patches: selecting existing nodes, connecting them, filling parameters, and packaging small nodes into HDA nodes. Missing primitive capabilities should become developer work, not ad hoc AI-generated backend behavior.

## Solution

Build a Workflow HDA Demand Runtime where:

- The frontend Canvas WorkflowProject is the orchestration source of truth.
- Human natural-language requests are interpreted into WorkflowProject patches.
- AI callers use structured tool calls or generate structured WorkflowProject patches, not free-form backend commands.
- HDA/package nodes encapsulate multi-source OpenCLI collection flows.
- Backend compiles WorkflowProject into an executable plan.
- III is the primary execution plane.
- Existing OpenCLIChannel, channel runner, agent server, browser pool, III collector-opencli, and ODP mapper are reused rather than replaced.
- Docker browser-worker capacity is scaled horizontally across containers and machines.
- Large collection outputs move as EvidenceBatch-style batch manifests and object/blob references, not one event per record on hot paths.
- Canvas receives real node-level run events and updates the existing node status/fields/artifact surfaces.
- Evidence, clusters, and answers are exposed as projections for both frontend and AI.

The system should feel like Houdini for collection workflows: small typed nodes compose into larger HDA nodes, HDA nodes can expose public parameters, internals can be locked/unlocked, and the graph is executable by the backend.

## User Stories

1. As an operator, I want the Canvas graph to be the execution plan, so that what I draw is what runs.
2. As an operator, I want a natural-language request to create or update a workflow graph, so that I can start from intent without hand-building every node.
3. As an operator, I want AI-generated changes to appear as a WorkflowProject patch, so that I can review the exact graph change before running it.
4. As an operator, I want the AI to use existing nodes instead of inventing node types, so that generated workflows stay maintainable.
5. As an operator, I want the AI to package small nodes into an HDA-style large node, so that complex multi-source collection stays readable.
6. As an operator, I want an HDA node to expose only the important parameters, so that I can run complex workflows without seeing all internals.
7. As an operator, I want to unlock HDA internals when needed, so that I can inspect or modify the composed small nodes.
8. As an operator, I want HDA internals to be lockable, so that stable packages do not drift accidentally.
9. As an operator, I want multi-source collection to be represented by nodes, so that source selection, fanout, collection, normalization, clustering, and result projection are visible.
10. As an operator, I want each node to show pending, queued, running, blocked, partial, completed, or failed state, so that I know where the workflow is.
11. As an operator, I want blocked nodes to show structured block reasons, so that I know whether the issue is browser capacity, profile lock, worker lag, missing source capability, or downstream processing.
12. As an operator, I want OpenCLI source nodes to run through the existing OpenCLI and III machinery, so that existing adapters are reused.
13. As an operator, I want one machine to run multiple Docker browser workers, so that browser-heavy workflows can scale beyond one desktop Chrome.
14. As an operator, I want additional machines to register browser-worker capacity, so that large collection bursts can fan out horizontally.
15. As an operator, I want same-source multi-adapter workflows to share profile/session state safely across containers, so that performance does not require packing every adapter into one container.
16. As an operator, I want profile mutations to be locked while read-only session snapshots can be shared, so that login state is protected without killing read throughput.
17. As an operator, I want large adapter outputs to be handled as batches, so that a source returning thousands of items does not flood the event stream one row at a time.
18. As an operator, I want batch progress on the node, so that I can see item counts, accepted counts, duplicate counts, and rejected counts.
19. As an operator, I want evidence and clusters to be linked back to source nodes, so that results stay explainable.
20. As an operator, I want the result panel to show partial results while nodes are still running, so that long workflows are useful before completion.
21. As an operator, I want failures in downstream cluster/projection nodes to be separated from source health, so that source control state is not polluted.
22. As an operator, I want existing source/task pages to keep working, so that the new runtime does not break current operations.
23. As an AI agent, I want a structured tool schema for creating workflow patches, so that I can produce valid graph edits instead of natural-language pseudo-instructions.
24. As an AI agent, I want to read available node catalog and HDA capabilities, so that I can choose valid existing nodes.
25. As an AI agent, I want to submit a workflow run and subscribe to node-level events, so that I can monitor progress programmatically.
26. As an AI agent, I want evidence, clusters, missing sources, and conflicts through APIs, so that I can cite data rather than only read summaries.
27. As a developer, I want missing AI-requested capabilities to be captured as explicit missing capability records, so that new primitive work is deliberate.
28. As a developer, I want new primitive/package work to prefer existing component library nodes, then n8n-translated nodes, then new primitives, so that node sprawl stays controlled.
29. As a developer, I want the backend compiler to validate WorkflowProject before execution, so that invalid graphs fail before worker fanout.
30. As a developer, I want node runtime binding to be registered centrally, so that node execution is not scattered across UI code, API handlers, and adapters.
31. As a developer, I want III execution binding to be a runtime adapter behind node execution, so that Admin remains the control/compile/projection plane.
32. As a developer, I want OpenCLIChannel and III collector-opencli to remain the execution kernel for OpenCLI work, so that adapter behavior is not rewritten.
33. As a developer, I want ODP mapper and ingest contracts reused, so that record shape and idempotency stay consistent.
34. As a maintainer, I want node-level run events to be externally observable and replayable enough to rebuild graph state, so that UI and AI clients do not inspect worker internals.
35. As a maintainer, I want frontend Canvas state updates to patch existing node data, so that the current React Flow/Zustand architecture is reused.
36. As a maintainer, I want high-concurrency behavior tested at the planner/compiler/dispatch seams, so that performance work does not depend on UI snapshots.

## Implementation Decisions

- **Canvas as orchestration spine**: WorkflowProject is the primary authoring and execution input. DemandPlan must not bypass Canvas. Backend-only execution graphs may exist only as compiled artifacts derived from WorkflowProject.
- **HDA/package nodes**: package nodes are executable encapsulations, not visual decorations. They expose public parameters and contain internal small-node graphs. Internals can be locked/unlocked and compiled.
- **AI boundary**: webpage AI may select existing nodes, connect nodes, fill parameters, generate WorkflowProject patches, and package existing nodes into HDA nodes. It may not create primitive node implementations, backend executors, raw III payloads, raw OpenCLI commands, or arbitrary adapters.
- **Developer node rule**: developer/Codex node packaging first uses the existing component node catalog and primitives; if missing, uses n8n-translated nodes; only then adds new primitive/catalog definitions.
- **Backend compiler**: add a compiler path from WorkflowProject/Plan graph into an executable node plan. The compiler validates nodes, edges, ports, exposed HDA parameters, adapter bindings, and runtime capabilities.
- **Node Runtime Registry**: introduce a central registry mapping node kind/capability/adapter/runtime metadata to executor bindings. It should route OpenCLI collection nodes to III/OpenCLI execution rather than introducing a parallel adapter runtime.
- **III as execution plane**: new high-concurrency workflows default to III execution. Admin remains the control plane, compiler, projection API, frontend API, and AI API.
- **No backend rewrite**: preserve existing OpenCLIChannel, channel runner, agent server, browser pool, III collector-opencli, ODP record mapper, and ODP ingest. Extend around them.
- **OpenCLI HDA**: create a Multi Source OpenCLI HDA that composes source catalog selection, source-group shards, OpenCLI site/command tasks, III dispatch, ODP batch ingest, normalization, clustering, and projection nodes.
- **Browser-worker scale**: use Docker browser-worker containers as execution capacity. One physical machine may host many containers; additional machines add more workers. Browser capacity is a resource pool, not tied to one desktop Chrome.
- **Profile/session control plane**: same-source multi-adapter concurrency shares ProfileBinding and SessionSnapshot across worker containers. Profile mutations require distributed ProfileLock; read-only snapshot usage can fan out.
- **Performance-first default**: default to the high-performance path: III worker fabric, Docker browser workers, batch movement, ODP/ingest contracts, and projection stores. Light/local paths are compatibility/fallback, not the design baseline.
- **Batch data model**: adapter outputs default to EvidenceBatch/CandidateRecordBatch semantics. Hot event streams carry metadata, counts, cursors, and blob/batch references rather than every raw record.
- **Node run event stream**: emit node-level lifecycle and data events: run started, node queued, node started, node blocked, batch ready, batch ingested, node partial, node completed, node failed, graph completed.
- **Canvas runtime binding**: frontend subscribes to run events and patches existing node data/status/fields/runArtifact instead of replacing the Canvas or rendering a fake projection.
- **Evidence/cluster projection**: result APIs expose evidence batches, canonical evidence, clusters, conflicts, missing sources, source coverage, and summaries for both human frontend and AI consumers.
- **Two-tier attribution preserved**: source-level control/evidence remains source-keyed; shared normalization/cluster/projection nodes write plan/node health and must not poison upstream source health.
- **Existing compatibility**: existing source/task/opencli flows remain compatible. New workflow/HDA runtime is the high-concurrency path, not a breaking migration.

## Testing Decisions

- A good test asserts behavior at the highest stable seam: API contract, compiler output, node run event stream, III dispatch payload shape, ODP batch manifest, projection read model. Avoid tests that assert private function call order.
- **Workflow compiler tests**: given a WorkflowProject with HDA/package nodes and internals, the compiler validates and emits executable node plan segments with correct dependencies and public parameter binding.
- **AI patch tests**: AI-facing patch schema accepts selection/connection/parameter/package operations and rejects primitive creation, raw executor definitions, raw III payloads, and raw OpenCLI commands.
- **Node Runtime Registry tests**: OpenCLI source/HDA nodes resolve to existing III/OpenCLI execution binding; non-OpenCLI nodes resolve to their registered executors or fail with missing capability.
- **III dispatch tests**: compiled OpenCLI nodes produce valid III function triggers for collector-opencli and include workflow/run/node/source identifiers needed for traceability.
- **Batch tests**: large item sets become batch manifests with counts and references; event streams do not emit one frontend event per raw record.
- **Profile/session tests**: read-only same-source adapters can share a SessionSnapshot; mutation tasks require ProfileLock and cannot run concurrently for the same binding.
- **Run event tests**: node blocked/running/completed/failed events are emitted with node ids that the Canvas can patch.
- **Projection tests**: evidence and cluster projections link back to workflow run id, node id, source group, adapter task, and batch id.
- **Plan IR regression tests**: existing Plan IR and plan run tests continue to pass; new compiler behavior should reuse or extend the existing Plan API seams where possible.
- **OpenCLI regression tests**: existing OpenCLIChannel, agent mode, WS/HTTP agent, browser pool, and ODP mapper tests continue to pass unmodified unless the test is explicitly extended for new metadata.
- **Frontend view-model tests**: WorkflowProject patch application, HDA package construction, event-to-node-status reducer, and AI permission guard live in framework-light testable modules. Do not rely on brittle Canvas screenshot tests for core semantics.

## Out of Scope

- Rewriting OpenCLI adapters, OpenCLIChannel, III collector-opencli, ODP record mapper, or the existing backend collection runner.
- Letting webpage AI generate new primitive implementations or backend executor code.
- Treating the Canvas as a passive projection of an unrelated backend DemandPlan.
- Replacing existing source/task/pages or removing legacy compatibility flows.
- Solving all transport backends at once. The architecture can keep transport boundaries, but this PRD focuses on the workflow/HDA runtime and high-concurrency execution path.
- Full enterprise security, multi-tenant governance, audit policy, and cost controls unless needed as compile/runtime metadata.
- Creating a separate workflow UI instead of using the existing Canvas/WorkflowProject/HDA mechanisms.
- One-row-per-event ingestion for large browser collection outputs.

## Further Notes

- The accepted product language is Houdini/HDA-style: small nodes compose into larger package nodes; package nodes are real executable units.
- The Canvas is the product's authoring center. Demand and AI APIs exist to modify/run Canvas workflows, not to replace them.
- Current frontend already has the right primitives: WorkflowProject, node catalog, node primitives, package nodes, node internals, parameter interfaces, n8n translation, status/runArtifact/sourceAnchor, and Zustand patching.
- Current backend already has the right execution primitives: Plan IR, plan executor seams, OpenCLIChannel, agent server, browser pool, III collector-opencli, ODP ingest, and ODP mapper.
- The first implementation slice should not chase every concurrency backend. It should prove one real graph: user/AI creates a Multi Source OpenCLI HDA workflow, backend compiles it, III executes multiple OpenCLI source tasks, ODP ingests batches, Canvas shows node-level progress, and frontend/AI can read evidence/cluster projection.
