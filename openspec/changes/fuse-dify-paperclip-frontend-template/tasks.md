# Tasks

## Inventory and design

- [x] Inventory current routes, shell, workflow editor, operations types, and tokens.
- [x] Inventory Dify's global/resource and app-lifecycle logic from official sources.
- [x] Inventory Paperclip's task/control-plane logic from the official repository.
- [x] Define unified vocabulary, object hierarchy, and three structural directions.

## Prototype

- [x] Add a development-only `/prototype/product-shell` route.
- [x] Implement three structurally different variants selected by `?variant=`.
- [x] Add a reusable development-only prototype switcher with keyboard controls.
- [x] Use static, clearly labelled representative data and no API hooks.

## QA

- [x] Run targeted lint and TypeScript checks.
- [x] Run a production build and confirm the prototype does not ship as a usable route.
- [x] Inspect A/B/C in the browser at desktop width.
- [x] Inspect the recommended C direction at mobile width.
- [x] Record screenshot observations and the final scorecard in `qa.md`.

## Dify-led revision (superseded)

This historical pass flattened workspace and project responsibilities. The hierarchy
correction below replaces that decision while preserving its useful node, Inbox, Linear,
and Paperclip work.

- [x] Reframe the selected direction around a node-based Dify workspace.
- [x] Implement the initial overloaded workspace panel for review; later rejected and removed.
- [x] Keep global “待我处理” as Inbox and retain Linear-style work-item behavior.
- [x] Record the initial Paperclip-only-as-visualization pass; this historical decision was
  superseded by the later Agent-team control-plane requirement.
- [x] Rework Direction C and update the prototype switcher label.
- [x] Re-run targeted lint and TypeScript checks.
- [x] Re-run desktop browser QA and verify no horizontal overflow or runtime errors.
- [x] Re-run the production build after Google Fonts is reachable; the hierarchy-correction build passed.
- [ ] Re-run automated 390 px metrics when the selected browser exposes viewport emulation; the browser security policy rejected the isolated harness.

## Workspace/project hierarchy correction

- [x] Confirm the existing `/studio` already provides workspace selection, project cards, templates, and DSL import.
- [x] Confirm `WorkflowEditorSession` already loads and persists by workspace, project, and workflow identifiers.
- [x] Remove the overloaded workspace menu from Direction C.
- [x] Represent acquisition, cleaning, knowledge, workflow, and delivery as sibling project types.
- [x] Bind orchestrate, debug, publish, monitor, runs, and versions to the active project.
- [x] Re-run static checks, desktop browser QA, and an independent hierarchy review.

## Workspace/editor screen-boundary correction

- [x] Make Direction C default to a dedicated workspace project index.
- [x] Reuse the existing Studio information structure: project filters, cards, create/import, and templates.
- [x] Open the node editor only after a project-card action.
- [x] Add an explicit return to the workspace index.
- [x] Remove the persistent sibling-project navigator from the project editor.
- [x] Re-run static checks, browser QA, and production isolation.
- [x] Complete an independent screen-boundary and project-context review; remediate the initial
  shared-profile and fixed AttentionRail findings before submission.

## Product granularity and execution-binding correction

- [x] Audit the formal Workspace, Project, WorkflowAsset, WorkflowGraph, node, Fleet, and Agent models.
- [x] Lock Workspace → Project → Workflow → Node and the separate executor/Agent-team objects.
- [x] Reduce Direction C workspace to a searchable, filterable, scalable project browser.
- [x] Replace workflow-internal card metadata with project aggregate metadata.
- [x] Make the current main workflow/sub-pipeline explicit after project entry.
- [x] Remove the permanent project-dashboard metrics, Inbox, work-item, and runtime rails from the IDE.
- [x] Add selected-node data contract, encapsulation layer, capabilities, and execution-binding UI.
- [x] Demonstrate video collection across local camera, LAN device, device pool, and remote Agent.
- [x] Demonstrate compute placement across local CPU/GPU, LAN compute, and remote Agent team.
- [x] Add a bottom sample/log/Schema data-debug dock.
- [x] Re-run production isolation and independent review; final re-review has no P0/P1/P2/P3 findings.
- [ ] Re-run desktop/mobile browser interaction QA after the browser-control runtime is repaired.
