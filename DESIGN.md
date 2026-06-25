# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-25
- Primary product surfaces: Dashboard, Source Configuration, Run Inbox, Live Collection View, Tasks, Records, Settings.
- Labs surfaces: Topology Workbench is available only behind `VITE_ENABLE_TOPOLOGY_LAB=true`.
- Evidence reviewed:
  - `frontend/src/index.css`
  - `frontend/tailwind.config.js`
  - `frontend/src/components/opencli/OperatorCard.tsx`
  - `frontend/src/components/opencli/WorkbenchPanel.tsx`
  - `frontend/src/components/opencli/MetricTile.tsx`
  - `frontend/src/labs/topology/TopologyPage.tsx`
  - `frontend/src/pages/SourcesPage.tsx`

## Brand
- Personality: Calm, precise, technical, operator-focused, trustworthy.
- Trust signals: Clear status language, visible execution state, stable density, readable IDs, predictable controls.
- Avoid: Decorative gradients, busy dashboard ornament, oversized marketing composition, unclear action labels, color-only state, visual novelty for its own sake.

## Product goals
- Goals:
  - Keep Topology Workbench as an experimental read-only/lab surface until the core collection loop is stable.
  - Keep Source Configuration focused on source identity, parameters, schedules, and health.
  - Show live collection telemetry only when a run or pipeline needs it.
  - Reuse existing local components and proven libraries instead of creating a separate component library.
- Non-goals:
  - Do not make the data-source page the primary graph/node workspace.
  - Do not copy OpenBB design-system source code; treat it as product reference only.
  - Do not replace the existing yUI/dark console base with a new visual theme.
- Success signals:
  - Operators can find unhealthy nodes quickly.
  - Source setup remains calmer than the topology workspace.
  - Primary, danger, warning, success, and informational states are consistent.

## Personas jobs
- Primary personas:
  - Operator: monitors runs, failures, source health.
  - Builder: configures sources, schedules, and agent workflows.
  - AI operator: invokes node actions through structured conversational payloads.
- User jobs:
  - Understand what is running, blocked, missing, ready, or stale.
  - Trigger or retry collection safely.
  - Watch live collected information without keeping every telemetry pane permanently open.
- Key contexts of use: desktop-first operations console, long-running collection sessions, mixed human/AI control loops.

## Information architecture
- Primary navigation: Dashboard, Topology Workbench, Data Sources, Tasks, Records, Settings.
- Core routes/screens:
  - Topology Workbench: core graph, next nodes, selected details, node actions.
  - Source Configuration: source catalog, channel metadata, schedules, and optional diagnostics canvas.
  - Run Inbox: recent work, failed work, running work, review queue.
  - Live Collection View: streaming run data, logs, records, tokens, and costs.
- Content hierarchy:
  - Topology: operational state first, selected node detail second, actions third.
  - Sources: configuration first, workflow/diagnostics second.

## Design principles
- Principle 1: State legibility before visual expression.
- Principle 2: Work should feel direct and low-friction; follow Linear's product discipline more than its surface styling.
- Principle 3: Topology owns node thinking; Sources owns configuration.
- Tradeoffs:
  - Dense operational screens are acceptable when they reduce clicks.
  - Popovers, drawers, and panes should appear when useful rather than living on screen all the time.

## Visual language
- Color:
  - Keep the existing near-black console base and translucent borders.
  - Use blue for focus/link/primary action.
  - Use red for danger/error, amber for warning/pending, green for success/healthy, cyan/gold/violet as secondary signals only.
  - Do not let the signal palette become a loud theme.
- Typography:
  - Use existing UI, code, and telemetry font variables.
  - Keep letter spacing 0 except compact telemetry labels already used in the app.
- Spacing/layout rhythm:
  - Follow a 4px scale.
  - Prefer stable panel dimensions and compact grouping over decorative spacing.
- Shape/radius/elevation:
  - Use 6px radius for panels, cards, buttons, and inputs.
  - Use borders and subtle surface contrast before shadows.
