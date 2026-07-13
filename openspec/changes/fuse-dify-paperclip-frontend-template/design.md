# Design Spec

## Design read

Desktop operations product for technical operators and builders, using OpenCLI's existing
dark, high-density, precise console language. Dify owns the workspace structure and
orchestrate/debug/publish/monitor lifecycle. Linear contributes work-item interaction.
Paperclip contributes attention, run visualization, evidence, and audit cues.

Design dials: variance 5/10, motion 3/10, density 8/10.

The UI/UX design-system search suggested a generic cyberpunk palette and Orbitron. That
recommendation is rejected because it conflicts with the repository's existing xAI-like
black/white tokens, Noto Sans SC, IBM Plex Mono, and operator-first brand constraints.

## Signature

The memorable element is the **node workspace cockpit**: the workflow graph remains central,
while the left workspace panel explains where data, triggers, versions, runs, and plugins
belong and the right rail explains what currently needs human attention.

## Layout

- Target canvas: `min-h-dvh`, desktop-first.
- Desktop: 196-220px global navigation, 220-256px workspace panel, flexible node surface,
  and an optional 288-320px live rail.
- Tablet: collapse one contextual rail into a horizontal strip.
- Mobile: one content column; primary modes become a horizontally scrollable tab row;
  rails become stacked sections.
- Fixed prototype switcher reserves at least 88px bottom padding.

## Visual system

- Reuse `background`, `card`, `muted`, `border`, `foreground`, and semantic state tokens.
- White/black remains the only broad brand contrast.
- Orange is used for pending/review; green for healthy/completed; red for blocked/failed;
  blue/cyan only for informative runtime links.
- Use Noto Sans SC for interface copy and IBM Plex Mono for IDs, timestamps, states, and
  execution telemetry.
- Panels use the existing 8px radius and hairline border. Avoid nested decorative cards.

## Component inventory

- Prototype shell and variant switcher.
- Global shell with Overview, Inbox, Workspaces, platform resources, and settings.
- Dify-like workspace panel with Overview, Workflows, Data Pipelines, Triggers & Schedules,
  Runs & Logs, Versions & Publish, Monitoring, and Plugins.
- Workspace lifecycle header: Orchestrate, Debug, Publish, Monitor.
- Work-item summary and state control.
- Workflow graph with sources, transforms, agents, review, and delivery nodes.
- Run timeline and environment indicator.
- Paperclip-inspired operational visualization, evidence, approval, and activity rail.
- Linear-style Inbox and workspace work-item list.

## States

- Static template badge is always visible.
- Work state and run state must be shown separately.
- Draft, validated, published, and production states must not collapse into “saved”.
- Plugins are workspace node capabilities and integrations, not a separate company model.
- Inbox items deep-link to a workspace object; they do not become an alternative hierarchy.
- Empty/error/loading examples appear as compact structural examples, not fake backend
  behavior.

## Accessibility

- Native buttons and links only for interactive elements.
- Variant switcher supports buttons plus Left/Right keyboard shortcuts.
- Do not intercept arrow keys while an input, textarea, select, or contenteditable is
  focused.
- Focus rings remain visible and status is never color-only.
- Primary targets are at least 40px desktop and 44px on small screens.

## Prototype boundary

- The route is development-only and returns 404 in production.
- The prototype is read-only and contains no API hooks.
- The selected structural decision will be rewritten into production components rather
  than promoting prototype code as-is.
