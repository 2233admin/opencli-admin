# Brief

## Goal

Create a static, clickable frontend template for a **workspace → project → node workflow**
OpenCLI product. Dify contributes the workspace/project entry and project lifecycle, Linear
contributes the work-item interaction pattern, and Paperclip contributes operational
visualization, evidence, and attention signals.

## Audience

- Operators handling failures, approvals, evidence, and production runs under pressure.
- Builders composing sources, transforms, agents, schedules, and delivery nodes.
- Team leads reviewing ownership, versions, budgets, and audit history.

## Surface

- One isolated development-only route: `/prototype/product-shell`.
- Three structurally different variants selected by `?variant=A|B|C`.
- Desktop-first product shell with explicit small-screen collapse.
- Static representative data only; no API reads or mutations.

## Constraints

- Keep the current Next.js, Tailwind v4, shadcn/Base UI, Lucide, and semantic tokens.
- Do not add dependencies or copy source code from Dify or Paperclip.
- Preserve the current dark operational-console character.
- Clearly label the route as a product template with static data.
- Production builds must not expose the throwaway template.

## Non-goals

- Backend integration or API contract changes.
- Final route migration or production navigation changes.
- Full workflow-canvas fidelity.
- Choosing the final copy, permissions model, or billing system.

## Acceptance checks

- The three variants disagree about product structure, not just color.
- Each variant visibly contains: workspace, project, workflow, nodes, work item, run, evidence,
  approval, and activity.
- The existing Studio remains the workspace project index; opening a project leads to its
  node editor and orchestrate/debug/publish/monitor lifecycle.
- A workspace is a project and shared-resource boundary, not one giant navigation tree.
- Independent acquisition, knowledge, cleaning, workflow, and delivery concerns can be
  separate projects inside the workspace.
- Linear-style work items are a supporting operating surface, not the product root.
- Paperclip-style attention, run, evidence, and visualization patterns enrich the workspace
  without importing its company/agent hierarchy.
- Project-local triggers, runs, versions, and node capabilities stay in the active project;
  data sources, knowledge, and cleaning become separate projects when they have independent
  ownership or lifecycle.
- Variant selection is URL-stable and keyboard accessible.
- Typecheck and production build pass; the prototype is visually checked at desktop and
  mobile widths.
