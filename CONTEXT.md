# OpenCLI Operations Platform

An open-source, node-based platform for defining, deploying, and operating automated workflows and agents.

## Language

**Workspace**:
The ownership and policy boundary within which agents can be shared across projects.
_Avoid_: Tenant, organization

**Project**:
A workspace-scoped container that organizes workflows and their authorized deployments without owning a separate execution engine.
_Avoid_: Workflow project, graph

**Agent**:
A workspace-owned, reusable definition of an intelligent worker, independent of any project-specific runtime or permission assignment.
_Avoid_: Bot, runtime

**External Agent Consumer**:
An Agent or tool that consumes processed internet data without operating or maintaining the collection platform.
_Avoid_: Operations Agent, collector

**Operations Agent**:
An Agent that observes the platform, maintains its operation, and proposes evidence-backed improvements within its assigned permissions.
_Avoid_: External Agent Consumer, unrestricted administrator

**Agent Deployment**:
A project-authorized placement of an Agent with its effective runtime and operations permissions. Projects reference Agent Deployments rather than copying Agents.
_Avoid_: Agent copy, runtime agent

**Deployment Revision**:
An immutable state of an Agent Deployment that an enabled Automation pins until an administrator explicitly upgrades it. Emergency suspension and permission revocation remain immediately effective.
_Avoid_: Latest deployment, live configuration

**Automation**:
A project-owned schedule or trigger that starts a specific published Workflow Version using only Agent Deployments authorized for that Project.
_Avoid_: Workflow, scheduled agent

**Collection Request**:
A user- or Agent-authored statement of the data to acquire, its sources, timeliness, media types, processing, and delivery needs. It is resolved into a Workflow Draft rather than executed by a separate collection engine.
_Avoid_: Collection Task, source configuration, workflow

**Workflow Version**:
An immutable, published form of a Workflow that an Automation can execute.
_Avoid_: Latest workflow, draft

**Agent Node**:
A Workflow node whose execution is assigned to one authorized Agent Deployment. Agent assignment belongs to the node, not to the Automation that triggers the Workflow.
_Avoid_: Automation agent, global agent

**Actuator**:
The mandatory boundary through which an Agent causes a system or external side effect; no Agent may bypass it.
_Avoid_: Direct action, privileged tool

**Blocked Run**:
A Run that cannot safely continue until a policy, permission, or approval condition is resolved. It is resumable and is not a failed Run.
_Avoid_: Failed run, paused agent

**Run**:
One logical execution of a Workflow Version. Resolving a block or retrying a node continues the same Run with another attempt; explicitly rerunning the whole Workflow creates a new Run.
_Avoid_: Trace, session, node attempt

**Agent Session**:
A continuous Agent conversation that is independent of Run identity. A Run uses a fresh Session by default, while an Automation may explicitly reuse one across Runs.
_Avoid_: Run, agent process

**Agent Invocation**:
The participation of an Agent Session in a specific Run and Agent Node execution.
_Avoid_: Agent Session, Run

**Artifact**:
An immutable output or evidence object that can be referenced by multiple Runs without being copied or rewritten.
_Avoid_: Mutable file, run attachment

**Artifact Link**:
A Run-specific relationship identifying an Artifact as an input, output, evidence, or attachment.
_Avoid_: Artifact copy, ownership

**Data Feed**:
A published, permissioned data product with a stable contract through which processed collection results can be queried, subscribed to, replayed, or pushed to external consumers.
_Avoid_: Workflow output, raw record, delivery channel

**Data Subscription**:
An independently configured consumer of a Data Feed with its own protocol, filter, cursor, retry, and delivery state. Adding a consumer does not modify or rerun the producing Workflow.
_Avoid_: Workflow branch, duplicated collection, feed copy

**Query Request**:
A freshness-bounded request from an Agent or application for existing or newly collected data. It searches eligible Data Feeds and indexes first, triggers an authorized Workflow when data is missing or stale, may stream partial results, and returns provenance rather than inventing missing facts.
_Avoid_: Chat answer, separate search engine, ungrounded prompt

**Coverage Policy**:
A Project or Data Feed constraint defining required source classes, regions, languages, time range, and independent-source minimums. Query and collection Nodes continue authorized collection when coverage is insufficient and report remaining gaps explicitly.
_Avoid_: Search ranking, source list, completeness claim

**Finding**:
An evidence-backed observation of an anomaly, coverage gap, risk, or optimization opportunity. Policy routes it to the Overview, Inbox, an Agent conversation, or an authorized low-risk Control Action; a Finding is not itself a notification or approval request.
_Avoid_: Alert notification, Gate Request, Agent opinion

**Signal**:
A structured, expiring Data Feed record through which an Agent, Workflow, or system publishes information, need, capability, or alert for semantic subscription. Delivery retains the match reason, evidence, visibility, acknowledgement, and feedback.
_Avoid_: Notification, raw broadcast, Agent message

**Collected Record**:
A captured unit of internet data that preserves its source metadata and original content or media Artifact.
_Avoid_: Processed result, summary

**Derived Representation**:
An immutable text, media, or structured form produced from a Collected Record with traceable Run, node, tool, and model provenance.
_Avoid_: Overwritten record, normalized truth

**Tool**:
A callable capability supplied by an Integration Package for collection, processing, delivery, or operation.
_Avoid_: Plugin, node

**Node**:
The product form through which a Tool participates in a Workflow. A Node may encapsulate multiple internal steps without exposing an additional product concept.
_Avoid_: HDA, recipe, composite

**Custom Node**:
A Workspace-owned Node definition created when a user explicitly saves changes to an installed Node's internal implementation. It is reusable across Projects and versioned independently from the installed Node.
_Avoid_: Modified official node, project node

