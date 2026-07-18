# Design

## Design read

Desktop operations Inbox for frequent users, with a restrained Linear-style interaction language and OpenCLI's existing neutral theme.

- Design variance: 4/10
- Motion intensity: 2/10
- Visual density: 9/10

## Layout

Desktop:

```text
┌ compact page bar: title | sibling views | search | sync ┐
├──────────────── queue ───────────────┬──── detail ──────┤
│ filters + loaded/page summary        │ selected status  │
│ sticky section label                 │ context          │
│ dense rows                           │ facts            │
│ independently scrollable             │ next action      │
│ progressive-load footer              │ fixed action bar │
└──────────────────────────────────────┴───────────────────┘
```

- Root height: `calc(100dvh - 3.5rem)` on desktop, matching the 56 px global header.
- Page bar: 56 px, one line at desktop.
- Body: `minmax(21rem, 0.84fr) minmax(0, 1.65fr)`.
- No max-width, outer radius, shadow, or page card.
- Mobile and tablet: natural document flow; queue above detail; no horizontal overflow.

## Tokens and type

- Reuse existing semantic tokens: `background`, `card`, `muted`, `border`, `destructive`, `warning`, `info`, `ring`.
- Use the existing font stack. Headings stay compact at 16 px to 18 px.
- Counts use tabular monospaced figures.
- Status color always includes an icon or text label.

## Components and states

- Page bar: title, live count, route tabs, search, sync.
- Queue toolbar: all, blocked, waiting, review filters.
- Queue row: 64-72 px target height, title, occurrence count, one-line summary, source, time.
- Detail: independent scroll, fixed bottom action bar.
- Pagination: one explicit "load more" control; loaded signals remain visible.
- Complete loading, error, partial failure, empty, and filtered-empty states.

## Interaction

- J/K and ArrowUp/ArrowDown select adjacent rows.
- Keyboard selection uses instant `scrollIntoView({ block: "nearest" })`; no navigation animation.
- Enter opens the selected record.
- Ctrl/Cmd+F focuses queue search; Escape clears it.
- Filter and search values are reflected in `view` and `q` URL parameters.

## Performance

- Fetch API pages in chunks of 100 and append with TanStack Query infinite queries.
- Group repeated signals after pages are flattened.
- Apply `content-visibility: auto` and intrinsic row sizing so offscreen queue rows do not incur full rendering cost.
- No new virtualization dependency for the first hundreds-scale target.

## Accessibility

- Preserve semantic `listbox` and `option` roles.
- Maintain visible `focus-visible` treatment.
- Icon-only actions receive accessible names.
- Mobile controls retain at least 40-44 px hit areas where space permits.
- Color is never the only state indicator.

## Motion

No new non-trivial motion is introduced. Keyboard navigation is instant. Existing theme and route-transition reduced-motion behavior remains authoritative, so `motion.md` is not required.
