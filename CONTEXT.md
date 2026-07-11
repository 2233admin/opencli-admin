# OpenCLI Admin Context

OpenCLI Admin is an operations console for collection work that needs browser session control, scheduled collection, and operator review.

## Language

### Agents

**External Agent Consumer**:
An agent outside OpenCLI Admin that consumes accepted Records, allowed summaries, and explicitly exposed evidence through a Service Identity and Consumer Grant. It does not receive operational roles or directly operate Plans, Agents, or the Actuator; desired collection changes enter as external requests for review.
_Avoid_: Agent (ambiguous), hosted agent, Operations Agent

**Operations Agent**:
An agent inside OpenCLI Admin that observes, maintains, and proposes improvements to collection operations and system workflows. Its actions remain subject to the system's control policies and evidence loop.
_Avoid_: External Agent Consumer, data consumer, unrestricted self-modifying agent

**Operations Agent Identity**:
The stable identity of one Operations Agent within a Workspace, independent of its model, provider, runtime, or individual Runs. It has one Owning Team and one current versioned Agent Permission Profile; copies start with Observe Only, and disabling the identity revokes its profile.
_Avoid_: model identity, runtime process, shared cross-Workspace Agent, copied permissions

**Agent Draft**:
An unpublished revision of an Operations Agent's instructions, model choice, tools, or behavior configuration. Editing a Draft does not affect the currently published version and cannot include an Agent Permission Profile change.
_Avoid_: live Agent edit, hidden permission change, mutable running configuration

**Published Agent Version**:
An immutable Operations Agent configuration used by Runs. Maintainers may publish Observe Only or Suggest Changes versions; a Low-Risk Automatic Agent requires Admin approval, and every Run remains bound to the version with which it started.
_Avoid_: mutable latest version, in-place Run update, Profile snapshot

**Agent Trigger**:
The declared reason an Operations Agent Run starts: Manual by an Operator, Scheduled by a Plan, or Event-Triggered by a run, health, Inbox, or resource-change event. Every trigger creates a formal Run under the same permission, risk, Gate, trace, and evidence controls.
_Avoid_: hidden background invocation, prompt-only trigger, permanent autonomous loop

**Agent Run**:
One bounded execution of a Published Agent Version started by an Agent Trigger. It remains attributable to its Agent identity, Workspace, triggering event or Operator, Profile version, and evidence.
_Avoid_: immortal Agent process, untracked background loop, mutable Agent session

**Agent Concurrency Key**:
The pairing of one Operations Agent Identity and one target resource used to serialize Agent Runs. Events arriving during an active Run are coalesced for a later Run when still relevant; different targets may run concurrently within Workspace limits.
_Avoid_: one Run per event, global Agent lock, shared mutable parallel Runs

**Isolated Agent Run**:
An Admin-requested Manual Agent Run that may execute beside the normal concurrency key without sharing mutable state. It remains subject to the same permissions, risk controls, limits, trace, and evidence requirements.
_Avoid_: bypass Run, privileged hidden session, shared-state parallel execution

**Agent Run Budget**:
The Workspace- and Agent-bounded allowance for Run duration, model usage or cost, tool calls, retries, and concurrency. On exhaustion the Agent stops creating actions, preserves completed evidence, and creates a Review Work Item; an already-started atomic Actuator action may finish safely.
_Avoid_: Agent-raised budget, unlimited Run, interrupting an atomic side effect

**Run Cancellation**:
An Admin, Maintainer, or Operator request that immediately prevents new Agent steps, queued work, tool calls, and Actuator actions while allowing underway atomic actions to finish safely and asking cooperative tools to stop. Evidence remains, uncertain effects create Review or Incident work, and the Run never resumes without an explicit rerun or Checkpoint resume.
_Avoid_: evidence deletion, hard-killing atomic effects, automatic restart

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

**Operations Inbox**: The unified operator-facing queue for operational work, including run issues, Operations Agent proposals, and human approvals created by Gates. It is the single entry point for triaging and closing work.
It is shared within a Workspace; personal views and notifications filter the same authoritative work items rather than creating per-user copies.
_Avoid_: system Inbox, separate approval inbox, dashboard notification feed, personal inbox copy

