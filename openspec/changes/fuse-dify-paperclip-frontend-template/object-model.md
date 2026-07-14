# Locked Object Model

This file locks the product granularity and the integration boundary with the node system that
already exists in this repository.

## Product hierarchy

```text
Workspace
├── Projects
│   └── Project
│       ├── Workflows / Pipelines
│       │   └── WorkflowGraph
│       │       ├── WorkflowProjectNode instances
│       │       └── WorkflowProjectEdge connections
│       ├── Data assets and outputs
│       ├── Runs and schedules
│       ├── Versions
│       ├── Work items
│       └── Project settings
├── Agent teams
├── EdgeNode / Worker / Fleet inventory
├── Shared plugins and node templates
└── Workspace Inbox and governance
```

Workspace, Project, Workflow, Run, Version, Work item, Inbox item, Data asset, plugin definition,
and catalog definition are product objects. They are not workflow-graph nodes.

## The graph reuses the existing canonical model

The only graph node contract is the existing `WorkflowProjectNode`:

```text
WorkflowProjectNode
├── id
├── kind
├── capability
├── adapter?
├── params
├── parameterInterface?
├── internals?        # nested canonical nodes and edges
└── ui?
```

The only graph connection contract is the existing `WorkflowProjectEdge`:

```text
WorkflowProjectEdge
├── source / target
├── sourcePort / targetPort
├── label / condition
├── semantic
├── weight
└── contractId
```

Direction C must not introduce a second `ProjectNode`, connection store, inspector state, or
execution-binding dropdown for the project editor. Project entry embeds the existing
`WorkflowEditorSession`, React Flow canvas, catalog, Inspector, internal Network navigation,
Run Trace, and node-management surfaces.

## What is a node and what is not

| Object | Graph node? | Rule |
| --- | --- | --- |
| Workspace / Project / Workflow | No | Ownership and lifecycle containers around the graph. |
| Work item / Inbox item / Run / Version | No | Operational records that deep-link to graph objects. |
| Data asset | No | Durable asset; source/sink nodes may reference it. |
| Plugin / Catalog item / Primitive definition | No | Reusable definition until instantiated on a graph. |
| Schedule lifecycle object | No | Project-level scheduling record. |
| Schedule trigger | Yes | A `schedule::trigger` node when it participates in the graph. |
| Acquisition / cleaning / routing / storage step | Yes | Canonical workflow node with typed ports. |
| Composite/HDA | Yes | Canonical node whose `internals` contain canonical nodes and edges. |
| AI processor/model/prompt | No | Capability referenced by an Agent node. |
| Agent processing step | Yes | Canonical `agent::*` workflow node. |
| EdgeNode / Worker / remote runtime inventory record | No | Control-plane source of truth for health, endpoint, runtime, and capability data. |
| Device / Worker / Agent resource used by a workflow | Yes, as a projection | A thin canonical resource-node instance referencing the inventory record and connected through normal ports/edges. |
| Agent team | No | Paperclip-style organization and governance object; an Agent/resource node may reference it. |

The inventory record and its graph projection are deliberately distinct. The inventory owns
credentials, endpoint, protocol, online state, runtime availability, and capability discovery.
The graph resource node owns only a stable reference or selector that is safe to persist and the
ports needed to connect it to processing nodes.

## Runtime placement rule

“Where it runs” is represented by a node relationship, not a string property on a business node.

```text
EdgeNode / Worker / Agent inventory
                │ projected as
                ▼
Canonical resource node ──sourcePort / targetPort / semantic / contractId──> processing node
```

Fleet matching may resolve a selector to a concrete endpoint at compile/run time and may emit
`workerSlotId`, `profileBindingId`, session, lock, or concurrency metadata in runtime results.
Those runtime results do not create a second node schema and are not copied into business-node
`params` as raw executor fields.

## Existing encapsulation model

- Catalog items and primitives are definitions.
- Dropping one on the canvas creates a canonical node instance.
- A compound node stores nested canonical nodes and edges in `internals`.
- Double-click/Network navigation enters the existing internal graph.
- Connection validation continues to use the existing ports, contracts, cycle checks, and source/
  target connection limits.

## Terminology rules

- Use “工作流节点” for canonical graph nodes.
- Use “资源节点” for the graph projection of a device, Worker, Fleet Agent, or compute resource.
- Use “设备/Worker/Fleet 清单” for the control-plane records behind resource nodes.
- Use “AI 处理器” for model/prompt processors.
- Use “Agent 团队” for organization, delegation, Heartbeat, and governance.
- Use “Agent 节点” only for a canonical workflow node.
- Do not use `bindingOptions`, `executionRequirement`, or `bindingRef` as a new parallel prototype model.

## Integration seam still required

The formal editor is already reused. A later production slice may add the thin resource-node
catalog/projection and connect it to the existing Fleet inventory/match APIs. That slice must also
prove that React Flow edge additions/removals are synchronized into the canonical
`WorkflowProject` before autosave. It must not restore the removed prototype binding UI.
