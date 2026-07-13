# Design Directions

## A. Builder First

Visual thesis: a Dify-like studio owns the screen. The workflow canvas is central, with
project lifecycle tabs across the top and task, approval, and run context in a right rail.

Interaction thesis: builders enter through templates/import, edit the graph, test a node
or the whole workflow, then publish. Governance stays visible but secondary.

Fit: best when workflow authors are the dominant persona.

Risk: repeats the current problem of burying operational work and data-chain surfaces
inside the editor.

## B. Control Plane First

Visual thesis: a Paperclip-like project/task control plane owns the screen. Work items,
assignees, approvals, runs, costs, and activity are primary; workflow design is one tab
inside the current work item.

Interaction thesis: operators start from inbox/project tasks, open a work item, then
inspect or modify its automation only when necessary.

Fit: best for multi-person operations and review-heavy work.

Risk: makes OpenCLI's strongest differentiator, the executable node workflow, feel like
an attachment.

## C. Dify-led Workspace and Node Projects (selected direction)

Visual thesis: preserve OpenCLI's existing Dify-like two-step entry. The workspace is a
portfolio of projects and shared capabilities. Opening one project enters a project-specific
node cockpit with orchestration, debug, publish, and monitor modes. These are two distinct
screens: the workspace index shows project cards, filters, templates, and create/import actions;
the project cockpit shows only the active project's nodes and lifecycle. Linear-style work items
and a Paperclip-style live attention/visualization rail support the active project.

Interaction thesis: users enter `/studio`, select a workspace, create or open a project, then
work with that project's nodes. A source collector, knowledge base, cleaning pipeline, or
delivery workflow can be its own project when it has a separate lifecycle. Inside the active
project, users compose nodes, debug the draft, publish a version, and inspect that project's
runs. Inbox is the global “待我处理” surface and deep-links to the relevant project object.

Fit: matches OpenCLI's node foundation and uses a workflow mental model that Dify and n8n
users already understand, while preserving the team's existing Linear-like operating logic.

Risk: project types can fragment the experience if cross-project dependencies are invisible.
The workspace index must therefore show project type, ownership, and relationships without
turning back into a single overloaded editor.

## Selection rule

C is now the selected synthesis. Keep A and B available as comparison references: A shows
the pure builder extreme; B shows the pure task-control-plane extreme.