**Operations Work Item**:
The single authoritative unit of work in the Operations Inbox. Its lifecycle is Open, In Progress, Resolved, then Closed; it may instead be Dismissed, and a failed resolution or recurrence reopens it.
_Avoid_: user notification, copied task, private approval item

**Incident Work Item**:
An Operations Work Item representing a run failure, health anomaly, or unavailable capability.
_Avoid_: alert notification, generic error row, Change Proposal

**Approval Work Item**:
An Operations Work Item representing a human decision required by a Gate and linked to the exact version of its parent Change Proposal. Approve grants the Actuator permission to execute, Reject denies it, and Request Changes returns the proposal for revision; any revision invalidates the prior decision.
_Avoid_: approval notification, hidden prompt approval, Change Proposal

**Approval Grant**:
A time-limited authorization for the Actuator to execute one exact Change Proposal version against the approved target resource version and policy state. It expires after 24 hours or immediately when the proposal, target, risk, permissions, or policy changes.
_Avoid_: permanent approval, reusable approval token, approval without execution-time policy checks

**Approval Separation**:
The rule that a human author of a Change Proposal cannot approve that proposal, including an Admin. Critical proposals require two different authorized approvers including an Admin; Operations Agent proposals have no human author but remain subject to normal approval policy.
_Avoid_: self-approval, Admin bypass, Agent as approver

**Agent Permission Profile**:
A Workspace-scoped preauthorization assigned by an Admin that limits an Operations Agent to named tools, resources, and action types. Eligible Low or Medium actions may execute without per-action human approval, but every action still passes through Risk Policy, Gates, the Actuator, and the Evidence Ledger; High and Critical actions are never eligible.
_Avoid_: Agent auto-approval, unrestricted Agent mode, permission bypass, global Agent grant

**Observe Only Profile**:
An Agent Permission Profile that permits an Operations Agent to read operational state, evidence, and Run Trace without proposing or executing changes.
_Avoid_: Viewer role, implicit suggestion access, read-write mode

**Suggest Changes Profile**:
An Agent Permission Profile that permits an Operations Agent to create evidence-backed Change Proposals but not execute them automatically.
_Avoid_: Advisory Mode, automatic proposal execution, Agent approval

**Low-Risk Automatic Profile**:
An Agent Permission Profile that permits whitelisted Low actions and Admin-enabled Medium action types to execute automatically within an explicitly narrowed tool and resource scope.
_Avoid_: allow-all mode, High-risk automation, unrestricted custom profile

**Change Proposal Work Item**:
An Operations Work Item representing an evidence-backed configuration or Plan change proposed by an Operations Agent or Operator. It owns the evidence, diff, risk, and target resources; Approval Work Items record decisions about a specific proposal version.
_Avoid_: direct mutation, chat suggestion, Approval Work Item

**Proposal Readiness**:
The Gate condition requiring a Change Proposal to identify its triggering state, current observations, trace or evidence references, exact diff and target versions, expected effect, validation method, Risk Policy basis, idempotency or compensation status, and evidence freshness. An incomplete, stale, or target-drifted proposal remains or returns to Draft and cannot create an Approval Work Item.
_Avoid_: runnable-looking draft, approval without evidence, stale proposal

**Post-Change Validation**:
The evidence-backed observation of an executed Change Proposal against its declared validation method and observation window. Actuator completion alone is not resolution: passing moves the proposal to Resolved, failure creates or updates an Incident, and an uncertain result remains In Progress; only validated outcomes contribute to Recovery Rate.
_Avoid_: execution-equals-success, immediate closure, unjudged recovery

**Validation Window**:
The period over which a Control Action's declared outcome must remain true before validation completes. Its Capability Manifest defines the default and safety minimum, Risk Policy may raise the minimum, and a Workspace or proposal may lengthen but never shorten it; actions without a reliable window are ineligible for Automatic Mode.
_Avoid_: Agent-chosen short window, immediate validation, unbounded observation

