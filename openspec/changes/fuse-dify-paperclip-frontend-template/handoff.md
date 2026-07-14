# Handoff

## Current state

- Change id: `fuse-dify-paperclip-frontend-template`
- Status: node-system integration correction verified; browser-control automation gap recorded
- Phase: formal-node-system-integration-verified
- Last updated: 2026-07-14 +08:00

## Goal

Produce a development-only OpenCLI data-pipeline product template with the locked
`Workspace → Project → Workflow → Node` hierarchy while reusing the node system that was already
built in this repository.

## Locked decisions

- Workspace is the tenant/team/shared-resource boundary and defaults to a light project browser.
- Project owns business outcome, permissions, data lifecycle, workflows, runs, schedules, versions,
  data assets, and work items.
- Workflow/Pipeline is independently editable and publishable; Project is not its first Workflow.
- Direction C project entry embeds `WorkflowEditorSession`; it does not own a second canvas,
  ProjectNode schema, Inspector, data-debug dock, or binding store.
- Canonical nodes use the existing `kind/capability/adapter/params/internals` contract.
- Canonical edges use the existing `sourcePort/targetPort/semantic/contractId` contract.
- Workspace, Project, Workflow, Run, Version, Work item, Inbox item, Data asset, plugin definition,
  catalog definition, AI processor, and Agent team are not graph nodes.
- Business steps, schedule triggers, Agent steps, compound HDAs, and resource projections are graph
  nodes when instantiated on a workflow.
- EdgeNode/Worker/Fleet inventory remains outside the graph as control-plane source of truth. A
  workflow may reference it through a thin canonical resource-node projection.
- “Where it runs” is a resource-node relationship, not `bindingOptions` on a business node.
- Linear supplies work-item behavior; Paperclip supplies the Agent-team/cluster operating model.

## Current Direction C behavior

- Direction C defaults to a searchable/filterable workspace project browser with project-level
  metadata, favorites, ownership, create/import, and no permanent template gallery.
- Opening a project keeps the project lifecycle header and explicit return path.
- The project body directly renders the formal standalone `WorkflowEditorSession`.
- The former static six-node project canvas, fake selected-node Inspector, local execution-binding
  state, fake capability chips, and fixed sample/log/Schema dock are removed from Direction C.
- A/B remain static comparison directions; they are not production integration sources.

## Verification evidence so far

- Two independent read-only audits confirmed the former Direction C had duplicated node, edge,
  Inspector, and binding semantics.
- Both audits identified `WorkflowEditorSession`, `WorkflowEditor`, canonical Schema, Catalog,
  Inspector, internal Network navigation, Run Trace, and Fleet adapters as the reuse foundation.
- Targeted ESLint passed after the integration correction.
- TypeScript passed after the integration correction.
- Workflow regressions passed 9/9, including an explicit standalone-isolation regression.
- Workflow contract assertions passed.
- A fresh Next.js 16.2.6 production build passed.
- Production isolation passed on port 8040: prototype 404 without marker; dashboard 200.
- Development smoke passed on port 8030: Direction C returned 200 with workspace/project markers.
- Independent remediation re-review reported no P0/P1/P2/P3 findings.

## Known integration risks

- Fleet inventory/match exists, but no formal resource-node Catalog/projection currently consumes it.
- Formal React Flow edge changes must be proven to synchronize into canonical `WorkflowProject`
  before project autosave; the standalone prototype does not activate autosave.
- Browser-control automation previously failed to initialize with `Cannot redefine property: process`.

## Next production steps

1. Add an explicit Workflow list/switcher to the existing Studio/session route contract.
2. Define a thin canonical resource-node Catalog/projection referencing EdgeNode/Worker/Fleet records.
3. Connect resource nodes to processing nodes through existing ports, edges, contracts, and validation.
4. Add regression coverage proving add/remove edge synchronization into canonical autosave payloads.
5. Keep credentials, endpoint health, matching, session locks, and concurrency in the existing backend
   resource layer.
6. Re-run desktop/mobile interaction automation when the browser-control runtime is repaired.
