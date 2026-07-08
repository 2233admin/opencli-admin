# Native Runtime Nodes and Managed External Graphs

Status: accepted

OpenCLI Admin will model workflow authoring around native runtime nodes, typed ports, packaged node presets, gates, merge strategies, lineage, run trace, checkpoints, and a capability catalog rather than exposing Pi, LangChain, or LangGraph as first-class user-facing node systems. External runtime graphs may keep their original structure and executors, but they enter the Collection Canvas as managed Runtime Package Nodes whose tools must map to registered OpenCLI Admin capabilities and whose state, trace, checkpoints, resources, permissions, and control suggestions must be translated through Runtime Capability Mapping. This preserves external runtime semantics without turning the product into a compatibility canvas, while still internalizing the operational capabilities needed for no-code Plan assembly and governed execution.

Considered options:

- Flatten imported LangGraph, LangChain, or Pi graphs into native Plan nodes by default. Rejected because it loses external runtime semantics such as state graph behavior, interrupts, and checkpoint rules.
- Let external runtimes execute as opaque black boxes with private tools. Rejected because it bypasses capability governance, resource binding, trace, checkpoint, and permission controls.
- Treat every runtime tool call as a Canvas node. Rejected because it turns the authoring surface into a trace dump instead of a workflow program.

Consequences:

- New nodes must enter through the Node Onboarding Path: Business Capability, Capability Manifest, runtime binding, probes, Packaged Node Preset, and Node Preset Family assignment.
- AI may propose Plan Drafts and Plan Change Proposals, but runnable Plans must be materialized through the Canvas Approval Surface with capability availability, typed-port compatibility, resources, and gates resolved.
- Flow nodes such as merge, split, route, gate, and window are capability-backed nodes too, even when their executor is built into OpenCLI Admin.