**Closure Policy**:
The Workspace policy deciding when a Resolved Operations Work Item may become Closed. Validated Low or Medium automatic changes may close after a recurrence-free window; High or Critical changes and Review items require a human, Incidents default to human closure, and completed Approval items close with their parent proposal.
_Avoid_: execution-triggered closure, one closure rule for every item type, silent auto-close

**Review Work Item**:
An Operations Work Item representing a human judgment about result quality, Record Acceptance, or another review boundary.
_Avoid_: Approval Work Item, passive report, untracked manual check

**Work Item Assignment**:
The current Operator responsible for advancing an Operations Work Item. Assignment, reassignment, following, and personal views never create a separate copy of the item.
_Avoid_: personal task copy, notification recipient, permanent owner

**Work Item Resolution**:
The recorded outcome and reason that moves an Operations Work Item to Resolved, Closed, Dismissed, or back to Open. Every transition preserves who made it and when.
_Avoid_: silent closure, notification dismissal, approval as a status

**Severity**:
The evidence-backed degree of system impact represented by an Operations Work Item: Critical, High, Medium, or Low. It describes impact, not when the team chooses to act.
_Avoid_: Priority, queue position, operator urgency

**Priority**:
The operator-controlled order in which an Operations Work Item should be handled: Urgent, High, Normal, or Low. It describes handling order, not system impact.
_Avoid_: Severity, impact level, automatic health classification

**Run Inbox**: The run-focused view of the Operations Inbox, containing collection runs that need observation, review, retry, acknowledgement, or dismissal.
_Avoid_: standalone inbox, Recent tasks table, static run history

### Control

**Workspace**:
The ownership and authorization boundary for Data Sources, Plans, Runs, and Operations Inbox work. An Operator's role is assigned independently in each Workspace.
_Avoid_: global project, tenant without an ownership boundary, system-wide role scope

**Team**:
A group of Operators within a Workspace used to own operational resources and route Operations Work Items. Team membership does not grant permissions beyond each member's Workspace role.
_Avoid_: permission group, nested Workspace, Team-level RBAC

**Owning Team**:
The one Team accountable for a Data Source, Plan, or Operations Work Item. Other Teams may follow or collaborate; ownership transfers are recorded, and resources without an Owning Team enter the Workspace's unassigned queue.
_Avoid_: shared ownership, permission scope, silent ownership transfer

**Work Item Routing**:
The assignment of an Operations Work Item to an Owning Team based first on its target Data Source or Plan, including Operations Agent proposals. Agent failures, permission anomalies, and proposals without a target resource route to the Agent's Owning Team; remaining unattributable items enter the Workspace's unassigned queue. The system may recommend an Operator but does not assign one automatically.
_Avoid_: automatic personal assignment, Agent-chosen assignee, routing as authorization

**Problem Fingerprint**:
The Workspace-scoped identity of one operational problem, formed from its target resource and problem type. Repeated occurrences append evidence to an active Operations Work Item; they reopen a Resolved item, while a recurrence after Closed or Dismissed creates a linked new item.
_Avoid_: one item per alert, global fingerprint, silently replacing prior evidence

**Platform Admin**:
A system-scoped role that creates and disables Workspaces, appoints their first Admin, and manages platform infrastructure. It has no implicit access to Workspace business data and must join a Workspace explicitly, with that access recorded.
_Avoid_: global Workspace Admin, invisible support access, cross-Workspace superuser

**Admin**:
An Operator role with every permission in its Workspace, including approval of all gated actions, management of Workspace role assignments, and assignment of any Agent Permission Profile.
_Avoid_: superuser bypass, unrestricted Agent, implicit administrator

**Maintainer**:
An Operator role that may maintain configuration, Plans, membership, and Operations Agent identities but may not manage Admin assignments, the highest-risk policies, or grant an Agent more than Suggest Changes. It may always reduce an Agent's permissions.
_Avoid_: partial Admin, owner, unrestricted maintainer

