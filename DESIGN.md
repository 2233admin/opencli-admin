# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-24
- Primary product surfaces:
  - Workspace and project browser
  - Workflow authoring canvas
  - Node configuration and run inspection
  - Connected data sources
  - Runs, work items, records, providers, and execution resources
- Current UX benchmark task:
  - A business user can create and run `定时计划 → 采集 A 股市场数据 → 核验并准入数据 → 更新 A 股金融数据集` without understanding OpenCLI commands, package internals, runtime bindings, databases, or port types.
- Evidence reviewed:
  - `frontend/app/(app)/studio/workflow/page.tsx`
  - `frontend/components/flow/command-palette.tsx`
  - `frontend/components/flow/command-strip.tsx`
  - `frontend/components/flow/inspector.tsx`
  - `frontend/components/flow/nodes/workflow-node.tsx`
  - `frontend/components/flow/workflow-editor-session.tsx`
  - `frontend/lib/workflow/business-node-experience.ts`
  - `frontend/lib/workflow/node-catalog.ts`
  - `frontend/lib/workflow/source-business-config.ts`
  - `frontend/app/globals.css`
  - `docs/DESIGN_SYSTEM.md`
  - `docs/design-audit-2026-07-02.md`
  - `docs/adr/0008-collection-canvas-primary-authoring-surface.md`
  - `docs/adr/0017-only-executable-flow-steps-are-workflow-nodes.md`
  - `docs/adr/0018-expandable-business-nodes-without-a-fixed-depth-hierarchy.md`
  - `docs/adr/0019-locked-plugin-node-definitions-and-project-owned-derivatives.md`
  - `docs/adr/0020-project-creation-paths-converge-on-one-durable-draft.md`
  - `openspec/changes/fuse-dify-paperclip-frontend-template/design.md`
  - Live Studio review of project `A 股真实金融数据采集`

## Brand
- Personality: Calm, capable, direct, technical only when the user asks for technical detail.
- Trust signals:
  - What the workflow will do is visible before it runs.
  - Data source identity, freshness, health, and permission state are visible.
  - Run state, partial results, failures, and recovery actions are explicit.
  - Human and Agent edits produce the same reviewable Workflow draft.
- Avoid:
  - Showing implementation vocabulary as the primary label.
  - Making the user interpret `ACTION::ACTION`, catalog ids, runtime names, package locks, adapter ids, or raw OpenCLI arguments.
  - Presenting blocked or design-only capabilities as normal creation choices.
  - Requiring manual graph wiring for the common linear path.
  - Decorative dashboard styling that competes with the work.

## Product goals
- Goals:
  - Make intent-to-first-successful-run the primary Workflow authoring journey.
  - Keep the Canvas as the executable source of truth while removing unnecessary graph mechanics from routine use.
  - Give human users and Agents one shared creation and editing model.
  - Make connected data sources selectable business resources, not handwritten node parameters.
  - Preserve expert access to contracts, internals, source mappings, and execution traces without placing them in the default path.
- Non-goals:
  - Do not turn projects, providers, credentials, databases, execution resources, or Agent teams into Workflow nodes.
  - Do not expose the full primitive/catalog inventory as the default node picker.
  - Do not require every Workflow to use a fixed four-level internal node hierarchy.
  - Do not clone Dify's application-type taxonomy. Reuse its low-friction editing rhythm where it fits OpenCLI.
  - Do not create a second simplified Workflow model separate from `WorkflowProject`.
- Success signals:
  - A new user builds and test-runs the A-share benchmark in under three minutes.
  - The benchmark requires no raw command, adapter, credential, database, or port-type entry.
  - A node added from an edge is connected automatically and opens directly to its required business settings.
  - The default picker contains runnable choices only.
  - The user can identify the failing stage and recovery action without opening execution logs.
  - Human and Agent changes are both presented as the same graph diff and revision.

## Personas and jobs
- Primary personas:
  - Business builder: knows the desired data or outcome, not the runtime implementation.
  - Operator: monitors runs, freshness, failures, and source health.
  - Expert builder: inspects contracts, edits advanced mappings, and derives project-owned nodes.
  - AI Agent: selects existing capabilities, proposes valid patches, fills business parameters, and monitors runs.
- User jobs:
  - Describe what data or outcome is needed.
  - Select trusted, connected sources.
  - Assemble a clear Source → Process → Deliver flow.
  - Test a step or the whole Workflow with real data.
  - Understand output quality, freshness, duplicates, rejected items, and lineage.
  - Recover from missing configuration or unavailable resources.
