# OpenCLI Agent-Driven Data Operations Platform PRD

## Problem Statement

OpenCLI Admin 当前已经拥有采集来源、运行、Agent、Worker、节点画布、通知、记录和控制动作等能力，但它们仍以技术对象和历史页面为中心组织。用户无法从一个持续业务目标出发，顺畅完成“创建项目、配置真实连接、编排采集和处理、发布版本、自动运行、向外部系统写入、确认业务结果、处理失败并恢复”的完整闭环。

现有前端还存在以下核心问题：

- 全局导航、工作区、工作流、任务、节点和执行资源的分类混杂，用户难以判断应该从哪里开始。
- 项目创建的 Agent 引导、模板和空白路径没有汇合到同一个持久化对象，空白状态也缺乏下一步指导。
- 概览缺少足够的业务数据可视化，已有图表又没有形成全局聚合与项目下钻的一致指标体系。
- Agent 对话、人工编辑和运行时执行可能形成多套状态，缺少统一的提案、权限、确认和证据路径。
- Connection、浏览器登录态、邮箱凭据、节点绑定和执行资源的边界不清，无法证明最小权限。
- 外部发送或写入容易把“请求已提交”误认为“业务已完成”，在超时和重试时可能重复发信、重复发布或重复提交表单。
- 失败信息分散在运行日志、通知和页面错误中，用户无法在原始上下文里安全接管并恢复。
- 插件、Agent、工作流节点和执行资源尚未形成清晰的产品边界，容易继续演变成通用聊天机器人、通用低代码平台或基础设施拓扑工具。

产品需要回到第一性原理：用户购买的不是一个画布、聊天框或采集器，而是一条可持续运营、可审计、可恢复的数据生产与外部行动闭环。

## Solution

将 OpenCLI Platform 定义为“Agent 驱动的数据采集、处理与交付平台”。`Project` 是用户持续业务成果的主要边界，拥有一个或多个 `Workflow`、数据 `Source`、外部 `Destination`、`Automation`、`Run`、`Work Item` 和 `Agent Deployment`。

用户可以通过 Agent 引导、模板或空白三种入口创建项目，但三条路径立即汇合为同一个持久化 `Project Draft` 和 `Primary Workflow`。Agent 对话与可视化界面操作相同的领域对象，不维护影子状态。所有高风险修改和外部副作用通过统一的提案、权限、风险、确认、执行与证据链。

产品外壳采用 Linear 式工作导向的信息架构：全局只有一层侧栏；进入项目后使用“概览、编排、运营、数据、协作、设置”六个横向入口。Dify 式节点编辑只存在于“编排”页面。Houdini 式节点内部展开只在高级场景按需进入，不成为整个产品的导航方式。

项目概览采用“行动层＋分析层”。首屏显示项目目标、运行状态、就绪度、阻塞、下一步、待处理事项和核心图表；下方保留此前开发的完整图表，并按数据生产、执行、交付、Agent 协作、资源与成本分组。全局概览和项目概览复用同一套指标定义与可视化组件：全局聚合和排名，项目下钻和诊断。

运行闭环采用以下核心链路：

`Source → Workflow → Sink Node → Side Effect Operation → Delivery → Delivery Business Outcome`

每次外部副作用拥有稳定的 `Operation ID`。插件声明原生幂等、查询后写入与平台去重，或明确不可幂等。Delivery 分别记录技术提交结果和业务结果。结果未知时禁止盲目重试；系统按能力契约查询、等待、重试、补偿或创建 `Recovery Case`。真正需要人的 Recovery Case 进入唯一全局 Inbox，并关联原始 Project、Workflow Version、Run、节点、Operation、检查点和脱敏证据。

凭据通过四层授权逐级收窄：Workspace Connection 与策略定义能力上限，Project Connection Binding 授予项目子集，Node Instance 选择最小所需能力，运行时为单次 Run、节点、操作和触发身份签发短期 `Execution Grant`。插件和执行资源不获得可复用的工作区秘密。

## User Stories

