# Handoff

## Current State

- Change id: `fuse-dify-paperclip-frontend-template`
- Status: complete with explicit QA environment gaps
- Phase: stage 7 complete
- Last updated: 2026-07-14 01:03 +08:00

## Goal

Produce a development-only static template that keeps nodes and workflows as the foundation,
uses Dify as the dominant workspace lifecycle, adds Linear-style work items, and limits
Paperclip influence to attention, evidence, approval, activity, and run visualization.

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
- Dify now owns the selected workspace and governance structure.
- Linear supplies work-item behavior; global “待我处理” is Inbox.
- Paperclip is limited to attention, run visualization, evidence, approval, and activity patterns.
- Data pipelines, triggers/schedules, runtime data, versions, and plugins move inside the active workspace.

## Missing capabilities / fallbacks

- GBrain is not enabled; durable decisions stay in this OpenSpec folder.

## Evidence

- Local route/component inventory completed.
- Dify and Paperclip official-source product inventories completed.
- Design pipeline dependency check returned OK.
- Development-only route implemented at `/prototype/product-shell?variant=A|B|C`.
- The revised C direction contains a Dify-style workspace panel for workflows, data pipelines,
  triggers/schedules, runtime data, versions/publish, monitoring, plugins, and variables.
- The node canvas remains central; Linear-style work items and Paperclip-style runtime/attention
  surfaces are subordinate to it.
- Targeted ESLint and TypeScript checks passed after the revision.
- Revised C was inspected in the in-app browser at 1280x720; document scroll width stayed below
  viewport width and the browser console contained no runtime errors.
- A/B/C switcher interaction updated the URL correctly and returned to selected C.
- The runtime visualization was visually rechecked after fixing a zero-height chart container.
- Independent review passed after separating the global Inbox surface from the Linear work-item card.
- The previously completed baseline build proved production route isolation. Two fresh revised
  builds reached Next.js compilation but failed while downloading IBM Plex Mono and Noto Sans SC.
- The earlier C structure passed at 390x812. Fresh viewport emulation for the revised C could not
  run because the selected browser does not expose resizing and rejected the isolated harness.

## Blockers

- Fresh production build: external Google Fonts download failure.
- Fresh 390 px metrics: browser viewport emulation unavailable under the selected security policy.

## Next actions

1. Review Direction C as the production baseline.
2. Map the workspace panel and lifecycle onto the existing Studio/workflow routes and contracts.
3. Re-run the production build and 390 px metrics when the environment supports those checks.
