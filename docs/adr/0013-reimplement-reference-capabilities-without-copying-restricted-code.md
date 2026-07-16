# Reimplement Reference Capabilities Without Copying Restricted Code

Status: accepted

OpenCLI may use public products and documentation, including Mobius, to identify valuable user-visible capabilities, but it will implement those capabilities independently inside OpenCLI's data collection, processing, delivery, Workflow, Agent Control API, and governance model. We will not vendor, fork, translate, or copy Mobius source code, UI layouts, visual assets, names, or protected implementation details because its source-available license restricts commercial use and protects interface design; Mobius remains a capability reference rather than a code dependency or embedded runtime by default.

Consequences:

- Requirements describe observable behavior and OpenCLI domain outcomes rather than Mobius internal modules or screen structure.
- OpenCLI tests, schemas, APIs, workflows, and UI are authored independently under this repository's conventions.
- A future direct Mobius integration requires a separate technical and licensing decision; it is not implied by feature parity work.