1. As an operator, I want to create a Project by describing a desired data outcome to the Operator Agent, so that I can start without understanding node implementation details.
2. As an operator, I want to create a Project from a template, so that common collection and delivery patterns start with proven defaults.
3. As an operator, I want to create a blank Project, so that expert users can start directly from the normal Workflow Canvas.
4. As an operator, I want all three creation paths to produce the same durable Project Draft, so that I can switch between Agent guidance and manual editing without losing work.
5. As a new user, I want a blank Workflow to guide me through Source → Process → Deliver, so that an empty canvas is still actionable.
6. As an operator, I want the Agent to identify missing capabilities and Connections during creation, so that a draft never pretends to be runnable.
7. As an operator, I want to enter real credentials during guided setup, so that I can complete configuration without leaving the creation flow.
8. As a security administrator, I want entered credentials stored only in a workspace Connection or secret store, so that templates, frontend state and Workflow definitions never contain secrets.
9. As an operator, I want to select an existing Connection when possible, so that I do not duplicate accounts or login sessions.
10. As an operator, I want a persistent Setup Center, so that missing or unhealthy configuration remains visible after onboarding.
11. As an operator, I want the Setup Center to offer manual setup or Agent-assisted setup for the same item, so that both paths update the same authoritative configuration.
12. As an operator, I want readiness derived per capability, so that a Project is blocked only by the capabilities it actually needs.
13. As a workspace administrator, I want Workspace management outside the primary daily navigation, so that governance does not compete with operational work.
14. As an operator, I want one global sidebar, so that navigation remains stable across all Projects.
15. As an operator, I want Project-local horizontal navigation, so that I can move between Overview, Orchestration, Operations, Data, Collaboration and Settings without navigating a second resource tree.
16. As an operator, I want the Workflow Canvas only inside Orchestration, so that ordinary monitoring and collaboration do not feel like using an IDE.
17. As an operator, I want the Global Overview to rank Projects and highlight anomalies, so that I can decide where attention is needed.
18. As a Project owner, I want the Project Overview to show the outcome, readiness, blockers and next actions first, so that the page helps me make decisions.
19. As an analyst, I want all previously developed operational charts retained, so that the redesign does not remove useful diagnostic information.
20. As an analyst, I want charts grouped by data production, execution, delivery, Agent collaboration and resource cost, so that a large visualization set remains understandable.
21. As an operator, I want Global and Project Overview metrics to use the same definitions, so that numbers do not change meaning when I drill down.
22. As an operator, I want every chart anomaly to deep-link to its underlying Source, Workflow, Run, Delivery, Agent or resource, so that visualization leads directly to action.
23. As an operator, I want Inbox to contain only items requiring human action, so that it remains a trusted queue rather than a notification feed.
24. As an operator, I want assigned Work Items, pending Agent proposals, Recovery Cases, delivery exceptions and access requests in one global Inbox, so that I have a single place to act.
25. As an operator, I want ordinary activity and informational notifications outside Inbox, so that low-value events do not bury required action.
26. As a team member, I want a Work Item to have an owner, dependencies, status, handoff, confirmation and Deliverable, so that human and Agent collaboration is explicit.
27. As a Project owner, I want the Collaboration page to show members, Work Items, Agents and dependencies, so that I can understand who is doing what.
28. As a Project owner, I want an optional Agent Collaboration Topology, so that complex handoffs and dependencies can be diagnosed without confusing them with Workflow nodes.
29. As an operator, I want the Agent Dock available throughout the application, so that I can inspect and operate the current context without visiting a separate AI page.
30. As an operator, I want the active Agent context to show Project, page, selected object, Run and permissions, so that I can see what the Agent believes I am referring to.
31. As an operator, I want Agent proposals to show targets, base revisions, diff, risk, evidence and confirmation requirements, so that I can review a concrete operation rather than trust prose.
32. As an operator, I want safe draft edits to support undo, so that low-risk Agent assistance remains fast.
33. As an administrator, I want publishing, activation, credentials, permissions, deletion and external effects to require explicit approval, so that Agent dialogue cannot bypass governance.
34. As an external Agent client, I want to use the same Agent Control API through MCP or an SDK, so that Codex and Claude operate under the same controls as the first-party Agent.
35. As an auditor, I want the delegation chain from human or Automation through Agent, proposal, Run, node and Execution Grant, so that the accountable authority remains visible.
36. As a Project editor, I want Agent and human changes tied to base revisions, so that stale proposals cannot overwrite current work.
37. As a Project editor, I want non-overlapping changes safely rebased with the final diff shown, so that simple concurrent work does not create unnecessary locks.
38. As a Project editor, I want overlapping or authority-changing changes to invalidate stale proposals, so that conflicts require a fresh decision.
39. As a Project editor, I want published Workflow Versions immutable, so that Runs and audit evidence always reference the actual executed design.
40. As an operator, I want a mutable Workflow Draft that can be validated before publication, so that incomplete authoring cannot become an authoritative Run.
41. As an operator, I want publication to create an immutable Workflow Version without activating it, so that design release and execution activation remain separate decisions.
42. As an operator, I want an Automation to reference an explicit Workflow Version, so that schedules and events never silently switch to a newer draft.
43. As an operator, I want a Run to record its Workflow Version, trigger, state, events, artifacts, cost and errors, so that execution is reproducible and diagnosable.
44. As an operator, I want only executable data or control steps represented as Workflow nodes, so that the graph remains the program rather than an inventory diagram.
45. As an operator, I want Source, Trigger, Transform, Agent, Branch, Approval and Sink node families, so that collection, processing, control and delivery are all expressible.
46. As an operator, I want Connections, Destinations, plugins, Agent definitions, Execution Resources, Automations, Runs and policies kept outside the node graph, so that configuration objects are not mistaken for execution steps.
47. As an operator, I want business-level Operator Nodes by default, so that common workflows remain understandable.
48. As an advanced operator, I want an Expandable Node to reveal its internal implementation graph on demand, so that I can customize or diagnose complex behavior without cluttering the parent Workflow.
49. As an advanced operator, I want breadcrumbs to show the active Node Scope, so that entering an internal graph never changes context invisibly.
50. As a Project owner, I want structural customization of a locked Plugin Node Definition to create a Project-owned derivative, so that plugin upgrades do not overwrite my changes.
51. As a Project owner, I want to view the source version, changed status and diff of a derived node, so that customization remains understandable.
52. As an operator, I want plugin-provided nodes, Agent tools, Sources and Sinks rendered by the platform from schemas, so that the product retains one coherent UI and security model.
53. As a workspace administrator, I want to enable or disable a Plugin per workspace, so that optional capabilities do not become permanent product areas.
54. As an operator, I want a Data Analysis Plugin to provide analysis nodes and Agent tools when enabled, so that DataFoundry-like analysis can be used without embedding another workbench.
55. As a workspace administrator, I want Connections to expose read and write capabilities separately, so that one mailbox or website account does not imply unrestricted access.
56. As a Project owner, I want a Connection Binding to authorize only selected account capabilities and target scopes, so that Project access remains narrower than Workspace access.
57. As a Workflow author, I want each Node Instance to select the smallest subset of a Project Binding, so that a read node cannot silently send or publish.
58. As a runtime administrator, I want each node execution to receive a short-lived Execution Grant, so that plugins and Workers cannot reuse workspace credentials.
59. As a security administrator, I want grants recalculated when a Binding or policy changes, so that revoked access stops future Runs without rewriting Workflow Versions.
60. As an auditor, I want plugins prevented from enumerating unrelated Connections or reading reusable secrets, so that plugin execution cannot become a credential exfiltration channel.
61. As an operator, I want one email Connection to expose collection and delivery separately, so that I can receive mail without automatically authorizing outbound mail.
62. As an operator, I want a Destination to identify the permitted mailbox recipients, website account, community, repository or storage scope, so that external writes target an explicit business object.
63. As an operator, I want a Sink Node to require preview and confirmation for one-off writes, so that accidental messages or publications are stopped before submission.
64. As an Automation owner, I want to preauthorize bounded recipients, accounts, content classes, frequency and limits, so that trusted recurring delivery does not require confirmation every time.
65. As an operator, I want every intended external mutation to have a stable Operation ID, so that retries remain the same business intent.
66. As a plugin author, I want to declare native idempotency, lookup-before-write deduplication or non-idempotent behavior, so that the runtime knows how to retry safely.
67. As an operator, I want an unknown submission result checked before retry, so that a timeout does not cause duplicate mail, posts or form submissions.
68. As an operator, I want non-idempotent actions to have stricter confirmation and bounded retries, so that unsafe external systems are treated honestly.
69. As an auditor, I want all attempts, deduplication decisions and external object IDs linked to one Operation, so that repeated execution remains explainable.
70. As an operator, I want Delivery Execution Result separated from Delivery Business Outcome, so that technical acceptance is not mistaken for delivery or publication success.
71. As an operator, I want email bounces, receipts, callbacks, status queries, semantic response checks and authorized confirmation to update Business Outcome, so that asynchronous systems are represented accurately.
72. As an Automation owner, I want Destination policy to decide whether pending outcomes wait, continue, retry, compensate or require a person, so that not every asynchronous delivery blocks the Workflow.
73. As an operator, I want compensation represented as a new governed operation, so that the system does not claim impossible rollback semantics across external systems.
74. As an operator, I want safe automatic retry and recovery to happen without creating Inbox noise, so that routine transient failures remain automated.
75. As an operator, I want an unresolved failure to create a Recovery Case with the original Run context, so that I can act without searching across pages.
76. As an operator, I want Recovery Case evidence redacted but sufficient, so that I can diagnose the failure without exposing secrets.
77. As an operator, I want only capability-declared Recovery Actions, so that recovery cannot become an arbitrary production shell.
78. As an operator, I want to reauthenticate or replace a Connection Binding from a Recovery Case, so that expired sessions can be repaired in context.
79. As an operator, I want to query external status, safely retry the same Operation, adjust permitted input, skip, compensate or terminate when allowed, so that different failure classes have appropriate recovery.
80. As an auditor, I want the failed Run history preserved when recovery resumes, so that intervention never rewrites evidence.
81. As an operator, I want execution resources shown as Workers, Runners, hosts, runtimes and capacity, so that infrastructure health is visible without mixing it with Workflow nodes.
82. As an operator, I want resource topology only when placement, reachability or capacity relationships are complex, so that simple environments keep a usable status view.
83. As an operator, I want browser sessions, account contexts and Runtime Bindings kept separate from Execution Resources, so that credentials are not presented as infrastructure.
84. As a personal user, I want theme, language, timezone, sidebar and alert preferences under my account, so that personal choices do not look like workspace governance.
85. As a workspace administrator, I want members, roles, Connections, providers, plugins, execution policy, data retention, delivery configuration, approvals, audit and health under Governance & Settings, so that shared control is centralized.
86. As a Project owner, I want Project Settings limited to project identity, access, authorized resources, execution limits, data and delivery policy, and dangerous operations, so that workspace settings are not duplicated.
87. As a Project owner, I want cost, quota and rate signals visible in the Project Overview and managed in Project Settings, so that resource use is actionable without becoming a separate navigation area.
88. As an operator, I want global search and command discovery separate from Agent intent handling, so that navigation remains fast while complex changes stay reviewable.
89. As a developer, I want legacy `Plan` and `Task` names isolated to compatibility boundaries, so that new product APIs and UI use Workflow, Work Item, Run and Execution Task consistently.
90. As a product owner, I want the complete project lifecycle proved by one public end-to-end conformance journey, so that isolated component tests cannot falsely claim the product loop works.

