# Tasks

## Contract

- [x] Extend Inbox regression checks for full-height layout, progressive loading, URL state, selection scrolling, and large-list containment.

## Data

- [x] Add paginated notification-log parameters.
- [x] Add infinite-query hooks for tasks, notification logs, and control actions.
- [x] Use pagination metadata to determine whether more signal pages are available.

## Layout and interaction

- [x] Replace the card-in-page layout with a full-height split workbench.
- [x] Move title, tabs, search, and sync into a compact page bar.
- [x] Keep queue and detail scrolling independent.
- [x] Preserve filter/search state in the URL.
- [x] Keep keyboard selection visible while navigating long queues.
- [x] Add progressive loading and offscreen rendering containment.

## States and accessibility

- [x] Preserve loading, partial failure, total failure, and empty states.
- [x] Verify focus treatment, labels, semantic roles, and mobile fallback.

## QA

- [x] Run targeted regression tests.
- [x] Run ESLint and TypeScript checks.
- [x] Inspect 1440×900, 1920×1080, 768×1024, and 375×812 layouts.
- [x] Record final evidence in `qa.md`, `state.json`, `events.jsonl`, and `handoff.md`.
