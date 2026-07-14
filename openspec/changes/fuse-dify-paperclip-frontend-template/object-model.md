# Locked Object Model

This file locks the product granularity for future frontend and backend integration.

## Hierarchy

```text
Workspace
├── Projects
│   └── Project
│       ├── Workflows / Pipelines
│       │   └── WorkflowGraph
│       │       ├── Node instances
│       │       └── Edges / Data contracts
│       ├── Data assets and outputs
│       ├── Runs and schedules
│       ├── Versions
│       ├── Work items
│       └── Project settings
├── Agent teams
├── Runtime / device / compute pools
├── Shared plugins and node templates
└── Workspace Inbox and governance
```

## Definitions

### Workspace

The tenant/team and shared-resource boundary. It contains projects and platform control-plane
resources. Its default page is a project browser, not an all-in-one operational cockpit.

### Project

The ownership, permissions, data lifecycle, and grouping boundary for a business outcome. A
project contains one or more workflows, data assets, runs, schedules, versions, and work items.
It is not equivalent to a WorkflowGraph.

### Workflow / Pipeline

An independently editable, testable, publishable, and runnable graph inside a project. A project
may nominate one main workflow and may contain sub-pipelines. A single-workflow project may open
the IDE immediately only when the breadcrumb and workflow switcher keep this object visible.

### Workflow node

A graph instance that declares what processing occurs and the data contract it consumes/produces.
It may be a business node, a composite node that expands into internal nodes, an atomic node, or
an Agent node. A workflow node is not an executor or physical device.

### Edge / Data contract

The typed connection between node outputs and inputs. It carries schema, lineage, and compatibility
information and enables sample preview and validation.

### Executor / device / runtime pool

The place where a node can run: local runtime, camera-capable device, LAN device, compute server,
remote worker, or a capability-matched pool. Fleet/control-plane inventory owns online state and
candidate discovery.

### AI processor

A model, prompt, or enrichment capability. It may be referenced by an Agent node but is not an
Agent organization or execution device.

### Agent team

A Paperclip-style organization/control-plane object with roles, delegation, Heartbeat, governance,
and team health. A workflow Agent node may bind or delegate to a team; the team itself is managed
outside the project IDE.

### Run

One execution of a published or debug workflow version with node-level traces, logs, outputs,
resource bindings, and evidence.

### Data asset

A dataset, knowledge index, artifact, media collection, or other durable project input/output with
schema, lineage, version, and lifecycle.

## Orthogonal node dimensions

Never infer one dimension from another:

1. **Business semantics** — acquisition, cleaning, detection, storage, delivery, approval, etc.
2. **Encapsulation layer** — business, composite, atomic, or Agent node.
3. **Execution binding** — requirements and placement to local, LAN, device, compute pool, or Agent team.

## Target persistence shape

```text
NodeInstance
├── nodeDefinitionRef
├── input/output contract refs
├── params and adapters
├── executionRequirement
│   ├── capabilities
│   ├── workerTags
│   ├── resourceTags
│   └── placementPolicy
└── bindingRef
    ├── executorPoolId?
    ├── deviceId?
    └── agentTeamId?
```

The UI may show resolved candidates, health, and friendly labels, but persistence should store
stable references and policies rather than duplicating live inventory.

## Terminology rules

- Use “工作流节点” for graph nodes.
- Use “执行器/设备” for runtime endpoints.
- Use “AI 处理器” for model/prompt processors.
- Use “Agent 团队” for the organization/control plane.
- Use “Agent 节点” only for a workflow node that references a processor or delegates to an Agent team.