- Key contexts of use:
  - Desktop-first Workflow authoring.
  - Long-running multi-source collection.
  - Mixed human/Agent editing of the same durable draft.
  - Occasional expert diagnosis of packaged-node internals.

## Information architecture
- Primary navigation:
  - 工作区: projects and their Workflows.
  - 自动化: connected data sources and schedules.
  - Agent 团队: Agent definitions and collaboration.
  - 工作项: running, failed, and review work.
  - 执行资源: available runtimes and workers.
  - 成果与数据: accepted records, reports, and other durable outputs.
  - 治理与设置: providers, permissions, and platform configuration.
- Core routes/screens:
  - Workspace project browser.
  - Project Workflow editor.
  - Data source catalog/detail.
  - Run and evidence inspection.
  - Records/output browser.
- Workflow content hierarchy:
  1. Business outcome and draft state.
  2. Executable business stages on the Canvas.
  3. Selected-stage configuration or result.
  4. Validation and recovery guidance.
  5. Advanced implementation, contracts, and internals.
- Node picker hierarchy:
  - 开始: manual, schedule, webhook.
  - 采集: connected sources and multi-source collection.
  - 处理: clean, deduplicate, enrich, Agent, review, branch.
  - 输出: Records, report, notification, webhook.
  - 高级: primitives, imported vocabulary, implementation nodes, and non-runnable definitions.
- The current top-level split `业务节点 / 工具 / 数据源 / 开始 / 辅助` is retired for ordinary authoring because it mixes abstraction level, implementation type, and task stage.

## Workflow authoring contract
- Blank canvas:
  - Lead with one prompt: `你想让这个工作流完成什么？`
  - Offer three paths: `让 Agent 帮我搭建`, `从模板开始`, `空白工作流`.
  - All paths create and edit the same durable Workflow draft.
  - A blank draft displays the guide `开始 → 采集 → 处理 → 输出`.
- Adding a step:
  - The primary entry is a `+` on an empty terminal or existing edge.
  - Selecting a step inserts it at that location, creates compatible edges, selects the node, and opens required settings.
  - The top-level `添加节点` button remains as a secondary global action.
  - Search matches business names, outcomes, and connected source names.
  - Runnable choices appear first; blocked/design choices are hidden under `高级` and cannot masquerade as usable steps.
- Node cards:
  - Default: icon, verb-object business name, one-line configuration summary, run state, and required-action badge.
  - Selected/running: expose input/output handles, progress, item counts, and freshness.
  - Hide catalog id, package lock, runtime id, and raw type line from the default card.
  - Show implementation details only in `高级` or `查看实现`.
- Node naming:
  - Use verb + business object: `采集 A 股市场数据`, `核验并准入数据`, `更新 A 股金融数据集`.
  - Product/runtime names are secondary metadata, never the title.
  - Automatic names remain editable per node instance.
- Node configuration:
  - Default tabs: `设置`, `测试与结果`, `执行记录`.
  - Show `提示词` only for nodes that actually expose a prompt.
  - Show the smallest business interface required to run.
  - Advanced source mapping, contracts, internals, and raw parameters live under `高级`.
- Source selection:
  - A collection node selects already connected data sources by name and site icon.
  - Each source row shows health, last successful fetch, data freshness, and permission state.
  - Business fields such as topic, market, date window, and result limit are first-class controls.
  - Raw `site`, `command`, `args`, adapter id, credentials, and worker selection are not required in the ordinary path.
  - `管理数据源` opens the global resource surface and returns the user to the same node after connection.
- Human and Agent editing:
  - Agent input is available from the Workflow editor, not as a separate application type.
  - The Agent may propose nodes, edges, source selections, names, and business parameters using existing capabilities.
  - Every proposal shows `新增 / 修改 / 删除`, validation impact, and missing resources before apply.
  - Accepting a proposal updates the same revisioned draft used by manual editing.
  - Agent conversation never silently runs or publishes a changed Workflow.
- Test, validate, publish:
  - `试运行` is the primary action while drafting.
  - The user can run one selected node or the whole Workflow.
  - Results emphasize business evidence: fetched, accepted, duplicate, rejected, stored, freshness, and source coverage.
  - Validation problems appear on the affected node and in a compact readiness summary.
  - `发布` is enabled only after validation and remains visually secondary during initial construction.

