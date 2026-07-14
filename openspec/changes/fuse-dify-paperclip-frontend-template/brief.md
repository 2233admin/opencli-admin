# Brief

## Goal

Create a static, clickable product template for an OpenCLI **data-pipeline IDE** with a
clear `Workspace → Project → Workflow → Node` hierarchy. Dify contributes the familiar
project/workflow entry and editor lifecycle, OpenCLI keeps its data-contract-driven node
foundation, Linear contributes work-item interaction, and Paperclip contributes the
Agent-team control-plane pattern.

## Audience

- Data builders composing acquisition, cleaning, enrichment, Agent, storage, and delivery pipelines.
- Operators publishing nodes to local, LAN, device, compute-pool, or remote Agent runtimes.
- Team leads reviewing projects, ownership, runs, data assets, Agent teams, and execution resources.

## Surface

- One isolated development-only route: `/prototype/product-shell`.
- Three structurally different variants selected by `?variant=A|B|C`.
- Direction C is the selected synthesis: a light project browser followed by a workflow IDE.
- Static representative data only; no API reads or mutations.

## Constraints

- Keep the current Next.js, Tailwind v4, shadcn/Base UI, Lucide, and semantic tokens.
- Do not add dependencies or copy source code from Dify or Paperclip.
- Preserve the existing formal Studio, WorkflowEditorSession, node catalog, inspector, and Fleet contracts.
- Clearly label the route as a product template with static data.
- Production builds must not expose the throwaway template.

## Non-goals

- Backend integration or a final executor-binding API contract.
- Replacing the existing React Flow editor or six-node static prototype with production code.
- Final route migration, permissions, billing, or Agent-organization persistence.

## Acceptance checks

- The three variants disagree about product structure, not only color.
- Direction C defaults to a quiet workspace project browser with search, filters, favorites,
  ownership, create/import, and project-level aggregate metadata.
- Opening a project makes the current workflow explicit and provides a workflow/sub-pipeline switcher.
- The IDE keeps the graph central; the right side is the selected node inspector and the bottom
  is data preview/log/Schema. Project analytics, work items, Inbox, runs, schedules, versions,
  and settings are separate tabs or global surfaces rather than permanent IDE panels.
- A node separately exposes: business meaning, encapsulation layer, data input/output contract,
  and execution binding. These dimensions must not be collapsed.
- A video collection node can target the local camera, a LAN device, a camera-capable device
  pool, or a remote collection Agent without changing the node's business definition.
- A compute-heavy node can target local CPU/GPU, a LAN compute server, or a remote Agent team.
- Agent teams and devices/compute are platform control planes. The IDE references/binds them;
  it does not embed their full management consoles.
- Workspace, Project, Workflow, workflow Node, executor/device, AI processor, Agent team, Run,
  and Data Asset are named as different objects.
- The existing Studio remains the production workspace/project index and the existing
  WorkflowEditorSession remains the production editor/session foundation.
- Variant selection is URL-stable and keyboard accessible.
- Typecheck and production build pass; the prototype is visually checked at desktop and mobile widths.
