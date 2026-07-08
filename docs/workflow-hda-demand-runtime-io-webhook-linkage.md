# Workflow HDA runtime I/O and webhook linkage

Status: design note for the post-`05` runtime slice.
Related issues: `06-node-run-event-stream`, `07-evidencebatch-projection-api`, `09-canvas-runtime-binding-result-workbench`.

## Decision

Workflow I/O should be modeled as typed runtime envelopes on the same WorkflowProject run axis, not as a separate webhook or adapter side path.

The canonical spine is:

1. A trigger produces a `WorkflowRunRequest`.
2. The backend validates and compiles the Canvas-authored `WorkflowProject`.
3. The run service creates a `workflow_run_id` and dispatches compiled runtime nodes.
4. Node execution emits replayable node events.
5. Large outputs are stored as batch/projection references.
6. Canvas, AI callers, and optional webhook responders read the same event stream and projection APIs.

## Runtime Input

Runtime input is a small envelope:

```json
{
  "workflowProject": {},
  "trigger": {
    "kind": "manual|ai|schedule|webhook",
    "triggerNodeId": "node-id",
    "requestId": "external-or-generated-id",
    "idempotencyKey": "stable-key"
  },
  "input": {
    "payload": {},
    "headers": {},
    "query": {},
    "source": "operator|agent|external"
  },
  "responseMode": "async|sync-short-wait|callback"
}
```

This becomes a runtime resource, not arbitrary node params. Trigger/input nodes can expose a typed output port such as `httpRequest`, `manualPayload`, or `runInput`, and downstream nodes consume the typed value through the compiled graph.

## Runtime Output

Runtime output has two layers:

- Hot path: node run events for status, progress, blocked reasons, and batch-ready references.
- Read path: projection APIs for `EvidenceBatch`, source coverage, missing sources, clusters, conflicts, answer summaries, and node-linked artifacts.

Raw records should not be pushed through event streams or webhook responses. Events and webhooks carry counts, ids, manifest URLs, ODP refs, and projection links.

## Webhook Modes

There are three distinct webhook concepts:

1. Inbound trigger: `primitive.ops.trigger-webhook` / `primitive.core.webhook-trigger`.
   It verifies token or HMAC, normalizes the HTTP request into `WorkflowRunRequest`, then starts a workflow run.

2. Outbound action: `primitive.ops.action-webhook` / `intelligence.output.webhook`.
   It sends a signed summary payload to an external URL after selected node/projection states are ready.

3. Respond-to-webhook: `primitive.core.respond-webhook`.
   It is only valid when the run was started by an inbound webhook and can return a short-wait projection summary. If the run exceeds the short wait, return `202` with `workflow_run_id` and projection/event URLs.

## HDA and Large Node Linkage

Large nodes are package contracts, not direct backend executors.

They link to the rest of the system through:

- public params exposed on the package node,
- typed input/output ports,
- runtime resource declarations,
- `sourceAnchor` and `runArtifact`,
- batch/projection refs,
- node event addressing with outer package id plus optional internal node id.

Compiled internals remain small executable nodes. The outer HDA node is the visible runtime anchor; internal nodes add trace precision without replacing the Canvas spine.

For Multi Source OpenCLI HDA, the source-slot fanout remains the first executable proof:

- package node receives declarative `params.sources` and source/query intent only,
- source-slot materialization derives OpenCLI `site`, `command`, and safe `args` from existing catalog/adapter metadata,
- runtime resource resolution owns `concurrency`, `workerPool`, profile/session selection, and cookie-bearing browser state,
- compiled source slots dispatch through III `collector-opencli`,
- each dispatch carries workflow run id, package node id, internal node id, source group, adapter task id, and trace id,
- ODP ingest remains the evidence fact path,
- projection APIs make the result inspectable by Canvas and AI.

Agents must not ask users to fill cookie values, concrete profile ids, worker ids, worker pools, or raw OpenCLI commands. If those resources cannot be resolved from configured source/adapter/runtime policy, the node should emit a structured blocked reason and remain inspectable on the same Canvas run axis.

## Execution Order

1. Finish `06-node-run-event-stream` with `WorkflowRunRequest`, run id, replayable node events, and late-read projection state.
2. Finish `07-evidencebatch-projection-api` so batch refs and result summaries are the stable output contract.
3. Wire `09-canvas-runtime-binding-result-workbench` to the event stream and projection APIs.
4. Add live webhook bindings after the event/projection spine exists.
5. Keep `08-browser-worker-profile-concurrency` as capacity scheduling work; it should enrich routing metadata, not define I/O semantics.

## Candidate Follow-Up Issue

`10-workflow-run-io-webhook-contract`

Acceptance criteria:

- Backend defines `WorkflowRunRequest`, trigger metadata, response mode, and idempotency key contracts.
- Inbound webhook endpoint verifies secret/token and starts a workflow run through the same run service as manual/AI starts.
- Outbound webhook action sends signed projection summaries, not raw records.
- Respond-to-webhook only works for inbound webhook runs and falls back to `202` with run/projection links on timeout.
- Tests cover manual, AI, inbound webhook, outbound webhook, idempotency, HMAC failure, and async fallback.