## Implementation Decisions

- Product identity is fixed as Agent-driven data collection, processing and delivery. The product shell must not drift into a generic chatbot, generic low-code platform, infrastructure atlas or embedded third-party workbench.
- `Project` is the primary user-owned outcome boundary. It owns one or more Workflows, with a Primary Workflow as the normal authoring entry.
- Project creation has three entry experiences—Agent-guided, template and blank—but one persistence path and one Project Draft state machine.
- Templates are read-only one-time blueprints. Instantiation copies them into a Project Draft, reports Capability Gaps and retains no live template subscription or credentials.
- Global navigation is grouped into Operations, Work, Execution, Capabilities and System. The primary entries are Overview, Inbox, Projects, Work Items, Runs, Automations, Results & Data, Agents, Execution Resources, Plugins & Tools, and Governance & Settings.
- Workspace is a governance and shared-resource boundary, not a primary daily navigation item. Workspace switching appears only when multiple workspaces exist.
- Project navigation is a horizontal local layer with Overview, Orchestration, Operations, Data, Collaboration and Settings. No nested permanent sidebar or IDE-style resource tree is introduced.
- Project Overview is action-first but retains the full existing chart set. Global and Project views reuse metric definitions and visualization components with different scopes.
- Agent Dock is the persistent Conversational Operations Surface. Embedded Agent conversations reuse the same session, context and proposals rather than creating page-local assistants.
- Agent Operation Proposals contain target objects, base revisions, diff, risk, validation evidence and confirmation requirements. Proposal application uses optimistic revision guards.
- External Operator Agents use an authoritative Agent Control API. MCP and SDK surfaces are adapters to the same permissions, Gates, proposals, execution and evidence path.
- Workflow Draft is mutable. Validation produces a publishable state. Publication creates an immutable Workflow Version. Automation activation is separate from publication, and Runs reference explicit versions.
- Workflow nodes are restricted to executable Source, Trigger, Transform, Agent, Branch, Approval and Sink steps. Configuration, ownership, resources, credentials, policies, Runs and Deliveries remain domain objects outside the graph.
- Operator Nodes are the default authoring level. Expandable Nodes may expose internal graphs at arbitrary useful depth with explicit Node Scope breadcrumbs; no fixed four-layer hierarchy is required.
- Plugin Node Definitions are locked. Structural customization creates a Project Node Definition derived from the source plugin version. Workspace node-library publication, node release approval and automatic instance migration are not included.
- Plugins provide capabilities through manifests, typed schemas, permissions, probes, icons, localized metadata and platform-rendered UI. Arbitrary plugin React routes, top-level navigation and competing application shells are prohibited.
- Data analysis is an optional first-party bundled plugin. It may adapt selected Apache-licensed capabilities or call an external analysis runtime, but OpenCLI owns Project, Workflow, auth, Run, evidence, artifacts and delivery.
- Connection is workspace-owned. Source and Destination are Project-owned scopes. Connection Binding authorizes a Project and Node subset without copying secrets.
- Execution Grant is short-lived and computed from workspace capability, workspace policy, Project Binding, Node scope and triggering authority. Runtime components receive mediated capability access, not reusable secrets.
- The delegation chain is evidence: human or Automation, Operator Agent, proposal, Run, Node Instance and Execution Grant identities remain linked.
- Side Effect Operation is the stable business identity of an external mutation. Delivery attempts and retries remain under one Operation ID.
- Each plugin write capability declares a Side Effect Contract: native idempotency, lookup-before-write plus platform deduplication, or non-idempotent.
- Unknown external results cannot trigger blind retry. Runtime follows the declared outcome lookup, timeout and recovery strategy.
- Delivery stores technical Execution Result separately from Business Outcome. Outcome evidence may arrive synchronously, asynchronously or through authorized human confirmation.
- Compensation is a separate governed reverse operation with its own identity and evidence.
- Recovery Case is the only new human-intervention object for execution recovery. It appears in global Inbox and links to the original Project, Workflow Version, Run, node, Operation, checkpoint and evidence.
- Recovery Actions are typed, capability-declared and policy-authorized. The original failure history is immutable; resumed work is linked to it.
- Inbox remains the single global human-action queue. Ordinary notifications and activity do not enter it. Project and Run scopes are filters, not additional inboxes.
- Work Item is the collaborative unit for human and Agent ownership, dependency, handoff, confirmation and Deliverable. Execution Task remains an internal schedulable Run unit.
- Execution Resources are compute and runtime capacity. Runtime Bindings and Connections are not execution resources. Topology is an optional analytical view rather than the default product shell.
- Persistent Setup Center derives Capability Readiness and Project Readiness from connections, bindings, permissions, plugins, resources, policy and probes. It has no universal completion percentage.
- Personal Preferences and Governance & Settings remain separate. Project Settings contains only project-scoped access, authorized resources, limits, policy and dangerous operations.
- Frontend and backend must migrate user-facing legacy `Plan` and undifferentiated `Task` terminology while preserving compatibility at explicitly documented boundaries.
- Implementation is phased around the minimum real loop. Email read/write, one representative website read/write capability, credential binding, Workflow lifecycle, Delivery outcome, idempotency and Recovery Case form the P0 proof.

