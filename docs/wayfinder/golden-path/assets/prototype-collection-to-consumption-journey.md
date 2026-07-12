# Collection-to-consumption journey prototype resolution

## Validated direction

Use the familiar Dify-style application journey as the interaction baseline: start from a template or blank application, choose user input or an automatic trigger, compose Nodes on the Canvas, test, publish, monitor, and iterate. Keep the existing global operations dashboard as the command center rather than replacing it with chat or a Data Feed-first home.

The platform is a general Node execution and operations console whose first complete vertical is collection. Collection Request and Data Feed remain useful domain capabilities, but neither defines the product boundary. A published Workflow may surface as a page, chat application, CLI, API, Tool, Automation, batch job, dashboard component, Artifact, or Data Feed.

## Product model

- **Workflow and Canvas** are the common composition surface for every capability.
- **Agent** is an intelligent execution participant; **Automation** is a trigger for a published Workflow Version. They remain separate concepts and can be composed together.
- Manual configuration and trigger Nodes are two authoring paths to the same Automation fact, not separate execution systems.
- **Nodes** expose typed inputs, outputs, parameters, and runtime requirements. Complex networks are packaged behind simple reusable Nodes, Custom Nodes, Integration Packages, and Templates.
- **Workspace components** render published inputs, outputs, Runs, evidence, and actions. Chat and terminal are optional components, not mandatory landing pages.
- The global operations dashboard remains the cross-Project view for Runs, failures, freshness, capacity, Findings, and required attention.

## Node-system posture

Adopt the depth of a Houdini-style procedural system without exposing its learning cost. Users get packaged tools with curated parameters by default; advanced users may inspect, customize, version, and reuse internal Node networks. Do not expose HDA as product language.

## Compatibility posture

Dify, n8n, and later external workflow formats enter through translators into one canonical Workflow intermediate representation. Reuse the existing n8n translation seam. Each imported construct must be classified as:

1. a native mapping to an installed Node;
2. a compatibility wrapper supplied by an Integration Package; or
3. an explicit unsupported capability requiring user repair.

Imports must never silently invent behavior. External formats do not receive separate product runtimes.

## Rejected prototype direction

The reviewed A/B/C prototype over-centered a linear Collection Request → Data Feed journey. It was useful for exposing the scope error but is not an implementation reference. The replacement journey is:

**Operations dashboard → template or blank application → Canvas composition → test Run → publish into one or more usable surfaces → observe and improve.**
