# OpenCLI Admin Context

OpenCLI Admin is an operations console for collection work that needs browser session control, scheduled collection, and operator review.

## Language

**Collection Operations Console**: The primary operator surface for turning collection work into captured, triaged, owned, stateful, and closed work. It is the product shape that contains Run Inbox, Data Sources, Live Collection View, and the Collection Canvas.
_Avoid_: Dashboard wall

**Collection Operations**: The operator-facing domain for deciding what should be collected, when collection should run, what recently happened, and which actions are currently safe. It groups Data Sources, Collection Plans, Recent Runs, and Node Actions.
_Avoid_: Source Workflow Workbench

**Collection Canvas**: The primary authoring surface for collection logic — the graph IS the program. Defining and editing what a source collects happens on the canvas; forms survive only as the inspector panel of a selected node. Absorbs the old Diagnostic Canvas's troubleshooting role.
_Avoid_: Diagnostic Canvas (superseded 2026-07-02: canvas promoted from secondary diagnostic view to primary authoring surface), Topology Workbench as the authoritative authoring name, form-first configuration

**Live Collection View**: The operator-facing view of an active collection run as it happens, including streamed progress, rendered browser or pipeline state, and run-specific artifacts. It is anchored to a Recent Run, not to the default configuration surface.
_Avoid_: Static task log, canvas-only monitoring

**Adaptive Run Surface**: The on-demand layout that opens the right Live Collection View panels for the active run type. It should reveal pipeline events, browser or adapter rendering, and artifacts only when they help the operator understand that run.
_Avoid_: Clock shop, always-on dashboard wall

**Run Inbox**: The operator-facing queue of collection runs that need observation, review, retry, acknowledgement, or dismissal. It treats a run as work to triage and close, not as a passive row in a log table.
_Avoid_: Recent tasks table, static run history

### Control

**Advisory Mode**: The control-loop operating mode in which suggested actions are surfaced to the operator and recorded as evidence, but never executed.
_Avoid_: dry-run mode, suggestion mode

**Automatic Mode**: The control-loop operating mode in which the Actuator may execute suggestions itself, opened per state class only when accumulated evidence justifies it.
_Avoid_: autopilot, self-healing mode

**Actuator**: The component that carries out control actions against the collection system. It executes only whitelisted safe actions; everything else it downgrades.
_Avoid_: executor, auto-fixer

**Evidence Ledger**: The durable record of every control suggestion and execution, together with the outcome later judged from post-decision measurements.
_Avoid_: action log, audit trail

**Recovery Rate**: The share of judged suggestions whose triggering state later cleared. It is the quantified basis for opening Automatic Mode.
_Avoid_: success rate, fix rate

**Require-Review Downgrade**: The policy that suggestions too dangerous to automate are executed only as "flag the source for human review", never as the suggested action itself.
_Avoid_: blocked action, action rejection

**Control Cycle**: The background loop that periodically measures every source, decides, and — in Automatic Mode — acts. It runs regardless of whether any UI is open.
_Avoid_: polling-driven control, frontend-triggered control

### Plan

**Collection Need**: The operator's desired collection outcome, expressed in domain language before node design. It is translated into a Plan made of executable nodes and resource bindings; it is not itself a node strategy or adapter configuration.
_Avoid_: treating a user request as raw node params, confusing intent with execution strategy

**Runtime-Aware Plan Drafting**: The process of translating a Collection Need into a Plan using the system's known executable capabilities, adapter metadata, and resource resolvers. AI may propose the mapping, but missing capabilities or resources are represented as blocked gaps rather than runnable-looking nodes.
_Avoid_: AI freely drawing fake capabilities, optimistic runnable projections, silent fallbacks

**Node Capability Mapping**: The audit surface that maps every Canvas-visible node family to its real backend capability, runtime binding, resource dependency, and current wiring status before new nodes are added. It decides whether an existing node can serve a Collection Need, should be exposed as blocked, or should remain design/import-only.
_Avoid_: hand-rolled replacement nodes, treating palette presence as runtime support, frontend-only capability claims

