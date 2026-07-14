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

## C. Data Pipeline IDE with Dify Entry (selected direction)

Visual thesis: preserve OpenCLI's existing Dify-like entry while making the real hierarchy
explicit: Workspace → Project → Workflow → Node. The workspace is a quiet project browser.
Opening a project exposes its workflow selector and data-pipeline IDE. The graph is central,
the right panel configures the selected node and its execution binding, and the bottom dock
shows sample data, logs, Schema, and Trace.

Interaction thesis: users enter `/studio`, select a workspace, create or open a project, choose
its main workflow or sub-pipeline, compose data-contract-driven nodes, bind runtime requirements,
test with real samples, and publish. Project data, runs, schedules, versions, and settings remain
available as adjacent tabs. Inbox deep-links to the relevant object. Agent teams and devices/
compute are separate control planes referenced by node bindings.

Fit: matches OpenCLI's node foundation and uses a workflow mental model that Dify and n8n
users already understand, while preserving the team's existing Linear-like operating logic.

Risk: the existing formal Studio still silently opens a project's first workflow. Production
integration must add an explicit Project → Workflow boundary and stable executor/Agent binding
references without replacing the existing editor or Fleet foundation.

## Selection rule

C is now the selected synthesis. Keep A and B available as comparison references: A shows
the pure builder extreme; B shows the pure task-control-plane extreme.
