# 08 — Browser worker/profile concurrency

Labels: ready-for-agent, runtime-resource-contract
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Add the runtime resource contract for browser execution capacity and profile/session coordination. This slice does not add user-visible worker/profile/cookie fields and does not require full multi-machine dispatch. It defines how compiled OpenCLI tasks resolve worker capacity and browser session resources, and how missing/locked resources become structured blocked reasons.

Browser-heavy work should eventually scale through multiple browser-worker containers per machine and multiple machines. Same-source multi-adapter work should share ProfileBinding and SessionSnapshot across containers while protecting profile mutations with ProfileLock. This issue is the first executable resource-resolution layer for that model, not a rewrite of OpenCLI collection behavior.

## Contract

Runtime resource resolution owns these fields:

- `workerPool` / worker slot: selected by scheduler/resource resolver, never typed by the user.
- `profile` / `profileBindingId`: resolved from source/site/account policy, never exposed as a required node input.
- `session` / `sessionSnapshotId`: resolved for read-only fanout when available.
- cookie material: held by browser/profile infrastructure only; never stored in WorkflowProject params, Canvas node fields, or AI patches.
- `concurrency`: an execution policy cap from package defaults/resource resolver. User-facing nodes may request broad intent such as source count or freshness, but not a concrete worker assignment.

Minimum backend contract:

- `WorkflowRuntimeResourceRequirement` records `{ nodeId, sourceGroup, site, mutationMode, requestedCapability }`.
- `WorkflowRuntimeResourceResolution` records `{ status: resolved|blocked, workerSlotId?, profileBindingId?, sessionSnapshotId?, lockId?, blockReason? }`.
- OpenCLI dispatch metadata can reference the resolution ids, but must not embed secrets/cookies.
- Missing capacity, missing profile, locked profile, and unsupported mutation mode become structured block reasons on the node run event stream.

Agent scope: implement resource requirement/resolution data structures, routing metadata, and blocked reasons. Do not build the full Docker/multi-machine scheduler in this issue.

## Acceptance criteria

- [ ] Browser-worker capacity can be represented as container/worker slots independent of a single desktop Chrome.
- [ ] Multiple workers can register capacity for routing compiled OpenCLI tasks.
- [ ] ProfileBinding and SessionSnapshot are represented as runtime resources.
- [ ] Read-only tasks may share a snapshot; mutation tasks require exclusive ProfileLock.
- [ ] WorkflowProject params, Canvas node fields, and AI patches cannot carry cookie material, concrete profile ids, or concrete worker slot assignments.
- [ ] Missing capacity/profile/session and profile-lock contention emit structured blocked reasons instead of runnable fake success.
- [ ] Tests cover worker registration/capacity view, resource requirement/resolution records, snapshot sharing, mutation lock exclusion, blocked reasons, and routing metadata for OpenCLI tasks.

## Blocked by

- 05 — Multi Source OpenCLI HDA tracer