**Plan**: A free multi-source graph on the Collection Canvas — any number of source nodes, transforms, merges, and sinks in one graph. The Plan is the program; a Data Source's legacy config is the degenerate single-node Plan.
_Avoid_: per-source pipeline (rejected 2026-07-02 in favor of free graphs), workflow (overloaded)

**Canvas Source Node**: A Plan node that represents a real executable collection source. It may wrap an existing Data Source or an inline source definition, but it must be resolvable into a real collection source before running.
_Avoid_: decorative source node, abstract placeholder, UI-only source

**Executable Canvas Node**: Any node on the Collection Canvas that participates in a Plan. It must either execute, route, transform, store, notify, gate, or expose package-owned executable internals; if it lacks a runtime binding, the node is explicitly blocked rather than treated as decorative.
_Avoid_: fake node, visual-only node, silent mock execution

**AgentRuntime Node**: A control node inside a Plan that uses trace, state, resources, and operator policy to choose or prepare the next action. It may call tools, but it is not a collection source and does not own source-health attribution.
_Avoid_: treating an agent as a Data Source, agent-as-source attribution, generic agent playground node

**Tool Capability Node**: A Plan node that declares an executable tool capability the operator can configure, validate, and bind to a runtime, such as an OpenCLI command, browser action, HTTP request, script runner, site adapter, or normalization step.
_Avoid_: per-call canvas nodes, trace-as-authoring, hiding executable capability behind an agent prompt

**Tool Call Event**: A runtime evidence event recording one concrete tool invocation, including selected capability, arguments, result, timing, error, and artifacts. It belongs to the trace and evidence ledger, not directly to the Collection Canvas.
_Avoid_: ToolCallNode on the canvas, turning every agent step into a graph node

**Run Checkpoint**: A state snapshot produced at a recoverable boundary during one Plan Run. It references the Plan version, Run, node position, state, resources, and artifacts needed for resume, branch, or replay; it is not a Canvas node or part of the Plan structure.
_Avoid_: checkpoint-as-node, storing recovery semantics in the Plan definition, blindly resuming after Plan changes

**Plan State**: The structured runtime state carried through one Plan Run, including node outputs, intermediate variables, merge results, and agent decision context. It is produced and consumed by executable nodes during a run.
_Avoid_: global mutable scratchpad, hiding run state inside prompts, confusing runtime state with source memory

**Source State**: The durable collection state owned by a Data Source, such as cursor position, last-seen item, site health, and recent successful collection time. It participates in Source Health and the control loop, even when Plan nodes read or update it.
_Avoid_: treating source memory as generic plan variables, writing source health into shared Plan State

**State Capability Node**: A Plan node that explicitly reads, writes, maps, or gates Plan State as part of the executable graph. It can expose state behavior on the Collection Canvas without turning every stored state object into a canvas node.
_Avoid_: generic StateNode, invisible state mutation, canvas nodes for every state record

**Run Trace**: The technical event stream for one Plan Run, including node lifecycle events, tool calls, inputs, outputs, artifact pointers, timing, token use, cost, and errors.
_Avoid_: treating trace as the authoring graph, using control evidence as a substitute for run execution details

**Control Evidence Entry**: A durable ledger entry for one control suggestion, approval, downgrade, execution, or outcome judgment. It explains why a control action was allowed or withheld and how its later recovery outcome was judged.
_Avoid_: generic trace event, plain action log, hiding operator approval or recovery judgment

**Control Suggestion Node**: A Plan node that produces a control suggestion and supporting evidence, often from an AgentRuntime Node or rule evaluation. It does not execute the action; execution must pass through the Actuator and produce Control Evidence Entries.
_Avoid_: agent-direct actuator execution, prompt-hidden automation, suggestions that bypass Advisory or Automatic Mode