- Motion:
  - Keep transitions short and functional.
  - Honor reduced motion.
- Imagery/iconography:
  - Use lucide icons when they clarify action or state.
  - Do not add decorative abstract imagery to operational screens.

## Components
- Existing components to reuse:
  - `Card`, `PageHeader`, `CommandPalette`, `MetricTile`, `PanelHeader`, `OperatorCard`, `WorkbenchPanel`, `Button`, `Input`, `StatusBadge`, `EmptyState`.
- New/changed components:
  - `OperatorCard` should receive semantic tones, not raw color class strings.
  - `MetricTile`, `StatusBadge`, `Button`, and `Badge` should keep danger red separate from primary blue.
  - `WorkbenchPanel` can structure topology/source work areas without becoming a decorative card system.
- Variants and states:
  - Tones: `neutral`, `accent`, `info`, `gold`, `success`, `warning`, `danger`, `violet`.
  - Active/focus remains blue. Error/failure remains red.
- Token/component ownership:
  - Global base styles live in `frontend/src/index.css`.
  - Tailwind color names live in `frontend/tailwind.config.js`.
  - OpenCLI reusable workbench components live in `frontend/src/components/opencli/`.
  - Route-specific layout stays in page files until repetition proves a component is needed.

## Accessibility
- Target standard: WCAG AA for body text and controls.
- Keyboard/focus behavior:
  - All interactive controls need visible `:focus-visible`.
  - Command Palette remains accessible by `Ctrl/Cmd+K`.
- Contrast/readability:
  - Avoid low-contrast text for important labels.
  - Do not use color alone for status.
- Screen-reader semantics:
  - Buttons need action-specific labels.
  - Status-only dots need text context.
- Reduced motion sensory considerations:
  - Keep the existing `prefers-reduced-motion` rule.

## Responsive behavior
- Supported breakpoints/devices: Desktop primary; tablet and mobile should remain readable.
- Layout adaptations:
  - Work surfaces may stack on smaller viewports.
  - Fixed graph/tool panels need minimum heights and overflow behavior.
- Touch/hover differences:
  - Hover should enhance, not reveal essential actions.

## Interaction states
- Loading: Keep surrounding layout stable.
- Empty: Explain the first useful action, not the feature.
- Error: Say what happened and where the user can recover.
- Success: Toasts name the changed object without filler.
- Disabled: Explain through state labels or nearby context.
- Offline/slow network: Keep cached or previous state visible when possible.

## Content voice
- Tone: Precise, calm, direct.
- Terminology:
  - English: Node, Action, Capability, Run, Source, Task, Agent, Pipeline.
  - Chinese: 节点, 动作, 能力, 运行, 数据源, 任务, 智能体, 管线.
- Microcopy rules:
  - Action labels should include verb and object when space allows.
  - Avoid explaining the UI inside the UI.

## Implementation constraints
- Framework/styling system: React, Vite, Tailwind, shadcn/Radix-style primitives already present.
- Design-token constraints:
  - Use signal colors for state semantics, not for broad decoration.
  - Do not pass raw color class strings through reusable component props.
- Performance constraints:
  - Graph and live-run views should avoid unnecessary remounts during streaming updates.
- Compatibility constraints:
  - FlowGram is a reference/bottom-layer direction; keep current topology behavior working while integrating.
  - `react-grid-layout` owns adaptive live-run panes.
- Test/screenshot expectations:
  - Run frontend tests and build after token/component changes.
- Smoke `/sources`, `/tasks`, and `/labs/topology` with `VITE_ENABLE_TOPOLOGY_LAB=true` when a dev server is available.

## Open questions
- [ ] How far should Topology Workbench move toward FlowGram-style editing versus observability-first graph inspection?
- [ ] Which live collection pipelines deserve persistent panes versus temporary popovers/drawers?
- [ ] Should the Source Configuration diagnostics canvas be drawer, modal, or secondary route?