## Testing Decisions

- The primary acceptance seam is one end-to-end Project lifecycle exercised through public product contracts: create Project Draft, configure Connection Binding, validate and publish Workflow, trigger Run, collect and process data, perform an external write, resolve Delivery Business Outcome, create a Recovery Case when required and resume from a checkpoint.
- Extend the existing workflow runtime conformance harness rather than creating separate bespoke frameworks for credentials, idempotency, delivery and recovery.
- Canonical conformance fixtures cover at least: happy-path email collection and delivery, missing Binding, permission blocked, expired login, native idempotency retry, lookup-before-write deduplication, unknown external result, asynchronous outcome confirmation, non-idempotent write requiring confirmation, Recovery Case creation and checkpoint resume.
- Expected event transcripts assert stable public facts and ignore volatile identifiers and timestamps unless ordering is the behavior under test.
- The public Run event stream is the authoritative backend evidence seam. It must expose binding resolution, grant identity, Operation ID, attempt, Delivery Execution Result, Business Outcome, checkpoint and Recovery Case linkage without exposing secrets.
- Add one browser-level critical journey that drives the same lifecycle through the real UI and asserts user-visible state transitions and drill-down destinations.
- Existing frontend source-regression scripts remain lightweight guardrails for navigation, labels and composition, but they are not sufficient completion evidence.
- Domain services and state machines receive targeted unit tests for revision guards, capability-scope intersection, idempotency decisions, outcome transitions and allowed Recovery Actions.
- Security tests assert that frontend state, Workflow definitions, event transcripts and plugin inputs never expose reusable secret material.
- Contract tests prove that read and write capabilities for the same Connection can be authorized independently.
- Recovery tests prove that the original failed Run and evidence remain unchanged after resume or compensation.
- Published Workflow Version tests prove immutability and ensure Automations do not silently follow mutable drafts.
- Overview tests validate metric definition reuse between global aggregation and Project filtering, plus deep links from anomalies to underlying objects.
- Accessibility and responsive browser checks cover global navigation, Project tabs, Agent proposal review, Inbox Recovery Case actions and Workflow Canvas entry.
- A feature is not complete until the canonical lifecycle passes, targeted contracts pass, frontend lint and typecheck pass, backend unit tests pass and the browser journey has fresh evidence.

