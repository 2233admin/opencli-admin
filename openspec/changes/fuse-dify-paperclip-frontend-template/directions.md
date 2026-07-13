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

## C. Unified Loop (recommended baseline)

Visual thesis: a persistent workspace tree on the left, a single object/lifecycle header,
an adaptable central work surface, and a live context rail on the right. The central mode
switches between Overview, Design, Run, Evidence, and Review without losing project or
work-item context.

Interaction thesis: the user always knows the current goal, project, work item, workflow,
release state, and next human action. Build and operate are two modes of the same loop.

Fit: preserves Dify's builder quality while adopting Paperclip's control-plane model.

Risk: the three-pane shell can become visually dense; progressive disclosure and a clear
mobile collapse are mandatory.

## Selection rule

Use C as the initial recommendation, but keep A and B available in the prototype so the
team can explicitly choose which product center should dominate.
