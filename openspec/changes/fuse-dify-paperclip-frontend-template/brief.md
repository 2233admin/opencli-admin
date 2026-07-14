# Brief

## Goal

Create a development-only product template for an OpenCLI data-pipeline IDE with a clear
`Workspace → Project → Workflow → Node` hierarchy. Dify contributes the familiar project entry
and workflow-editor lifecycle; OpenCLI keeps the node system that is already implemented; Linear
contributes work-item interaction; Paperclip contributes the Agent-team control-plane pattern.

## Audience

- Data builders composing acquisition, cleaning, enrichment, Agent, storage, and delivery pipelines.
- Operators connecting those pipelines to local, LAN, device, Worker, compute, or remote Agent resources.
- Team leads reviewing projects, ownership, runs, data assets, Agent teams, and resource health.

## Surface

- One isolated development-only route: `/prototype/product-shell`.
- Three structurally different variants selected by `?variant=A|B|C`.
- Direction C is selected: a light project browser followed by the existing formal workflow editor.
- The project browser remains representative prototype data. The embedded editor runs in standalone
  session mode and does not write or publish a workspace/project draft.

## Constraints

- Keep the current Next.js, Tailwind v4, shadcn/Base UI, Lucide, and semantic tokens.
- Do not add dependencies or copy source code from Dify or Paperclip.
- Preserve and reuse the existing `WorkflowEditorSession`, React Flow canvas, node catalog,
  canonical Schema, Inspector, internal Network behavior, Run Trace, and Fleet contracts.
- Direction C must not maintain a second node/edge/inspector/binding source of truth.
- Production builds must not expose the development-only template.

## Non-goals

- Final backend persistence for resource-node projections.
- Replacing the existing formal editor or redesigning its canonical node/edge contracts.
- Final route migration, permissions, billing, or Agent-organization persistence.
- Treating every project object or control-plane record as a graph node.

## Acceptance checks

- The three variants disagree about product structure, not only color.
- Direction C defaults to a quiet workspace project browser with search, filters, favorites,
  ownership, create/import, and project-level aggregate metadata.
- Opening a project embeds the formal editor instead of the former six-node static editor.
- The formal editor supplies Catalog nodes, typed ports, canonical edges, internal Networks,
  Inspector, node management, Run Trace, and editor interaction.
- No `bindingOptions`, local execution-binding state, fake node-capability list, or duplicate data
  debug dock remains in Direction C.
- Workspace, Project, Workflow, Run, Version, Work item, Inbox item, Data asset, plugin definition,
  and catalog definition remain outside the workflow graph.
- Business, composite, atomic, trigger, Agent, source/sink, and resource projections may be nodes
  when instantiated in the workflow graph.
- Device/Worker/Fleet inventory remains the control-plane source of truth; a future thin canonical
  resource-node projection may reference it through normal ports/edges.
- Variant selection is URL-stable and keyboard accessible.
- Targeted lint, TypeScript, production build, production isolation, and development-route checks pass.