**Device**:
A physical machine, virtual machine, browser host, or edge device that contributes execution capacity to the platform.
_Avoid_: Node, Worker

**Worker**:
An execution process running on a Device that performs collection, browser, model, or processing work.
_Avoid_: Device, Node, Agent

**Control Plane**:
The API and coordination services that own configuration, scheduling, policy, Gate state, Run metadata, and Worker registration. Its web frontend is a client and may be deployed separately.
_Avoid_: Frontend, management Mac, Worker

**Execution Plane**:
The pool of authenticated Workers that lease tasks and provide verified browser, collection, model, media, or processing capabilities. Workers may run on desktops, servers, NAS devices, cloud hosts, or edge devices independently of the Control Plane and storage location.
_Avoid_: Mac cluster, frontend host, SSH fleet

**Worker Connection**:
The authenticated outbound channel through which a Worker registers, reports health and capabilities, leases tasks, and returns results to the Control Plane. A private overlay network is optional, and SSH is reserved for installation, maintenance, or a governed Control Session rather than routine scheduling.
_Avoid_: SSH scheduler, LAN trust, network reachability

**Control Action**:
A structured request to change or operate a Device, Worker, Workflow, or external system. Human and Agent requests use the same Control Action, permission check, risk policy, Gate path, Actuator, and evidence trail.
_Avoid_: Agent action, direct SSH action, manual bypass

**Control Session**:
A time-limited, scope-limited, fully audited interactive terminal session opened by an authorized Control Action. Its commands and outputs are retained as evidence; an Agent receives one only through the same explicit authorization path as a human administrator.
_Avoid_: Raw SSH, permanent shell access, Actuator bypass

**Integration Package**:
A versioned, installable extension that adds collection, processing, delivery, or supporting service capabilities while keeping its upstream project independently upgradeable.
_Avoid_: Fork, copied dependency, plugin

**Managed Integration**:
An Integration Package whose external service can be deployed, configured, monitored, and upgraded by the platform as part of one system installation.
_Avoid_: Embedded source code, separately operated service

**Integration Catalog**:
The platform's curated set of official Integration Packages together with locally imported custom packages. It is not a public community marketplace.
_Avoid_: Marketplace, package store

**Local-first Data Plane**:
The platform boundary in which collected data, derived artifacts, indexes, and processing remain in the user's environment by default, while explicit cloud processing remains supported and visible.
_Avoid_: Offline-only system, local model only

**Verified Capability**:
A capability that a discovered local or cloud deployment has demonstrated through a runnable Workflow check. Discovery alone does not make a capability available to production nodes.
_Avoid_: Installed model, advertised feature

**Capability Requirement**:
A hardware- and vendor-neutral requirement declared by a Workflow Node for scheduling, such as browser session, network region, model function, memory, accelerator, or media support. The scheduler matches it only to a compatible Verified Capability.
_Avoid_: GPU model, fixed Device, machine role

**Connection**:
A Workspace-owned reusable authentication or connectivity configuration, such as an API token, browser login, cookie store, or service endpoint. Sensitive material is referenced rather than copied into Sources or Workflow Nodes.
_Avoid_: Data source, node credential, copied secret

**Connection Node**:
A Workflow Node that resolves an authorized Connection into a runtime-only credential or session reference. It may expose health and selection parameters, but never secret values in the Workflow graph, export, or Run log.
_Avoid_: Cookie node, plaintext credential node, embedded account

**Connection Version**:
An immutable encrypted revision of a Connection's authentication material or browser session. Runtime selection may advance to a newer healthy version while retaining short-lived rollback evidence without exposing plaintext.
_Avoid_: Cookie copy, mutable secret

**Source**:
A Project-owned collection target and scope, such as repositories, accounts, searches, sites, or streams. It references a Connection when authentication is required and is consumed by Workflow Nodes.
_Avoid_: Connection, credential, integration

**Source Group**:
A Project-owned reusable selection of Sources processed by one Automation and Workflow Version. Per-Source cursors, Connection references, limits, retries, and outcomes remain independent inside the resulting Run.
_Avoid_: Workflow per website, copied source list

**Workflow-local Override**:
A Draft-only derived implementation of a packaged Node that is scoped to one Workflow. It becomes reusable across Projects only when explicitly promoted to a Workspace-owned Custom Node.
_Avoid_: Modified installed node, implicit shared node

**Inbox**:
The user-facing view of unresolved requests that require attention or approval. It does not own a separate approval state.
_Avoid_: Approval database, notification log

**My Work**:
The personal Inbox view of items for which the current user is the required or assigned next actor.
_Avoid_: Notifications, all activity, personal backlog

**Project Triage**:
The project-level Inbox view of unresolved items that still need classification, acceptance, dismissal, or conversion into planned work. It remains useful when one person operates the Workspace.
_Avoid_: My Work, project notifications, issue tracker

**Project Context**:
The active Project filter and navigation context applied to shared platform modules. A Project aggregates its Workflows, recent results, Data Feeds, Automations, and Triage without duplicating global data-source, run, device, worker, or integration administration.
_Avoid_: Project admin console, nested workspace, duplicated module

**Overview**:
The global operational view organized around Project data production, freshness, failures, Data Feeds, Automations, and cross-project anomalies, with only a small system-wide summary above it.
_Avoid_: Infrastructure dashboard, second monitoring product, metric wall

**Gate Request**:
The single pending fact that records why a Run requires approval before it may continue. Approval is limited to the request's exact action, target, parameters, permissions, and validity period.
_Avoid_: Inbox item, approval notification

**Gate Decision**:
The single recorded outcome of a Gate Request.
_Avoid_: Inbox action, run status
