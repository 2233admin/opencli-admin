# Credentials Narrow To Ephemeral Node Execution Grants

Status: accepted

OpenCLI will narrow external-system authority through four stages: the workspace Connection and policy define the maximum available capability, a Project Connection Binding authorizes a subset, a Node Instance declares the smaller subset it needs, and the backend issues a short-lived Execution Grant for one Run, node, operation, and triggering identity or Automation. Plugins and execution resources do not receive reusable workspace credentials or implicit access to every Project binding.

Consequences:

- Read, collect, send, publish, comment, upload, and administrative capabilities can be authorized independently even when they use the same external account.
- Runtime authorization is computed backend-side and cannot be widened by frontend state, Agent prompts, or plugin parameters.
- Audit evidence preserves the human, Agent, proposal, Automation, Run, node, and grant delegation chain.
- Browser sessions and other login state remain mediated runtime bindings rather than secrets copied into Workflow definitions.
- Revoking or narrowing a Connection Binding prevents future grants without rewriting published Workflow Versions.