**Operator**:
An Operator role that may work the Operations Inbox, run or pause Operations Agents and collection work, and approve actions within its granted scope, but cannot change Agent Permission Profiles.
_Avoid_: Admin, Operations Agent, viewer with write access

**Viewer**:
An Operator role with read-only access to operational state, Agent state, evidence, and results.
_Avoid_: guest operator, read-only Operator

**Service Identity**:
A non-human identity installed and authorized independently in one Workspace for API, CI, or system integration. It cannot use the UI, approve work, hold Admin, or impersonate its creator; its scoped credentials are rotatable and revocable, and every use enters the Actor Chain under its own identity.
_Avoid_: shared user token, global integration account, bot Admin

**Consumer Grant**:
A Workspace-scoped authorization allowing an External Agent Consumer's Service Identity to read selected accepted Records, summaries, and explicitly exposed evidence. It excludes operational configuration, credentials, Record Candidates, Runtime Artifacts, and Run Trace unless a narrower data policy explicitly exposes them.
_Avoid_: Viewer role, Operations Agent profile, unrestricted data API

**Consumer Quota**:
The per-Consumer Grant limits on request rate, outstanding work, triggered Runs, data reads, egress, cost, and maximum Priority mapping. A Workspace total remains the outer bound; Consumer exhaustion rate-limits only that Consumer, while Workspace exhaustion schedules by Priority and committed quota rather than arrival order.
_Avoid_: shared first-come budget, unlimited Consumer, quota-driven Priority escalation

**Consumer Query**:
A Consumer Grant-governed pull surface for querying selected accepted Records and summaries, including cursor-based incremental reads.
_Avoid_: database access, Run Trace query, unrestricted export

**Consumer Subscription**:
A Consumer Grant-governed push of matching new Records or summaries to a registered Destination under Egress Policy and Consumer Quota. Idempotent delivery failures may retry with evidence, while persistent failures create Operations Work Items.
_Avoid_: internal event-bus access, arbitrary webhook, untracked push

**Subscription Delivery**:
An at-least-once delivery attempt identified by stable Delivery, Record, and Subscription IDs. Consumers deduplicate by Delivery ID, acknowledgements advance the Subscription Cursor, unknown outcomes may repeat rather than disappear, and manual cursor replay creates new evidenced attempts.
_Avoid_: exactly-once promise, silent loss, retry without identity

**Record Delivery Order**:
The ordering guarantee that one Subscription observes each Record's Created, versioned Updated, and optional Withdrawn events in Record-version order. Different Records may deliver concurrently and out of order; version gaps are recovered through Consumer Query rather than a Workspace-wide global lock.
_Avoid_: global event order, arrival-time truth, cross-Record serialization

**Permission Template**:
A named, reusable set of operator permissions used to assign access consistently. The initial templates are Admin, Maintainer, Operator, and Viewer; custom roles and per-user permission exceptions are not part of the initial model.
_Avoid_: ad hoc per-user flags, prompt-defined permissions, Agent-owned permissions, custom role

**Operations Agent Authority**:
By default, an Operations Agent may only propose evidence-backed configuration or Plan changes. Approval-required proposals must appear in the Operations Inbox with their evidence and an approval action; detailed diffs and impact may open in the Canvas Approval Surface. In Automatic Mode, only whitelisted low-risk actions may execute automatically; high-risk actions require a Gate and explicit human approval. Every execution must pass through the Actuator, which no Agent may bypass.
_Avoid_: direct Agent mutation, Agent-owned execution, bypassing the Actuator, high-risk automation without human approval

**Risk Policy**:
The deterministic policy that assigns a Control Action's final risk level from its type, target, evidence, permissions, and effects. Operations Agents may supply evidence and recommend a level but cannot set or lower it; missing evidence and sensitive effects classify upward.
_Avoid_: Agent-decided risk, prompt-only policy, optimistic default

**Control Action Risk**:
The permission class assigned by Risk Policy: Low may enter an Automatic Mode whitelist; Medium defaults to one human approval but may be opened by an Admin per action type; High always requires one human approval; Critical requires two authorized humans including an Admin.
_Avoid_: Severity, Priority, self-declared safety, one global automation switch

