# 0011 Adopt Pod-Style Fleet Routing

Status: accepted

## Context

OpenCLI Admin already has a single-operator fleet: edge nodes register over HTTP
or reverse WebSocket, browser endpoints expose CDP or bridge mode, runtimes are
advertised by agents, and site bindings pin logged-in browser state to a node.

Hyperspace AGI's public docs describe Pods as private AI clusters with members,
capability/resource discovery, smart routing, provider fallback, budgets, usage
ledger, federation, and portable capsule state. The useful subset for OpenCLI
Admin's current collection cluster is the control-plane pattern, not the full
P2P training, blockchain, or sharded inference stack.

Primary upstream references:

- https://github.com/hyperspaceai/agi
- https://github.com/hyperspaceai/agi/blob/main/docs/PODS.md

## Decision

Treat the OpenCLI Admin collection fleet as a private agent pod:

- Inventory is the pod snapshot: `GET /api/v1/workflows/fleet/inventory`.
- Fleet members are projected from browser pool endpoints, browser instances,
  edge nodes, connected WS agents, and site bindings.
- Capabilities use stable namespaces: `agent.*`, `browser.*`, `runtime.*`,
  and `site.*`.
- Routing policy is `site_binding_agent_first`: a site-bound agent is preferred
  for browser-required OpenCLI work, then the router falls back to any registered
  agent endpoint.

## Now

`WorkflowFleetInventoryResponse` exposes top-level `version: 1.1.0`.
Its `summary` exposes:

- `clusterModel: private-agent-pod`
- `routingPolicy: site_binding_agent_first`
- `capabilityNamespaces: [agent, browser, runtime, site]`

`OpenCLIChannel.collect()` uses the same site binding signal as workflow fleet
match, so matching and actual task dispatch agree.

## Later

Add the remaining pod concepts only when there is a concrete runtime surface:

- Provider fallback and per-member budgets.
- Usage and task receipt ledger.
- Invite/join flow for remote nodes.
- Portable encrypted capsule export.
- Model/resource routing if OpenCLI Admin starts serving inference workloads.

Do not import Hyperspace's model assets or LFS files into this repository.
