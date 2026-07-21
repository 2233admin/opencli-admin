# ADR-0026: Run Dify workflows through a pinned Graphon compatibility sidecar

Status: Accepted for P0 implementation

Date: 2026-07-21

## Context

OpenCLI Admin already accepts Dify app DSL in the browser, but the current translator only creates a visual compatibility package. It maps model nodes to a mock adapter, maps HTTP/tool/knowledge nodes to fixture adapters, disables network access, and does not preserve an executable source payload. The exact current boundary is visible in `frontend/lib/workflow/dify-translator.ts:48-127` and `frontend/lib/workflow/dify-translator.ts:188-220`.

The existing compiler expands every package with internals into native executable nodes (`backend/workflow/compiler.py:825-894`). That behavior is correct for native HDA packages but wrong for an external graph engine whose internal state, branching, retries, and node semantics must remain authoritative.

The repository already established three relevant constraints:

- External graphs enter the Canvas as managed runtime package nodes, rather than creating a second Canvas or being flattened by default (`docs/adr/0010-native-runtime-nodes-and-managed-external-graphs.md:1-17`).
- Plugin UI is declarative and rendered by the platform (`docs/adr/0015-plugin-ui-is-declarative-and-platform-rendered.md:1-12`).
- Installations, credentials, resources, agents, and runs are domain objects; only executable flow steps become workflow nodes (`docs/adr/0017-only-executable-flow-steps-are-workflow-nodes.md:1-13`).

Graphon 0.7.0 can inspect and load Dify workflow DSL, execute a graph, and emit graph/node events. It currently requires Python 3.12 or 3.13 and remains an evolving project. The P0 reference is pinned to commit `b187ce7927fea1a7c137b642be3f78e3abb9f7de`. Dify Plugin Daemon Slim is pinned separately to commit `14877f8f8b6dd63d3cec760411a875cc8e077547` (tag `0.6.5`) when LLM execution is enabled.

## Decision

1. OpenCLI Admin remains the control plane and `WorkflowProject` remains the only authoring and execution input exposed to users and Agents.
2. A Dify import creates one `package.compat.dify-workflow` managed runtime package. Its internal graph remains visible and addressable, but the OpenCLI compiler does not flatten those internal nodes into native executor bindings.
3. The package stores a canonical, content-hashed Dify source payload in its parameters for P0. Import rejects payloads above 1 MiB and never copies credential material into events or logs. The storage shape is versioned so the payload can move to an artifact store later without changing runtime semantics.
4. The package compiles to one runtime binding: `workflow.compat.dify.graphon`.
5. Graphon runs in a dedicated HTTP sidecar. Its version and source commit are pinned. OpenCLI does not import Graphon into the main backend process.
6. OpenCLI calls the sidecar through a narrow contract:
   - inspect a Dify DSL and return support status, dependencies, node identities, and blockers;
   - start a run with request-scoped inputs and request-scoped credential grants;
   - replay ordered runtime events by sequence;
   - cancel an active run.
7. Graphon node events are translated into existing `WorkflowNodeRunEvent` records. Every imported node uses `nodePath=[packageNodeId, difySourceNodeId]`, so the existing projection and Canvas runtime bridge can update nested node state (`backend/schemas/workflow.py:723-779`, `frontend/lib/workflow/runtime-bridge.ts:17-113`).
8. Final scalar/object outputs are persisted in the package completion event and exposed through the existing run trace API. Record-like arrays may additionally create EvidenceBatch metadata; P0 does not create a second Dify result store (`backend/api/v1/workflows.py:500-590`).
9. Existing OpenCLI model providers are the source of model endpoint and key configuration. Credentials are resolved immediately before dispatch and are sent only to the sidecar as a request-scoped grant; source DSL, saved projects, run events, and responses contain references or redacted metadata only.
10. Dify plugin packages are a separate P0 capability. OpenCLI may import and persist manifest metadata and project locked node definitions, but it does not execute arbitrary plugin code in P0.
11. A `.difypkg` is treated as an untrusted ZIP container. Intake enforces size, entry-count, decompression-ratio, and path-traversal limits; reads `manifest.yaml`; records whether a signature is present; and never extracts executable content to a runtime path.

## Sidecar contract

The initial contract is internal-only and versioned as `opencli.graphon.compat.v1`.

### Inspect

`POST /v1/dify/inspect`

Request:

    {
      "source": {"format": "dify-app-dsl", "sha256": "...", "content": "..."},
      "policy": {"allowNetwork": false, "allowCode": false}
    }

Response:

    {
      "loadStatus": "ready | blocked | unsupported | failed",
      "engine": {"name": "graphon", "version": "0.7.0", "commit": "..."},
      "appMode": "workflow | advanced-chat",
      "nodes": [{"sourceNodeId": "...", "type": "...", "status": "..."}],
      "dependencies": [{"type": "model | tool | sandbox | network", "id": "..."}],
      "blockers": [{"code": "...", "nodeId": "...", "message": "..."}]
    }

### Run and replay

- `POST /v1/dify/runs` accepts the inspected source, inputs, policy, and ephemeral grants and returns a runtime run id.
- `GET /v1/dify/runs/{runtimeRunId}/events?afterSequence=N` returns ordered normalized Graphon events.
- `POST /v1/dify/runs/{runtimeRunId}/cancel` is idempotent.
- The adapter must tolerate replay after an OpenCLI process restart and must deduplicate by `(runtimeRunId, sequence)`.

## Consequences

- Native HDA packages continue to expand exactly as they do today.
- Managed compatibility packages need an explicit compile mode so the current structural-container test does not flatten them.
- P0 can prove real Dify execution without importing Dify’s application backend or frontend.
- The sidecar can later be scheduled onto LAN compute resources because its contract is already process- and host-independent.
- P0 has an extra deployable service and a pinned upstream compatibility obligation.
- Dify code nodes remain blocked until a sandbox runtime is connected. Dify tool nodes remain blocked until an executable tool adapter is connected. Manifest import alone never makes a capability executable.

## Rejected alternatives

- **Copy Dify’s frontend or run a second Dify workspace:** violates the single-Canvas product boundary and introduces licensing/product coupling.
- **Flatten all imported nodes into native OpenCLI nodes:** loses Dify runtime semantics and produces false compatibility.
- **Install Graphon in the main API environment:** increases dependency and upgrade blast radius and makes later LAN compute routing harder.
- **Run every imported `.difypkg` immediately:** creates an unacceptable arbitrary-code and credential boundary before signature, sandbox, and permission enforcement exist.