**Advisory Mode**: The control-loop operating mode in which suggested actions are surfaced to the operator and recorded as evidence, but never executed.
_Avoid_: dry-run mode, suggestion mode

**Automatic Mode**: The control-loop operating mode in which the Actuator may execute suggestions itself, opened per state class only when accumulated evidence justifies it.
_Avoid_: autopilot, self-healing mode

**Actuator**: The component that carries out control actions against the collection system. It executes only whitelisted safe actions; everything else it downgrades.
_Avoid_: executor, auto-fixer

**Idempotent Control Action**:
An Actuator action declared safe to repeat without creating an additional effect. Only such actions may retry automatically within the same Approval Grant.
_Avoid_: assumed-safe retry, duplicate side effect, Agent-decided retry

**Compensating Control Action**:
An Actuator action explicitly declared to counter a prior action's effect when true rollback is unavailable. It is executed and evidenced through the Actuator like any other control action, never improvised by an Agent.
_Avoid_: generic rollback, Agent-authored recovery step, hidden undo

**Uncertain Control Outcome**:
An execution result in which an action is non-idempotent, partially succeeded, or left the target state unknown. Automatic execution stops, an Incident Work Item records the evidence, and further action requires human confirmation and a new approval.
_Avoid_: automatic retry, assumed failure, silent partial success

**Evidence Ledger**: The durable record of every control suggestion and execution, together with the outcome later judged from post-decision measurements.
_Avoid_: action log, audit trail

**Actor Chain**:
The complete attribution path for an operation: its human, Schedule, or Event initiator; Operations Agent identity and published version; Agent Permission Profile version; Tool Capability and version; Actuator; and every human approver. Automatic work is attributed to its System or Event trigger rather than impersonating a user.
_Avoid_: last-user attribution, Agent-only actor, hidden system trigger

**Correction Entry**:
An append-only Evidence Ledger entry that corrects a factual error by referencing the original entry without replacing it.
_Avoid_: edited evidence, overwritten history, silent correction

**Evidence Redaction Event**:
An Admin-authorized masking of credentials or protected data accidentally captured in evidence. It preserves an immutable record of the actor, time, reason, and field classification without changing the original decision, timing, outcome, or responsibility.
_Avoid_: evidence deletion, decision rewrite, Agent-performed redaction

**Recovery Rate**: The share of judged suggestions whose triggering state later cleared. It is the quantified basis for opening Automatic Mode.
_Avoid_: success rate, fix rate

**Automation Eligibility**:
The evidence-backed qualification of one action type for Low-Risk Automatic use after at least 20 judged outcomes, at least 90% Recovery Rate, no boundary or irreversible safety failure, and 10 consecutive safe recent outcomes. Eligibility permits an Admin to offer automation but never enables it by itself.
_Avoid_: automatic enrollment, Agent-decided promotion, global trust score

**Automation Enrollment**:
An Admin's explicit, user-need-driven choice to enable an eligible action for one Workspace, Operations Agent, action type, and resource scope. Scope may cover one resource, one Owning Team's resources, or the Workspace; it defaults to the narrowest choice, and expansion requires renewed confirmation. A serious adverse outcome immediately removes the enrollment and returns the Agent to Suggest Changes for that action.
_Avoid_: automatic opt-in, Workspace-wide autopilot, permanent automation grant

**Automation Activity**:
The complete Evidence Ledger stream of automatic suggestions and executions. Expected successful actions appear in filterable activity and summaries, while failures, uncertain outcomes, policy downgrades, abnormal frequency, or serious adverse results create or update Operations Work Items.
_Avoid_: one Work Item per automatic action, silent automation, notification as task

**Automation Pause**:
An immediate block on new Agent and Actuator actions at Workspace, Agent or action-type, or individual Run scope. Admins may pause any scope, Maintainers may pause Agents or action types, and Operators may pause Runs; atomic actions already underway may finish safely, while restoring Workspace or Agent automation requires an Admin.
_Avoid_: force-killing side effects, pause as permission revocation, Agent-controlled resume

