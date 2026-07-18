# Brief

## Goal

Make the task and notification queue occupy the primary working area and remain efficient when operators have hundreds of projects or signals.

## Audience

Operators who repeatedly scan, triage, and open failures, pending work, notification delivery issues, and control reviews.

## Surface

- `/inbox` desktop workbench
- tablet and mobile fallback
- loading, partial failure, total failure, empty, filtered-empty, and pagination states

## Constraints

- Next.js 16, React 19, Tailwind 4, existing shadcn-style primitives
- preserve existing API contracts and record destinations
- no new dependency
- support keyboard selection and reduced-motion preferences

## Acceptance checks

- At 1440 px wide, the Inbox workbench begins directly below a compact page bar and fills the remaining app viewport.
- The document does not gain a second vertical page scroll on desktop.
- The list and detail pane scroll independently.
- J/K and arrow navigation keep the selected row visible; Enter opens the selected destination.
- Filters and search survive refresh through URL query parameters.
- Additional API pages can be loaded without replacing already visible signals.
- Rows use browser-native rendering containment suitable for lists over 50 items.
