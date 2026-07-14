# Design Spec

## Design read

OpenCLI is a data-pipeline IDE, not a generic dashboard with a canvas inside it. The outer
product may support complex automation, Agent teams, and operations, but the primary builder
task is still: choose a project, open a workflow, connect data-processing nodes, inspect data,
bind execution resources, test, and publish.

Direction C uses OpenCLI's existing dark, dense, precise console language. Dify contributes
the familiar project/workflow editor rhythm; OpenCLI retains its node catalog, nested node
composition, adapters, data contracts, and execution capability tags. Linear and Paperclip
remain adjacent operating systems, not permanent canvas chrome.

Design dials: variance 5/10, motion 3/10, density 8/10.

## Signature

The memorable sequence is **project browser → data pipeline IDE → node execution binding**.

1. Workspace answers “which project am I entering?”
2. Project answers “which workflow/data asset/run am I working with?”
3. Workflow IDE answers “what data processing is this graph performing?”
4. Node inspector answers “what is the contract, and where may this node run?”

## Layout

- Workspace desktop: compact global navigation plus a responsive project list/grid.
- Workspace cards: project name, type, owner, tags, update time, aggregate workflow/data count,
  and light health only. Templates live in the create flow.
- IDE desktop: compact global navigation, project/workflow breadcrumb and switcher, flexible graph,
  and a 300–320px selected-node inspector.
- IDE bottom dock: sample data, logs, Schema, and Trace.
- Project sections: 编排、数据、运行、调度、版本、设置.
- Tablet/mobile: the inspector and bottom dock stack; lifecycle tabs scroll horizontally.
- Fixed prototype switcher reserves at least 88px bottom padding.

## Node inspector

The selected node panel is organized around four independent facts:

- node layer: business, composite, atomic, or Agent node;
- data contract: explicit input and output types/schemas;
- execution requirements: capabilities, worker/resource tags, placement policy;
- binding reference: executor pool, device, or Agent team chosen at publish/runtime.

Candidate runtimes and online state come from Fleet/control-plane inventory. They are not
copied into the persistent node definition as display strings. The static prototype uses
representative strings only to demonstrate the interaction.

## Platform control planes

- **Agent 集群** owns Agent organization, roles, Heartbeat, delegation, governance, and team health.
- **设备与算力** owns local runtimes, LAN devices, camera-capable devices, compute servers,
  remote executors, capability discovery, and availability.
- **插件市场** owns reusable capability packaging.
- The workflow IDE only selects or inspects the binding relevant to the current node.
- Global Inbox (“待我处理”) receives failures, approvals, and Agent escalations and deep-links
  back to the relevant project/workflow/node/run.

## Visual system

- Reuse `background`, `card`, `muted`, `border`, `foreground`, and semantic state tokens.
- White/black remains the broad brand contrast; semantic colors only communicate state.
- Noto Sans SC is used for interface copy and IBM Plex Mono for IDs, data types, timestamps,
  states, and execution telemetry.
- Panels use the existing small radii and hairline borders. Avoid decorative dashboard-card grids
  above the graph.

## States

- Work state, workflow draft state, published version, run state, executor state, and Agent-team
  state are separate.
- A project can contain a main workflow plus sub-pipelines; a project is not its first workflow.
- Plugins are shared capabilities consumed by nodes, not a replacement hierarchy.
- Inbox items deep-link to product objects; Inbox is not an alternative project hierarchy.

## Accessibility

- Native buttons and inputs only for prototype interactions.
- Variant switcher supports buttons and Left/Right keyboard shortcuts without intercepting form input.
- Focus rings remain visible and status is never color-only.
- Primary production targets should reach 40px desktop and 44px mobile; the static dense prototype
  may retain compact secondary controls.

## Prototype boundary

- The route is development-only and returns 404 in production.
- The prototype is read-only and contains no API hooks.
- Production integration must extend `/studio`, `WorkflowEditorSession`, the existing React Flow
  editor/inspector, and Fleet inventory rather than promoting the prototype as a parallel source of truth.