**Break Glass Session**:
A 15-minute Admin-initiated emergency window limited to pre-registered service-restoration actions. It may bypass ordinary approval waiting but never Risk Policy, Gates, the Actuator, or the Evidence Ledger; it cannot change roles, Agent profiles, credentials, Egress Policy, or delete data, and it creates a Critical Incident requiring independent Admin review.
_Avoid_: emergency superuser, unrestricted override, unaudited recovery

**Require-Review Downgrade**: The policy that suggestions too dangerous to automate are executed only as "flag the source for human review", never as the suggested action itself.
_Avoid_: blocked action, action rejection

**Control Cycle**: The background loop that periodically measures every source, decides, and — in Automatic Mode — acts. It runs regardless of whether any UI is open.
_Avoid_: polling-driven control, frontend-triggered control

### Plan

**Collection Need**: The operator's desired collection outcome, expressed in domain language before node design. It is translated into a Plan made of executable nodes and resource bindings; it is not itself a node strategy or adapter configuration.
_Avoid_: treating a user request as raw node params, confusing intent with execution strategy

**External Collection Request**:
An unverified Collection Need submitted by an External Agent Consumer and represented as a Review Work Item. An Operator or Maintainer accepts, rejects, or refines it before any Plan Draft exists; the requester sees only limited receipt and outcome status, while duplicate requests are aggregated by consumer, target, and intent.
_Avoid_: Change Proposal, executable request, external Plan mutation

**Requested Urgency**:
An External Agent Consumer's stated timing need and rationale for an External Collection Request. Workspace policy maps it to an initial Priority within the Consumer Grant's ceiling, and an Operator owns the final Priority; a Consumer can never directly set Urgent.
_Avoid_: external Priority, Consumer-set Urgent, queue override

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

**Evidence Replay**:
A side-effect-free reconstruction of a completed or partial Run from its recorded Trace, events, and Artifacts for observation and audit. It remains available even when the original executable Capability is unavailable.
_Avoid_: re-execution, simulated success, replayed external effect

**Execution Replay**:
A new execution from a Run Checkpoint using the exact original Plan or Agent version, Capability Version Pins, resources, and currently valid permissions. Missing conditions create a Capability Gap; using changed versions creates a linked new Run rather than a Replay, and non-idempotent or egress actions require separate approval.
_Avoid_: approximate replay, floating-version rerun, silent side-effect repetition

**Resume Authorization**:
The Gate that combines a Checkpoint's original Plan or Agent version and Capability Version Pins with current permissions, Risk Policy, Egress Policy, Automation Pause, resource validity, and Approval Grants. Stricter current controls block resume, while looser controls never expand the original Run; using a newer executable version creates a linked new Run.
_Avoid_: checkpoint-carried permission, stale approval reuse, resume into latest version

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

**Capability Package**:
A versioned, platform-installed bundle of Capability Manifests and their runtime bindings. Platform Admins install, upgrade, disable, and verify its provenance, dependencies, and compatibility before any Workspace may enable it.
_Avoid_: Workspace-installed executable, prompt-loaded tool, unsigned runtime binding

**Workspace Capability Enablement**:
A Workspace Admin's decision to make an installed Capability available in that Workspace, bind its Execution Resources, and limit which Agents and Plans may use it. Maintainers may configure an existing enablement but cannot widen permissions or introduce new egress.
_Avoid_: platform installation, automatic Workspace access, Capability-owned authorization

**Capability Reconsent**:
The required Workspace Admin confirmation after a Capability upgrade changes permissions, risk, egress, schemas, or execution semantics. Related automation remains paused until reconsent; compatible fixes may continue after probes, with every version change recorded.
_Avoid_: silent permission expansion, automatic semantic upgrade, version drift

**Capability Trust Level**:
The platform-assigned provenance class of a Capability Package: Built-in ships with the platform, Verified is publisher-signed and probe-validated at a fixed version, and Unverified runs only in isolation without network, credentials, egress, or Primitive Capabilities. Only Built-in and Verified packages may participate in authoritative Plans or Operations Agents.
_Avoid_: package self-attestation, Workspace-defined trust, unverified production execution

