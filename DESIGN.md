# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-22
- Primary product surfaces: Dashboard, Topology Workbench, Sources Workflow, Tasks, Records, Settings
- Evidence reviewed:
  - `https://vercel.com/design.md` and `https://vercel.com/design.dark.md`
  - `frontend/src/index.css`
  - `frontend/src/components/Card.tsx`
  - `frontend/src/components/PageHeader.tsx`
  - `frontend/src/pages/TopologyPage.tsx`
  - `frontend/src/pages/SettingsPage.tsx`
  - `docs/dashboard.png`

## Brand
- Personality: Calm, precise, technical, operator-focused, and trustworthy.
- Trust signals: Clear status language, visible execution state, stable density, readable IDs, and predictable controls.
- Avoid: Decorative gradients, busy dashboard ornament, oversized marketing composition, unclear action labels, and color-only state.

## Product goals
- Goals:
  - Make data collection operations understandable to humans and callable by AI.
  - Treat sources, tasks, schedules, agents, records, and notifications as inspectable nodes.
  - Keep preferences and language controls centralized in Settings.
- Non-goals:
  - Do not turn the app into a marketing page.
  - Do not hide critical operational state behind decoration.
  - Do not introduce a separate design-system package until repeated local patterns justify it.
- Success signals:
  - Users can identify unhealthy nodes quickly.
  - Users can run node actions from the same registry used by AI-facing flows.
  - Key routes remain usable in zh/en without missing text.

## Personas and jobs
- Primary personas:
  - Operator: monitors runs, failures, and source health.
  - Builder: configures sources, schedules, and agent workflows.
  - AI operator: invokes node actions through structured or conversational payloads.
- User jobs:
  - Understand what is running, blocked, missing, or ready.
  - Trigger or retry collection safely.
  - Jump from graph context to concrete configuration screens.
- Key contexts of use:
  - Desktop-first operations console.
  - Long-running monitoring sessions.
  - Mixed human/AI control loops.

## Information architecture
- Primary navigation: Dashboard, Topology, Sources, Tasks, Records, Schedules, Agents, Providers, Nodes, Notifications, Workers, Settings.
- Core routes/screens:
  - `/topology`: global runtime graph and node capability matrix.
  - `/sources`: source workflow canvas and source inspector.
  - `/settings`: language, theme, density, and conversational execution.
- Content hierarchy:
  - Page title and intent.
  - Global metrics or filters.
  - Primary work surface.
  - Contextual inspector or action rail.

## Design principles
- Principle 1: Make state legible before making it expressive.
- Principle 2: Make every tool action available as a node action, then expose it through UI and AI paths.
- Principle 3: Prefer neutral surfaces, sparse accent color, and exact labels.
- Tradeoffs:
  - Dense operational screens are preferred over hero-style visual drama.
  - A restrained Vercel/Geist base should still allow Houdini-like graph thinking through nodes, ports, capability chips, and execution actions.

## Visual language
- Color:
  - Base on Geist dark tokens: near-black surfaces, `#ededed` primary text, `#a0a0a0` secondary text, translucent white borders.
  - Use blue for focus/link/primary action, red for errors, amber for warnings, green for healthy/success, and gray for disabled/unknown.
  - Do not use color alone; pair status with labels or icons.
- Typography:
  - Use the existing UI font stack with Geist-compatible sizing.
  - Use 12-14px labels for dense metadata, 14px body text, and 20-24px page headings.
  - Keep letter spacing at 0 except small telemetry labels already used for compact table-like metadata.
- Spacing/layout rhythm:
  - Follow a 4px scale.
  - Use 8px inside tight groups, 16px between groups, 24-32px between major panels.
- Shape/radius/elevation:
  - Use 6px as the default radius for controls and cards.
  - Use 12px only for dialogs/menus if needed.
  - Use borders and surface tone before shadows.
- Motion:
  - Keep transitions short and functional.
  - Honor reduced motion.
- Imagery/iconography:
  - Use lucide icons only when they clarify action or state.
  - No decorative abstract imagery in operational screens.

## Components
- Existing components to reuse:
  - `Card`, `PageHeader`, `CommandPalette`, `MetricTile`, `PanelHeader`, `Button`, `Input`, `StatusBadge`, `EmptyState`.
- New/changed components:
  - Topology node cards should act as compact node capsules with title, kind, state, badges, and capability chips.
  - Inspectors should group status, capability matrix, node actions, and raw detail in a predictable order.
- Variants and states:
  - Primary action: solid blue/neutral high contrast.
  - Secondary action: neutral surface with translucent border.
  - Disabled: low-contrast gray text plus disabled cursor.
  - Loading: spinner plus present-participle label where space allows.
- Token/component ownership:
  - Global color, font, radius, focus ring, and panel defaults live in `frontend/src/index.css`.
  - Route-specific layout and graph details stay in page files until patterns repeat.

## Accessibility
- Target standard: WCAG AA for body text and controls.
- Keyboard/focus behavior:
  - All interactive controls need visible `:focus-visible` treatment.
  - Command Palette remains accessible by `Ctrl/Cmd+K`.
- Contrast/readability:
  - Avoid low-contrast text below `text-zinc-500` for important labels.
  - Use icons or text with color-coded state.
- Screen-reader semantics:
  - Buttons must use action-specific labels.
  - Status-only dots need title/label context.
- Reduced motion and sensory considerations:
  - Existing `prefers-reduced-motion` rule is required.

## Responsive behavior
- Supported breakpoints/devices:
  - Desktop is primary; tablet and mobile should remain readable.
- Layout adaptations:
  - Work surfaces may stack on smaller viewports.
  - Fixed graph/tool panels need minimum heights and overflow behavior.
- Touch/hover differences:
  - Hover should enhance, not reveal essential actions.

## Interaction states
- Loading: Show spinner and keep the surrounding layout stable.
- Empty: Explain the first useful action, not the feature.
- Error: Say what happened and where the user can recover.
- Success: Toasts name what changed without filler.
- Disabled: Explain through state labels or disabled control context.
- Offline/slow network: Keep cached/previous state visible when possible.

## Content voice
- Tone: Precise, calm, direct.
- Terminology:
  - Use "Node", "Action", "Capability", "Run", "Source", "Task", and "Agent" consistently.
  - In Chinese UI, prefer "节点", "动作", "能力", "运行", "数据源", "任务", "智能体".
- Microcopy rules:
  - Action labels should include a verb and object when space allows.
  - Toasts should be short and specific.
  - In-progress labels should use an ellipsis.

## Implementation constraints
- Framework/styling system: React, Vite, Tailwind, shadcn-style primitives where already present.
- Design-token constraints:
  - Keep tokens CSS-first in `frontend/src/index.css`.
  - Do not add a new theme dependency for this pass.
- Performance constraints:
  - Graph rendering must avoid unnecessary layout shifts and large animations.
- Compatibility constraints:
  - Keep zh/en working and preserve current localStorage keys.
- Test/screenshot expectations:
  - Run `npm run -C frontend test`.
  - Run `npm run -C frontend build`.
  - Use browser smoke checks when the dev server is available.

## Open questions
- [ ] Should the product brand stay close to "OpenCLI" or become a more independent console identity?
- [ ] How far should the Topology Workbench move toward Houdini-style node editing versus observability-first graph inspection?
- [ ] Which node actions should become backend-backed first after the frontend registry proves the model?