## Design principles
- Principle 1: Start from intent, reveal implementation on demand.
- Principle 2: The graph is the program, but drawing the graph is not the user's job.
- Principle 3: One concept has one home. Sources are managed globally and selected in nodes; runs are inspected from nodes and Work Items; outputs live in Records.
- Principle 4: Business truth before runtime truth. Show freshness, coverage, counts, and failures before bindings and contracts.
- Principle 5: Human and Agent actions share one reviewable editing contract.
- Principle 6: Capability honesty. Runnable, blocked, preview, and design states must never look interchangeable.
- Tradeoffs:
  - Automatic insertion is preferred for speed; expert drag-to-connect remains available.
  - Dense operational evidence is acceptable after a run, but construction stays progressively disclosed.
  - Packaged nodes keep the parent graph readable; experts can explicitly enter a breadcrumbed internal scope.

## Visual language
- Color:
  - Use semantic foreground/background/border tokens from the shipped theme.
  - Reserve orange for focused Workflow actions and selection, not for every technical label.
  - Use success, warning, danger, and info tokens consistently and never as the only status signal.
  - Dark mode is the primary operational presentation; light mode must remain functionally complete.
- Typography:
  - UI text uses the product sans stack; ids, counts, timestamps, and code use the mono stack.
  - Business titles use normal sentence case.
  - Uppercase telemetry labels are limited to advanced or run-inspection surfaces.
- Spacing/layout rhythm:
  - Follow a 4px grid.
  - Keep the Canvas spacious enough to scan; keep panels compact and grouped by user task.
- Shape/radius/elevation:
  - Use existing semantic component tokens and shared primitives.
  - Prefer surface contrast and hairline borders; avoid ornamental shadows.
- Motion:
  - 150–250ms for panel, picker, and insertion transitions.
  - Animate graph insertion and connection once to explain the change.
  - Do not animate streaming updates in ways that move the Canvas.
- Imagery/iconography:
  - Use Lucide icons and recognizable site icons where available.
  - Do not use decorative illustrations inside operational Workflow screens.

## Components
- Existing components to reuse:
  - `WorkflowEditorSession`
  - `WorkflowCanvasSurface`
  - `CommandPalette`
  - `Inspector`
  - `WorkflowNode`
  - shared `Button`, `Input`, `Select`, `Tabs`, `Dialog`, `Tooltip`, `Badge`, and `Sheet`
- New/changed components:
  - `WorkflowIntentStart`: Agent/template/blank entry on empty drafts.
  - `AddStepPopover`: four-stage picker anchored to an edge or terminal.
  - `BusinessNodeCard`: progressive node presentation with required-action and run-summary states.
  - `NodeSetupPanel`: business-first setup with conditional Prompt and Advanced sections.
  - `ConnectedSourcePicker`: source health, freshness, permission, and selection.
  - `WorkflowReadiness`: compact validation and missing-resource summary.
  - `WorkflowProposalReview`: human-readable Agent graph diff.
- Variants and states:
  - Node: idle, needs-setup, ready, queued, running, partial, completed, failed, blocked.
  - Source: connected, stale, degraded, unavailable, permission-required.
  - Proposal: draft, validating, applicable, conflicted, applied, rejected.
- Token/component ownership:
  - Product and interaction decisions live in this file.
  - Global semantic tokens and motion live in `frontend/app/globals.css`.
  - Reusable visual primitives live in `frontend/components/ui/`.
  - Workflow-specific components live in `frontend/components/flow/`.
  - `docs/DESIGN_SYSTEM.md` remains visual-token reference; where it conflicts with shipped Next.js tokens, shipped semantic tokens take precedence until the design-system document is refreshed.

## Accessibility
- Target standard: WCAG 2.2 AA.
- Keyboard/focus behavior:
  - Add-step, node selection, configuration, run, validation, and proposal review are keyboard reachable.
  - Insertion focus moves to the first required field.
  - Escape closes the current transient surface without losing draft changes.
  - Visible focus remains on all controls and graph actions.
- Contrast/readability:
  - Essential text at 10–11px must meet AA; low-contrast telemetry text is not allowed for required actions.
  - Status always includes text or an icon with an accessible name.
- Screen-reader semantics:
  - Nodes expose business name, configuration state, run state, and connection count.
  - Ports expose source/target and data meaning.
  - Live run updates use bounded polite announcements, not one announcement per record.
- Reduced motion and sensory considerations:
  - Honor `prefers-reduced-motion`.
  - Do not rely on animation, color, or spatial position alone to explain graph changes.

