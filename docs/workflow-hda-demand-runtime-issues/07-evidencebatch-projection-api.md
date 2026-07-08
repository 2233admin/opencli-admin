# 07 — EvidenceBatch and projection API

Labels: ready-for-agent, contract-hardened
Parent: docs/workflow-hda-demand-runtime-PRD.md

## What to build

Create the result-side projection APIs for EvidenceBatch, canonical evidence, clusters, conflicts, missing sources, source coverage, and answer summaries. Large collection outputs must be represented as batches and manifests, not as one frontend event per raw evidence item.

This slice should make the run useful to both frontend and AI consumers: they can ask what evidence arrived, which nodes produced it, which clusters changed, and what sources are still missing.

## Contract

Add read-only projection APIs on the workflow run axis. These APIs read persisted or replayable run/batch metadata; they do not dispatch workers and they do not stream raw records.

Minimum routes:

- `GET /api/v1/workflows/runs/{run_id}/evidence-batches`
  - Query: `node_id`, `source_group`, `cursor`, `limit`.
  - Response: `{ runId, batches: EvidenceBatchSummary[], nextCursor }`.
- `GET /api/v1/workflows/runs/{run_id}/evidence-batches/{batch_id}`
  - Response: `{ runId, batch, manifestUri, odpRef, recordCount, itemCount, sourceCoverage }`.
- `GET /api/v1/workflows/runs/{run_id}/projection`
  - Query: `node_id`, `source_group`, `include=clusters,missingSources,summaries,conflicts`.
  - Response: `{ runId, nodes, clusters, missingSources, summaries, conflicts, artifacts }`.

`EvidenceBatchSummary` must include `runId`, `nodeId`, `packageNodeId` when applicable, `internalNodeId` when applicable, `sourceGroup`, `adapterTaskId`, `traceId`, `batchId`, `manifestUri`, `odpRef`, `itemCount`, `recordCount`, and `status`.

Empty or partial runs are valid responses. Missing run id returns `404`; unauthorized access returns `403`; unsupported include values return `400`. Partial/failure state must be represented in `status` and `missingSources`, not by throwing away the projection.

## Acceptance criteria

- [ ] Projection API exposes evidence batches by workflow run and node/source.
- [ ] Projection API exposes cluster/result summaries with evidence references.
- [ ] Projection preserves links to workflow run id, node id, source group, adapter task, trace id, and batch id.
- [ ] Large results are surfaced by manifest/count/reference, not raw per-record event spam.
- [ ] Empty, partial, blocked, and failed runs return typed projection responses with `status` and `missingSources`.
- [ ] Tests cover list/detail/projection routes, batch projection, cluster projection, source coverage, missing sources, pagination, 400/403/404 cases, and AI-readable response shapes.

## Blocked by

- 05 — Multi Source OpenCLI HDA tracer
- 06 — Node run event stream