## Out of Scope

- Generic chatbot or prompt-only administration.
- Generic low-code application builder.
- General-purpose RPA selector editor or visual scraper product.
- Arbitrary plugin-owned frontend bundles, routes, navigation or iframes.
- Plugin marketplace, commercial ecosystem and third-party billing.
- Publishing Project Node Definitions to a Workspace node library.
- Approval-based custom node releases and automatic migration of existing Node Instances.
- Google Docs-style CRDT simultaneous editing of the Workflow Canvas.
- Universal synchronous business confirmation for every Delivery.
- Claims of exactly-once transport across external systems.
- Fictional rollback of already committed external side effects.
- Full infrastructure digital-twin topology as the default Execution Resources experience.
- DataFoundry workbench, authentication, model administration or TUI embedded as a top-level product.
- Mobius source code or protected UI integration; only independently reimplemented capability ideas are permitted.
- Multi-workspace enterprise billing, complex chargeback and marketplace revenue sharing in P0.
- Automatic Project activation or automatic Workflow Version migration.
- Ordinary notifications inside the global Inbox.

## Further Notes

- Canonical terminology and avoided synonyms are maintained in the root domain glossary.
- Accepted architectural decisions covering Agent Control API, reference implementation boundaries, optional analysis plugin, declarative plugin UI, Setup Center, node eligibility and expansion, locked plugin definitions, unified Project creation, Delivery outcome, Execution Grants, side-effect identity, Recovery Cases and revision guards are recorded in ADR 0012 through ADR 0025.
- Linear is the interaction reference for work-oriented clarity. Dify is a reference for Workflow authoring and template entry. Houdini is a reference for locked reusable node definitions and optional internal expansion. None of them defines the complete product shell.
- The earlier charts remain product requirements. The redesign adds decision context and drill-down without deleting established operational visualizations.
- Cross-model review with Qwen 3.7 Deep Thinking, DeepSeek Expert and Tencent Yuanbao informed prioritization, but model suggestions were filtered against the confirmed domain model. Blockchain audit, removal of declarative plugin UI and blanket suspension of Automation were explicitly rejected as over-design or category errors.
- P0 implementation order is: canonical Project shell and lifecycle, Connection Binding and Execution Grant, external Operation idempotency, Delivery outcome state, Recovery Case, then broader plugin and collaboration expansion.
