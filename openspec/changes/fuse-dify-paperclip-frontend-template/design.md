# Design Spec

## Design read

Desktop operations product for technical operators and builders, using OpenCLI's existing
dark, high-density, precise console language. The existing Studio owns workspace and project
discovery; Dify contributes the project lifecycle after entry. Linear contributes work-item interaction.
Paperclip contributes attention, run visualization, evidence, and audit cues.

Design dials: variance 5/10, motion 3/10, density 8/10.

The UI/UX design-system search suggested a generic cyberpunk palette and Orbitron. That
recommendation is rejected because it conflicts with the repository's existing xAI-like
black/white tokens, Noto Sans SC, IBM Plex Mono, and operator-first brand constraints.

## Signature

The memorable sequence is **workspace portfolio → node project cockpit**. The workspace page
is a calm project index; after entry, the workflow graph becomes central and the right rail
explains what currently needs human attention. Sibling projects are not permanently repeated
inside the active project editor.

## Layout

- Target canvas: `min-h-dvh`, desktop-first.
- Workspace desktop: 196-220px global navigation plus a responsive project-card index.
- Project desktop: 196-220px global navigation, flexible node surface, and an optional
  288-320px live rail.
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
- Existing Studio workspace index with project cards, type filters, templates, and DSL import.
- Workspace project cards for workflow, acquisition, cleaning, knowledge, and delivery projects.
- Explicit workspace-index to project-editor transition and return action.
- Project lifecycle header: Overview, Orchestrate, Debug, Publish, Monitor.
- Work-item summary and state control.
- Workflow graph with sources, transforms, agents, review, and delivery nodes.
- Run timeline and environment indicator.
- Paperclip-inspired operational visualization, evidence, approval, and activity rail.
- Linear-style project work-item list and global Inbox deep links.

## States

- Static template badge is always visible.
- Work state and run state must be shown separately.
- Draft, validated, published, and production states must not collapse into “saved”.
- Plugins are shared capabilities consumed by project nodes, not a replacement project hierarchy.
- Inbox items deep-link to a project object; they do not become an alternative hierarchy.
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
- Production work must reuse the existing `/studio` workspace/project index and
  `/studio/workflow?workspace=&project=&workflow=` session rather than promoting or rewriting
  prototype code as a second implementation.