**Gate Node**: A Control-family Plan node that deterministically allows, blocks, pauses, or routes execution based on human approval, rules, permissions, quality thresholds, schema checks, resource readiness, or policy state. AgentRuntime Nodes may advise, but Gate Nodes express the boundary that permits flow to continue. Gate types include human, policy, quality, schema, resource, and mode gates.
_Avoid_: hiding approval or policy gates inside agent prompts, letting agent judgment directly mutate execution flow

**Imported Runtime Graph**: An external agent or workflow graph imported with its original runtime structure, state semantics, checkpoint behavior, and execution constraints preserved. It may come from systems such as LangGraph, LangChain, or Pi, but it must be observable and governable inside OpenCLI Admin.
_Avoid_: flattening external runtime semantics into ordinary Plan nodes by default, treating imports as screenshots or decorative diagrams

**Runtime Package Node**: An Executable Canvas Node that wraps an Imported Runtime Graph or package-owned executable internals as one governable Plan node. It exposes inputs, outputs, runtime binding, resource requirements, trace mapping, checkpoint mapping, and permission boundaries without forcing the imported graph to become native Plan structure.
_Avoid_: fake compatibility nodes, uncontrolled foreign executors, expanding every imported node onto the Collection Canvas by default

**Runtime Capability Mapping**: The translation contract that maps an external runtime's tool calls, state, trace, checkpoints, interrupts, and control suggestions into OpenCLI Admin concepts. It internalizes operational capabilities without pretending every external graph is natively authored as an OpenCLI Admin Plan.
_Avoid_: shallow importer, visual-only compatibility, losing external runtime semantics during import

**Managed External Executor**: An external runtime executor, such as a LangGraph, LangChain, or Pi runner, that remains responsible for its own internal graph semantics while executing under OpenCLI Admin runtime binding. It must report inputs, outputs, tool calls, trace, checkpoints, failures, resources, and permissions through Runtime Capability Mapping.
_Avoid_: uncontrolled foreign executor, executor-owned credentials, executor bypassing Run Trace or Control Evidence

**Registered Tool Capability**: A tool capability that has been registered in OpenCLI Admin's capability catalog before any native or imported runtime can call it. External runtime tools must enter through this catalog so permissions, resources, trace, and validation remain governable.
_Avoid_: raw external tool invocation, prompt-only tool access, imported runtime private tools

**Primitive Capability**: A low-level executable ability such as browser click, HTTP request, shell command, file read, or raw OpenCLI command. It is implementation material for packaged capabilities and is granted directly only under explicit policy.
_Avoid_: exposing low-level primitives as the default agent or canvas interface, unrestricted browser or shell access

**Business Capability**: A packaged domain-level tool capability, such as site search, market quote, feed collection, record normalization, or knowledge export. It is the default callable surface for Canvas nodes, AgentRuntime Nodes, and Imported Runtime Graphs, with Primitive Capabilities hidden behind its implementation boundary.
_Avoid_: forcing operators or imported runtimes to assemble raw browser, HTTP, or shell primitives for common collection work

**Capability Catalog**: The authoritative registry of Business Capabilities and governed Primitive Capabilities. Canvas nodes, AgentRuntime Nodes, and Imported Runtime Graphs reference catalog entries rather than inventing tools inline.
_Avoid_: frontend-only tool palettes, prompt-defined tools, imported runtime tools without registry ownership

**Capability Manifest**: A package-owned declaration of the Business Capabilities and governed Primitive Capabilities it provides, including schemas, required resources, permission class, runtime binding, trace mapping, checkpoint support, and probes.
_Avoid_: frontend-hardcoded capability lists, undocumented adapter affordances, tools inferred only from prompts

**Capability Availability**: The backend-verified current status of a declared capability in this environment, including dependency presence, resource binding, permission readiness, and probe result.
_Avoid_: assuming manifest presence means runnable, hiding missing resources until execution time

**Capability Gap**: An explicit blocked gap produced when a Plan or Imported Runtime Graph requires a capability that has no runnable mapping in the Capability Catalog, or whose availability is blocked by schema, dependency, resource, permission, or probe failure.
_Avoid_: failing import silently, pretending missing tools are runnable, deleting unsupported external graph structure

