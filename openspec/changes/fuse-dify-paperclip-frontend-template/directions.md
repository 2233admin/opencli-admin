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

## C. Dify-led Node Workspace (selected direction)

Visual thesis: a Dify-like workspace panel owns the product. The active workspace contains
workflow orchestration, data pipelines, triggers/schedules, runs/logs, versions/publishing,
monitoring, and plugins. A node canvas remains the central source of truth. Linear-style
work items and a Paperclip-style live attention/visualization rail support that canvas.

Interaction thesis: users enter a workspace, select or create a workflow, compose nodes,
debug the draft, publish a version, and monitor production. Inbox is the global “待我处理”
surface; selecting an item deep-links back into the relevant workspace, workflow, run, node,
evidence batch, or approval.

Fit: matches OpenCLI's node foundation and uses a workflow mental model that Dify and n8n
users already understand, while preserving the team's existing Linear-like operating logic.

Risk: too much workspace navigation can crowd the canvas. Work items and analytics must
remain contextual, collapsible, and secondary to node composition.

## Selection rule

C is now the selected synthesis. Keep A and B available as comparison references: A shows
the pure builder extreme; B shows the pure task-control-plane extreme.
