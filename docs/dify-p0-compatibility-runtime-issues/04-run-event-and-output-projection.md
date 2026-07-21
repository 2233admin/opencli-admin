# P0-04: Project Graphon execution into OpenCLI run events

Labels: `p0`, `backend`, `runtime`, `events`, `dify`

Parent: `docs/dify-p0-compatibility-runtime-PRD.md`

Blocked by: P0-03

## Outcome

Execute the managed Dify package and persist its nested Graphon lifecycle and outputs through the existing OpenCLI run, trace and projection APIs.

## Files

Create:

- `backend/workflow/dify_event_adapter.py`
- `tests/integration/test_workflow_dify_run.py`
- `tests/integration/test_workflow_dify_event_replay.py`

Modify:

- `backend/workflow/opencli_hda_tracer.py:213-390,1240-1363,2130-2298`
- `backend/workflow/event_mirror.py`
- `backend/models/workflow_run.py:7-44`
- `backend/schemas/workflow.py:618-779,782-920`
- `backend/api/v1/workflows.py:227-590`
- `frontend/lib/workflow/runtime-bridge.ts:17-173`
- `frontend/lib/workflow/backend-runs.ts`

## Build

- Dispatch `workflow.compat.dify.graphon` through a dedicated executor branch.
- Resolve model credentials immediately before sidecar dispatch from existing `ModelProvider` configuration (`backend/models/provider.py:10-67`).
- Translate runtime events using the PRD table.
- Use `nodePath=[packageNodeId, difySourceNodeId]`.
- Deduplicate sidecar events by runtime run id and runtime sequence.
- Preserve strict OpenCLI event sequencing when mixed with package-level events.
- Emit package `started` before nested events and package `completed`/`blocked`/`failed` after the terminal graph event.
- Persist small final outputs in the package completion event details with a size-limited preview.
- Project record-like arrays to EvidenceBatch metadata only when they satisfy the record contract; do not label arbitrary LLM text as evidence.
- Map sidecar timeout/unavailable/malformed-event failures to stable block/failure reasons.
- Keep existing run replay and SSE endpoints as the only frontend/Agent consumption surface.

## Acceptance criteria

- [ ] The pure-logic fixture completes and emits package plus nested node events.
- [ ] Nested events use original Dify ids in `internalNodeId`.
- [ ] Runtime event sequences remain monotonic and replay returns the same projection.
- [ ] Replaying the same sidecar event page does not duplicate persisted events.
- [ ] Package terminal state reflects the graph terminal state.
- [ ] The LLM fixture completes when provider and Slim are configured; otherwise it blocks without mock output.
- [ ] The HTTP fixture respects allowed-domain policy.
- [ ] A sidecar timeout marks the package failed and leaves a structured reason.
- [ ] Credential values and full source DSL never appear in persisted event payloads.
- [ ] Existing OpenCLI HDA run and EvidenceBatch tests continue to pass.

## Verification

Run:

    uv run pytest tests/integration/test_workflow_dify_run.py tests/integration/test_workflow_dify_event_replay.py
    uv run pytest tests/integration/test_workflow_evidence_batches_api.py tests/integration/test_workflow_opencli_hda_trace_api.py tests/unit/test_workflow_node_paths.py
    npm --prefix frontend run check:workflow-regressions
