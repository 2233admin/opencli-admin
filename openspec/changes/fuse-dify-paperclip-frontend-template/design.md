# Design Spec

## Design read

OpenCLI is a data-pipeline IDE. The outer product may support complex automation, Agent teams,
resource fleets, and operations, but the primary builder task remains: choose a project, open a
workflow, compose canonical nodes, inspect contracts and data, test, and publish.

Direction C keeps OpenCLI's dark, dense, precise console language. Dify contributes the familiar
project/workflow rhythm. OpenCLI's existing formal editor supplies the graph, Catalog, Inspector,
internal Networks, node management, and Run Trace. Linear and Paperclip remain adjacent operating
systems rather than permanent canvas chrome.

Design dials: variance 5/10, motion 3/10, density 8/10.

## Signature

The memorable sequence is **project browser → existing pipeline IDE → canonical graph**.

1. Workspace answers “which project am I entering?”
2. Project answers “which workflow/data asset/run am I working with?”
3. The formal WorkflowEditor answers “what graph is being built and how is it connected?”
4. The formal Inspector answers “what is this canonical node/edge and what data does it use?”

## Layout

- Workspace desktop: compact global navigation plus a responsive project list/grid.
- Workspace cards: project name, type, owner, tags, update time, workflow/data count, and light health.
- Project entry: project lifecycle header plus an explicit return to the project browser.
- Project editor: the existing `WorkflowEditorSession` fills the remaining viewport.
- Project sections: 编排、数据、运行、调度、版本、设置.
- Fixed prototype switcher reserves safe bottom space on the workspace screen; the full-screen editor
  remains usable at desktop and narrow widths.

## Node and connection design

Direction C does not define a project-specific node card or Inspector. It inherits:

- `WorkflowProjectNode` identity (`kind`, `capability`, `adapter`, `params`, `internals`);
- `WorkflowProjectEdge` identity (`sourcePort`, `targetPort`, `semantic`, `contractId`);
- formal port handles, connection validation, edge rendering, and nested Network navigation;
- formal Inspector tabs for configuration, prompt, run result, and execution trace;
- node-management surfaces for nodes, contracts, runtime, and Agents.

Devices, Workers, compute resources, and remote Fleet Agents are not string options on a business
node. A future integration may project an inventory record into a canonical resource node and
connect it to processing nodes with the same ports and edges. Credentials, endpoint health, and
candidate discovery remain in the control plane.

## Platform control planes

- **Agent 集群** owns Agent organization, roles, Heartbeat, delegation, governance, and team health.
- **设备与算力** owns EdgeNode/Worker/Fleet inventory, runtimes, capability discovery, and availability.
- **插件市场** owns reusable definitions; a graph node exists only after a definition is instantiated.
- Global Inbox receives failures, approvals, and Agent escalations and deep-links to the relevant
  project/workflow/node/run.

## States

- Work state, workflow draft state, published version, run state, inventory state, and Agent-team
  state are separate.
- A Project contains Workflows; it is not its first Workflow.
- A graph node and a platform inventory record are distinct even when a resource node references
  that inventory record.
- A schedule record is project lifecycle data; a schedule trigger is a graph node when present.

## Accessibility

- Native buttons and inputs remain the prototype interaction foundation.
- Variant switcher supports buttons and Left/Right shortcuts without intercepting form input.
- Focus rings remain visible and status is never color-only.
- Formal editor accessibility behavior is reused rather than reimplemented in the prototype.

## Prototype boundary

- The route is development-only and returns 404 in production.
- The workspace shell uses representative data.
- The embedded `WorkflowEditorSession` runs standalone because the prototype supplies no
  `workspace/project/workflow` query; draft save, validation, and publish mutations are inactive.
- Production integration extends the existing Studio/session and adds only a thin resource-node
  projection when ready. It must not promote the static A/B comparison canvas or recreate the
  removed execution-binding panel.

## Four-layer canonical node hierarchy

The formal editor now uses one recursive node contract for four product layers:

1. **L1 Operator / 业务节点** — the Dify-style business step shown on the workflow canvas.
2. **L2 Implementation / 实现节点** — the existing OpenCLI node or package that implements L1.
3. **L3 Component / 组件节点** — an implementation's editable internal component network.
4. **L4 Primitive / 原子节点** — the deepest normal execution unit.

Every layer is still a `WorkflowProjectNode`; `internals.nodes` and `internals.edges` create the next
scope. A node is structural only when it has non-empty child internals. L5 is rejected. Navigation is
read-only, while “Add Internal Primitive” is the explicit operation that may initialize or migrate a
child network. Visual-only React Flow parent/child and insert-on-edge shortcuts are not workflow
hierarchy operations and therefore stay disabled.

Compilation recursively expands executable leaves, rewrites container-boundary edges to those
leaves, topologically orders runtime nodes independently of authoring-array order, and carries the
full `nodePath` through run states, events, dispatches, and evidence. Local node ids reserve `::` and
`__` for runtime and canvas path projection.
