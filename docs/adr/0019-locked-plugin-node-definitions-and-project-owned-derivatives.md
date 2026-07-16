# Locked Plugin Node Definitions And Project-Owned Derivatives

Status: accepted

OpenCLI will use a Houdini-inspired separation between versioned Node Definitions and Workflow Node Instances. Plugin-provided Node Definitions are locked for ordinary use: operators may inspect declared internals and edit instance parameters, but structural edits require the explicit “customize this node” action, which creates a Project Node Definition derived from the installed Plugin and version. The derived definition records provenance and differences, is owned by the Project, and is not overwritten by later Plugin upgrades.

Consequences:

- Multiple installed Node Definition versions may coexist so existing Workflows remain reproducible.
- Parameter edits remain lightweight Node Instance changes and never affect other instances.
- Structural customization is visible, versioned, reversible, and isolated from the shared Plugin package.
- OpenCLI can offer compare, restore-to-source, and deliberate rebase operations without silently mutating a running Workflow.
- Publishing custom nodes to a workspace node library, approval-based node releases, and automatic instance migration are outside the current product scope.