**Capability Quarantine**:
A Platform Admin block on a specific Capability Package version after a security or integrity concern. It prevents new calls, pauses dependent Agents, Plans, and automation, and creates Critical Incidents in affected Workspaces; recovery requires revalidation, explicit removal of quarantine, and Capability Reconsent, never a silent version switch.
_Avoid_: package deletion, automatic fallback, Workspace override

**Capability Version Pin**:
The exact Capability Package and Capability version referenced by each Executable Canvas Node and Published Agent Version. Upgrades create a Plan Change Proposal or Agent Draft; Runs, Checkpoints, and Replays retain their original pins, and an unavailable or quarantined pin becomes a Capability Gap rather than silently resolving to another version.
_Avoid_: floating latest, implicit compatible upgrade, runtime version substitution

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

**Record Version**:
An immutable revision of a Record under its stable Record identity. Corrections create a new version rather than silently overwriting accepted content, while current queries return the latest valid version unless history is explicitly requested.
_Avoid_: mutable Record, replacement Record ID, silent correction

**Record Change Event**:
A Consumer-visible Created, Updated, or Withdrawn transition for a Record. Updated identifies the new version and change summary; Withdrawn preserves minimal lineage and reason so downstream consumers can stop using data already delivered.
_Avoid_: silent update, hard-delete notification, best-effort correction

**Record Schema**:
The versioned contract identified on every Record and owned by one Team. Maintainers may publish compatible optional-field additions; removing fields, changing meaning, or changing types requires a Change Proposal and Workspace Admin approval for a new major version that Subscriptions never adopt silently.
_Avoid_: implicit JSON shape, unversioned Record contract, silent breaking change

**Schema Ownership**:
The accountability of one Owning Team for a Record Schema's compatibility, deprecation notices, and Consumer support. Operations Agents may propose changes but never publish them, and ownership transfer carries all active-version and deprecation obligations.
_Avoid_: shared schema ownership, Agent-published schema, ownerless deprecation

**Schema Reconsent**:
The required Consumer Grant confirmation before a Consumer Query or Subscription adopts a new Record Schema major version. Existing major versions remain available through a declared deprecation period, with affected Workspace Admins notified before retirement.
_Avoid_: automatic major upgrade, best-effort compatibility, surprise schema retirement

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

**Resource Handle**:
A scoped reference through which an Agent, Plan, tool, or Actuator may use an Execution Resource without receiving its raw credential, Cookie, or Token value. It exposes availability, scope, and expiry while secret resolution remains inside the execution boundary.
_Avoid_: raw secret, prompt credential, cross-Workspace resource reference

**Evidence Redaction**:
The mandatory removal or masking of credentials and sensitive values from prompts, tool results, Run Trace, Runtime Artifacts, and the Evidence Ledger before they become observable.
_Avoid_: best-effort masking, raw diagnostic dump, secret-bearing evidence

**Destination**:
A Workspace-registered external recipient to which approved Records, summaries, or typed Runtime Artifacts may be sent through a Business Capability.
_Avoid_: arbitrary URL, prompt-provided endpoint, unregistered recipient

**Egress Policy**:
The Workspace policy that determines which data classifications may be sent to each Destination. It forbids credentials, raw Cookies, unredacted Trace, and unaccepted Record Candidates; every delivery records its Destination, classification, quantity, and outcome.
_Avoid_: Agent-decided export, unrestricted webhook, implicit external sharing

**Retention Policy**:
The Workspace policy governing how long each information class remains available: Evidence Ledger entries default to one year, Run Trace to 90 days, and Runtime Artifacts to 30 days, while Records follow their own policy. Agents cannot change retention; Workspace deletion has a 30-day recovery period before policy-driven removal, except for minimal redacted evidence that law requires to remain.
_Avoid_: one global TTL, Agent-controlled retention, Run-based Record deletion

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