**Capability Gap Resolution**: The operator workflow for resolving a Capability Gap by mapping to an existing Business Capability, binding resources, granting permissions, selecting a manifest-declared candidate, or running probes. It does not create undocumented capabilities inline; new capabilities enter through package manifests.
_Avoid_: prompt-defined tool registration, UI-invented tools without manifests, bypassing capability probes or permission classes

**Record Candidate**: A candidate collection result produced by a collection capability before it has been normalized, deduplicated, reviewed, or accepted into the records system.
_Avoid_: treating every scraped item as an accepted Record, mixing raw artifacts with structured records

**Record**: A normalized collection result accepted into OpenCLI Admin's records system and eligible for search, export, notification, downstream egress, and review workflows.
_Avoid_: runtime artifact, transient node output, unnormalized scrape result

**Record Acceptance Gate**: A Gate Node that decides whether a Record Candidate becomes a Record based on schema completeness, dedupe result, lineage preservation, quality threshold, review policy, and automatic-acceptance rules.
_Avoid_: normalize-implies-accepted, silently storing raw candidates as records, accepting records without lineage

**Runtime Artifact**: A non-record output produced during execution, such as a screenshot, HTML snapshot, trace attachment, LLM summary, diagnostic report, or checkpoint blob. It may support evidence or debugging without becoming a Record.
_Avoid_: forcing every artifact into records, sending diagnostic blobs as business results by default

**Artifact Transform Node**: A Transform-family Plan node that explicitly converts Runtime Artifacts into Record Candidates, Plan State, diagnostics, review material, or other typed outputs. Artifacts must pass through a typed transform before entering record or business-result flows.
_Avoid_: artifact-to-record shortcuts, untyped artifact edges, treating screenshots or HTML as records without extraction

**Merge Node**: A Plan node that combines multiple upstream streams, candidates, records, or artifacts into a shared downstream segment while preserving input lineage and attribution. A merge failure belongs to Plan Health, not to every upstream source's Source State.
_Avoid_: implicit fan-in, losing source lineage after merge, blaming all upstream sources for shared-segment failures

**Typed Port**: A typed input or output boundary on an executable node, such as Record Candidate stream, Record stream, Runtime Artifact stream, Plan State patch, or Control Suggestion. Typed Ports let operators and AI compose Plans without writing glue code or connecting incompatible flows.
_Avoid_: untyped canvas edges, prompt-only data contracts, letting artifacts flow as records without an explicit transform

**Merge Strategy**: The explicit strategy a Merge Node uses to combine compatible upstream flows, such as concat, key join, dedupe, priority, or windowed merge. The strategy never removes the need to preserve lineage.
_Avoid_: hidden merge behavior, accidental concat, dedupe that discards attribution

**Lineage**: The preserved origin chain for an output item, including source, node, run, tool call, artifact, and merge path references. It lets downstream records and failures remain attributable after fan-in.
_Avoid_: anonymous merged output, source attribution guessed after the fact

**No-Code Plan Assembly**: The design goal that operators and AI should assemble useful collection workflows from Business Capabilities, Typed Ports, presets, explicit strategies, and default gates without writing custom code for ordinary cases. AI-generated drafts should add gates around safety boundaries, external egress, control actions, low-level primitives, unverified resources, imported runtimes, and record acceptance.
_Avoid_: SDK-first workflow creation, requiring raw scripts for common collection and merge patterns, one-click plans without safety or quality gates

**Plan Draft**: A draft graph proposed by an operator or AI before it is runnable. It may contain Capability Gaps, Draft Source Nodes, unbound resources, or unresolved port checks, and must not be treated as an executable Plan.
_Avoid_: AI-generated runnable-looking fake plans, silently running drafts

**Materialized Plan**: A Plan whose executable nodes have validated runtime bindings, capability availability, typed-port compatibility, and required resource bindings. Only a Materialized Plan can be run authoritatively.
_Avoid_: running unverified graph drafts, treating palette presence as execution readiness

