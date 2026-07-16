# Plugin UI Is Declarative And Platform Rendered

Status: accepted

OpenCLI Plugins will describe their user-facing configuration and capabilities through manifests, typed schemas, icons, localized metadata, permissions, probes, and status contracts. OpenCLI Admin renders those declarations inside platform-owned Plugin Management, Workflow palette and inspector, and Agent tool-selection surfaces. The initial plugin contract will not load arbitrary plugin frontend code, add plugin-owned top-level navigation, or embed a competing application shell.

Consequences:

- Plugin configuration, validation, permissions, health, and capability descriptions inherit OpenCLI's design system and governance behavior.
- A plugin cannot bypass Agent proposals, Gates, credential isolation, or platform authorization through custom browser code.
- Rich plugin-specific visualizations require a future sandboxed extension contract and a separate architecture decision.
- DataFoundry-backed analysis appears through native OpenCLI nodes, tools, Runs, evidence, and artifacts rather than an iframe or copied workbench.