## Responsive behavior
- Supported breakpoints/devices:
  - Desktop is primary.
  - Tablet supports review, configuration, and run inspection.
  - Mobile supports status/review and simple parameter edits; complex graph editing is not a primary mobile job.
- Layout adaptations:
  - Desktop: Canvas plus right setup/results panel.
  - Tablet: panel becomes an overlay sheet; Canvas remains visible behind it.
  - Mobile: stage list replaces freeform Canvas as the default view, with an optional graph preview.
- Touch/hover differences:
  - Essential actions are persistent or available through an explicit menu.
  - Hover may reveal port detail but cannot be the only way to add or connect a step.

## Interaction states
- Loading:
  - Keep project header and Canvas frame stable.
  - Restore the last durable draft before enabling mutations.
- Empty:
  - Ask for the desired outcome and show Agent/template/blank creation choices.
- Error:
  - Name the affected node/resource, preserve the draft, and provide one recovery action.
- Success:
  - Show what completed and where the result is available.
  - Keep success confirmation close to the run action and affected nodes.
- Disabled:
  - Explain why and what unlocks the action.
- Offline/slow network:
  - Keep the last durable draft visible and clearly mark unsynced edits.
  - Preserve previously loaded source and run summaries.
- Conflict:
  - Show revision conflict as a reviewable comparison; never silently overwrite human or Agent edits.

## Content voice
- Tone: Clear, concise, task-oriented, calm.
- Terminology:
  - Use: 工作区, 项目, 工作流, 节点, 数据源, 运行, 结果, 记录, Agent.
  - Use business verbs: 采集, 清洗, 核验, 分析, 审批, 更新, 通知.
  - Reserve for Advanced: capability, binding, adapter, runtime, contract, primitive, HDA, package, internal network.
- Microcopy rules:
  - Prefer `添加数据源` over `创建 source slot`.
  - Prefer `还需要选择数据来源` over `missing required param sources`.
  - Prefer `本次采集获得 483 条，准入 412 条` over a raw event count.
  - Buttons use verb + object where space permits.
  - Do not explain internal architecture in ordinary node descriptions.

## Implementation constraints
- Framework/styling system:
  - Next.js App Router, React, TypeScript, Tailwind CSS v4, shadcn/Radix-style primitives, XYFlow, and Zustand.
- Design-token constraints:
  - Extend existing semantic tokens and shared components; do not introduce a parallel token system.
  - No new dependency is required for this UX direction.
- Data/model constraints:
  - `WorkflowProject` remains the single authoring model.
  - Node external ports and compiler contracts remain stable.
  - Connected sources, providers, credentials, execution resources, Runs, and Records remain referenced domain objects.
  - Locked definitions require explicit project-owned derivation for structural customization.
- Performance constraints:
  - Source search, node picker, and graph updates remain responsive with large capability catalogs.
  - Streaming run state patches existing nodes without remounting the Canvas.
- Compatibility constraints:
  - Existing saved Workflows and legacy catalog ids continue to load.
  - UX labels may change without changing runtime identity.
  - Expert drag-connect, internal-scope navigation, and raw trace inspection remain available.
- Test/screenshot expectations:
  - Framework-light regression tests cover picker grouping, automatic insertion, conditional tabs, source selection, proposal review, and readiness summaries.
  - TypeScript, ESLint, production build, and existing Workflow regressions pass.
  - Browser smoke covers blank creation, A-share manual creation, Agent proposal acceptance, source recovery, trial run, validation, and revision conflict.

## Delivery sequence
1. Replace the picker taxonomy with `开始 / 采集 / 处理 / 输出`, runnable-first results, and `高级`.
2. Add edge/terminal `+` insertion with automatic compatible wiring.
3. Replace the always-on technical node chrome with business summary and progressive detail.
4. Rebuild the Inspector as `设置 / 测试与结果 / 执行记录`, with conditional Prompt and collapsed Advanced.
5. Upgrade source selection with connected-source health and freshness.
6. Add Agent proposal review against the same durable Workflow revision.
7. Add blank-canvas intent start and end-to-end benchmark instrumentation.

## Open questions
- [ ] Which two or three creation templates should appear beside Agent-guided creation on an empty draft?
- [ ] Should single-node trial runs persist as full Workflow Runs or as child attempts linked to the draft?
- [ ] Which source freshness thresholds are global defaults versus source-specific policy?
- [ ] When a connected source is missing, should `管理数据源` open as a project-returning sheet or a new route with a return token?
- [ ] When should an expert be allowed to promote a project-derived node into a workspace library?