**Plan Change Proposal**: A proposed modification to an existing Plan, often generated by AI, that must show the diff, capability/resource impact, and checkpoint or replay implications before approval.
_Avoid_: AI directly mutating production Plans, hidden workflow rewrites

**Workflow Intent Entry**: A conversational or structured entry point where an operator describes a desired collection outcome and receives a Plan Draft or Plan Change Proposal. It is an intent surface, not a hidden workflow editor.
_Avoid_: chat-only workflow state, plans that exist only in an assistant transcript

**Capability Discovery Entry**: The search and recommendation surface for finding available Business Capabilities, Presets, and blocked gaps from the Capability Catalog. It helps assemble Plans but does not replace the Collection Canvas.
_Avoid_: static raw node palette, frontend-only capability menus

**Packaged Node Preset**: A ready-to-place node package that wraps a Business Capability with default parameters, resource hints, output ports, labels, tags, probes, and safety limits. In the Palette and Canvas it is the operator-facing "封装好的节点"; the underlying capability remains catalog-owned.
_Avoid_: treating presets as only saved form params, hardcoded frontend nodes, presets without capability ownership

**Node Preset Family**: A stable grouping for Packaged Node Presets by workflow role: Source, Transform, Flow, Sink, Control, or Runtime Package. AgentRuntime Nodes belong to Control; imported LangGraph, LangChain, Pi, or package-owned graphs belong to Runtime Package. Families keep the palette extensible as new nodes are added.
_Avoid_: organizing presets only by implementation technology, one flat node list, mixing sources and sinks under adapter names

**Node Onboarding Path**: The standard path for adding a new node: define the Business Capability, declare its Capability Manifest, implement the runtime binding, add probes and availability checks, package a Packaged Node Preset, assign a Node Preset Family, and let the Canvas discover it.
_Avoid_: frontend-first node cards, palette entries without runtime bindings, adding nodes outside the Capability Catalog

**Canvas Approval Surface**: The authoritative surface where Plan Drafts, Capability Gaps, and Plan Change Proposals are reviewed, edited, approved, and materialized. AI output must land here before it becomes runnable.
_Avoid_: approving workflow changes only in chat, hidden mutations outside the canvas

**Execution Resource**: An implicit runtime dependency consumed by executable Plan nodes, such as browser session state, cookie state, credentials, profile binding, or worker capacity. Execution Resources are resolved from saved bindings or resource-producing nodes; operators should not paste raw cookies or secrets into source parameters.
_Avoid_: hand-filled cookie params, credentials hidden in node params, treating session state as source strategy

**Two-Tier Attribution**: The observability contract for Plans. A source node is a real Data Source and its collection segment keeps per-source measurement unchanged (the control kernel is untouched); everything downstream of a merge belongs to Plan Health, and a shared-segment failure is never written into any source's state.
_Avoid_: blaming all upstream sources, plan-only attribution

**Plan Health**: The health of a Plan's shared (post-merge) segments, measured per plan node, kept as its own dimension beside per-source measurement. A dedupe node failing does not make its upstream sources DEGRADED.
_Avoid_: folding plan failures into source state

**Preset**: A packaged, one-click node configuration (e.g. an opencli site + command + format bundled as "雪球·热帖") registered in the node library and searchable from the palette. Presets are fed from backend adapter metadata, never hardcoded in the frontend. The advanced inspector still exposes raw parameters.
_Avoid_: raw site/command dropdowns as the default UI

**Draft Source Node**: A source node placed on the Collection Canvas that does not yet reference a real Data Source. It renders visibly unmaterialized, cannot run, and does not enter the control loop until it is materialized into an entity.
_Avoid_: fake canvas-only nodes that look real

**Dry-Run Preview**: The in-browser execution of a Plan on fixture data, explicitly labeled as a preview. It never produces collection results — the backend Plan executor is the only authoritative execution.
_Avoid_: browser-side "real" runs, split-brain execution
