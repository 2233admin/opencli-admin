# Handoff

## Current State

- Change id: `fuse-dify-paperclip-frontend-template`
- Status: complete with one mobile automation gap
- Phase: stage 7 complete
- Last updated: 2026-07-14 02:25 +08:00

## Goal

Produce a development-only static template that preserves the existing workspace → project →
node workflow, uses Dify's lifecycle inside an opened project, adds Linear-style work items,
and limits Paperclip influence to attention, evidence, approval, activity, and run visualization.

## Artifacts

- Inventory: `inventory.md`
- Brief: `brief.md`
- Directions: `directions.md`
- Design: `design.md`
- Motion: `motion.md`
- Tasks: `tasks.md`
- QA: `qa.md`
- State: `state.json`
- Events: `events.jsonl`

## Decisions

- No backend or API integration in this change.
- The prototype is a separate development-only route.
- Three structural variants remain available; Direction C is the selected product synthesis.
- Existing tokens, fonts, components, and Lucide icons are reused.
- Nodes and workflows remain the product foundation.
- The existing Studio remains the workspace and project index; it must not be rewritten.
- Dify's orchestrate/debug/publish/monitor lifecycle begins after a project is opened.
- Acquisition, cleaning, knowledge, workflow, and delivery can be separate sibling projects.
- Linear supplies work-item behavior; global “待我处理” is Inbox.
- Paperclip is limited to attention, run visualization, evidence, approval, and activity patterns.
- Project-local triggers, runs, versions, and node capabilities remain scoped to the active project.

## Missing capabilities / fallbacks

- GBrain is not enabled; durable decisions stay in this OpenSpec folder.

## Evidence

- Local route/component inventory completed.
- Dify and Paperclip official-source product inventories completed.
- Design pipeline dependency check returned OK.
- Development-only route implemented at `/prototype/product-shell?variant=A|B|C`.
- Existing `/studio` already supplies workspace selection, project cards, templates, and DSL import.
- Existing `WorkflowEditorSession` already loads, saves, validates, and publishes by workspace,
  project, and workflow identifiers.
- Direction C now defaults to a dedicated workspace project index with project cards, filters,
  create/import actions, and templates.
- Opening a project transitions to a separate node editor with an explicit return action; the
  editor no longer repeats sibling projects as a permanent sidebar.
- Every project card now supplies its own representative nodes, metrics, versions, work items,
  Inbox alert, related runs, evidence, owner, and approval context; switching projects does not
  retain data from the previous project.
- The node canvas remains central; Linear-style work items and Paperclip-style runtime/attention
  surfaces are subordinate to it.
- Targeted ESLint and TypeScript checks passed after the revision.
- Revised C was inspected in the in-app browser at 1280x720; document scroll width stayed below
  viewport width and the browser console contained no runtime errors.
- A/B/C switcher interaction updated the URL correctly and returned to selected C.
- The runtime visualization was visually rechecked after fixing a zero-height chart container.
- Independent review passed after separating the global Inbox surface from the Linear work-item card.
- Independent hierarchy review passed with no P0/P1/P2 findings.
- The screen-boundary-corrected C direction passed targeted ESLint, TypeScript, a complete
  Next.js production build, and 1280px in-app browser inspection without horizontal overflow
  or runtime errors.
- Browser interaction confirmed workspace index → project editor → workspace index, with the
  page reset to the top during both transitions.
- Browser interaction also confirmed cleaning at `v9 / RUN-3147` and notification at
  `v7 / RUN-6231`, with no stale project node or run identifiers after switching.
- A fresh production server returned 404 for the prototype, omitted its marker, and returned
  200 for `/dashboard`.
- Independent screen-boundary review initially found shared sentiment data and then hard-coded
  AttentionRail data; both findings were remediated, and the final re-review reported no
  P0/P1/P2 findings and recommended submission.
- The earlier C structure passed at 390x812. Fresh viewport emulation for the revised C could not
  run because the selected browser does not expose resizing and rejected the isolated harness.

## Blockers

- Fresh 390 px metrics: browser viewport emulation unavailable under the selected security policy.

## Next actions

1. Review the corrected workspace-index → project-editor direction.
2. Map approved additions onto the existing Studio and WorkflowEditorSession only.
3. Re-run 390 px metrics when the environment supports that check.
