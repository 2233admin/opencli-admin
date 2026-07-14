# Handoff

## Current State

- Change id: `fuse-dify-paperclip-frontend-template`
- Status: implementation complete; browser-control automation gap recorded
- Phase: product-granularity correction verified
- Last updated: 2026-07-14 +08:00

## Goal

Produce a development-only static template for an OpenCLI data-pipeline IDE with the locked
`Workspace → Project → Workflow → Node` hierarchy, data-contract-driven nodes, and execution
bindings to devices, compute pools, or Agent teams.

## Artifacts

- Inventory: `inventory.md`
- Brief: `brief.md`
- Directions: `directions.md`
- Design: `design.md`
- Locked object model: `object-model.md`
- Motion: `motion.md`
- Tasks: `tasks.md`
- QA: `qa.md`
- State: `state.json`
- Events: `events.jsonl`

## Locked decisions

- Workspace is the tenant/team/shared-resource boundary and defaults to a light project browser.
- Project owns business outcome, permissions, data lifecycle, workflows, runs, schedules, versions,
  data assets, and work items.
- Workflow/Pipeline is independently editable and publishable; Project is not its first Workflow.
- Workflow Node declares processing and data input/output. Executor/device declares where it runs.
- Business semantics, encapsulation layer, and execution binding are independent node dimensions.
- Agent Team is a Paperclip-inspired platform control-plane object, not a synonym for an AI
  processor, workflow node, or device.
- Devices and compute pools form a separate control plane. The IDE references both control planes
  through node binding; it does not embed their management UI.
- Linear supplies work-item behavior and global “待我处理” remains Inbox.
- Paperclip supplies the Agent-team/cluster operating model plus relevant attention and evidence
  patterns; the earlier decision to limit it to visualization is superseded.
- Production integration must preserve the existing Studio, WorkflowEditorSession, React Flow
  editor, node catalog, inspector, and Fleet inventory.

## Current prototype behavior

- Direction C defaults to a searchable/filterable workspace project browser with project-level
  aggregate metadata, favorites, ownership, create/import, and no permanent template gallery.
- Opening a project enters its data-pipeline IDE with tabs for 编排、数据、运行、调度、版本、设置.
- The main workflow and offline backfill sub-pipeline are separately selectable and render different
  node graphs, proving the Project → Workflow boundary in the clickable prototype.
- The selected node panel exposes layer, data contract, capabilities, and stateful execution binding.
- Video collection can bind to a LAN device pool, local camera, LAN device, or remote collection Agent.
- Visual detection can bind to a visual Agent cluster, local GPU compute, or remote visual Agent.
- The bottom data dock shows sample, log, and Schema entry points.
- Dashboard metrics, Inbox, work items, runtime charts, and evidence no longer permanently compete
  with the graph inside the IDE.

## Verification evidence

- Targeted ESLint passed.
- TypeScript passed.
- Complete Next.js 16.2.6 production build passed.
- Production server returned 404 for the prototype, omitted its marker, and returned 200 for dashboard.
- Development server returned 200 for Direction C and includes the revised workspace project content.
- `git diff --check` passed.
- Independent audit identified the formal Workspace/Project/Workflow boundary and four Agent meanings.
- Independent revision review findings about binding state, Workflow switching, and stale OpenSpec
  decisions were remediated before completion.
- Formal Studio and WorkflowEditorSession have no changes in this revision.

## Known gap

- Fresh visual/browser interaction automation could not run because the installed browser-control
  runtime failed during initialization (`Cannot redefine property: process`). This is a tooling error,
  not a page runtime/build error. The dev server remains available for manual product review.

## Next production steps

1. Add an explicit Workflow list/switcher to the existing Studio/WorkflowEditorSession route contract.
2. Introduce stable `executionRequirement` and `bindingRef` fields aligned with existing Fleet tags.
3. Build separate Agent Team and Device/Compute control-plane pages from current backend capabilities.
4. Reuse the existing inspector and canvas for data-contract and runtime-binding UI.
5. Re-run desktop/mobile visual automation when the browser-control runtime is repaired.
