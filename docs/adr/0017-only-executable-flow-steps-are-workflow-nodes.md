# Only Executable Flow Steps Are Workflow Nodes

Status: accepted

OpenCLI will represent only executable data-flow or control-flow steps as Workflow nodes. Source reads, triggers, transforms, Agent processing, branches, approvals, and Sink writes may participate in the graph because their edges carry execution, data, or control semantics. Projects, Connections, Destinations, Plugin Installations, Agent definitions and deployments, Execution Resources, Automations, Runs, Deliveries, Work Items, permissions, and governance policies remain authoritative domain objects that nodes reference or produce rather than nodes themselves.

Consequences:

- The Workflow Canvas remains an executable program instead of becoming a generic object map.
- Resource infrastructure and Agent collaboration use their own operational or analytical views and never share the Workflow graph's edge semantics.
- Agent-Guided Configuration may create both nodes and referenced domain objects, but it must present their different effects in one reviewable proposal.
- Plugin manifests may register executable node types and tools but cannot turn arbitrary settings or records into Workflow nodes.
