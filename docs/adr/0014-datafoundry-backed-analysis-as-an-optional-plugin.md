# DataFoundry-Backed Analysis As An Optional Plugin

Status: accepted

OpenCLI will support selected DataFoundry analysis capabilities through an optional Data Analysis Plugin rather than making DataFoundry a product area or mandatory platform kernel. The plugin registers governed Workflow nodes and Agent tools for data-source access, schema inspection, semantic context, read-only analysis controls, evidence-preserving analysis tasks, and table, chart, report, SQL, and file outputs. It may run a bundled implementation adapted under DataFoundry's Apache-2.0 license or call a separately deployed DataFoundry service through the same governed plugin contract. OpenCLI remains authoritative for Projects, Workflows, authorization, Runs, confirmations, evidence references, artifacts, and delivery.

Consequences:

- Installing, enabling, disabling, or upgrading the plugin changes available analysis capabilities without changing OpenCLI's core product model.
- The plugin does not add a competing top-level DataFoundry workbench, authentication system, model-administration UI, TUI, or duplicate resource-management surface.
- Bundled and remote execution expose compatible Workflow-node and Agent-tool contracts and produce OpenCLI-governed Run evidence and artifact references.
- DataFoundry-derived code remains identifiable for license compliance and is isolated behind OpenCLI-owned plugin contracts.
- If the plugin is absent, Projects and Workflows remain valid; affected nodes report a Capability Gap instead of making the platform unusable.
