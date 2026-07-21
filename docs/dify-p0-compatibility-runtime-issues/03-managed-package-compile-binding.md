# P0-03: Compile Dify as one managed runtime package

Labels: `p0`, `backend`, `compiler`, `runtime`, `dify`

Parent: `docs/dify-p0-compatibility-runtime-PRD.md`

Blocked by: P0-02

## Outcome

Compile a Dify package into one Graphon runtime binding while preserving native HDA expansion and nested source attribution.

## Files

Modify:

- `backend/workflow/compiler.py:121-200,825-894,1228-1279`
- `backend/workflow/runtime_registry.py:36-53,85-150`
- `backend/workflow/runtime_contracts.py:1-240`
- `backend/workflow/block_reasons.py`
- `backend/workflow/capability_projection.py`
- `backend/schemas/workflow.py:287-370,685-779`
- `frontend/lib/workflow/backend-compile.ts:11-56`

Create:

- `backend/workflow/dify_runtime.py`
- `tests/integration/test_workflow_dify_compile.py`

## Build

- Add binding id `workflow.compat.dify.graphon`.
- Separate `has internals` from `native structural container`:
  - native HDA: structural and expanded;
  - Dify managed package: executable package and not expanded.
- Keep the imported internal graph in package metadata for inspection and Canvas rendering.
- Compile the outer package with the source digest, sidecar contract version, policy, inspection dependencies and source-node index.
- Add stable compile/runtime blocker mapping from the PRD.
- Resolve a Graphon runtime resource. Missing/unhealthy resource creates `dify_graphon_unavailable`.
- Resolve network/model/Slim/tool/sandbox preconditions without leaking credentials.
- Extend runtime I/O contract:
  - input: `runtimeInputEnvelope`;
  - output: `workflowOutput`;
  - optional record output: `items[]`.
- Expose the capability and backend availability through the existing `/workflows/capabilities` projection.
- Do not modify native HDA materialization in `backend/workflow/hda_templates.py:25-69`.

## Acceptance criteria

- [ ] Compiling the pure-logic fixture yields exactly one executable Dify runtime node plus any unrelated root nodes.
- [ ] Imported internal nodes do not receive native runtime bindings.
- [ ] Package metadata still contains the source-node index and locked internal graph.
- [ ] A native Multi Source OpenCLI HDA still expands to its internal compiled nodes.
- [ ] Missing sidecar returns `dify_graphon_unavailable`.
- [ ] HTTP without permission returns `dify_network_permission_required`.
- [ ] Code without sandbox returns `dify_sandbox_required`.
- [ ] LLM without provider/Slim returns the exact required blockers.
- [ ] Source content and secret grants are absent from compile response serialization.

## Verification

Run:

    uv run pytest tests/integration/test_workflow_dify_compile.py tests/integration/test_workflow_compile_api.py tests/integration/test_workflow_conformance.py
    uv run ruff check backend/workflow backend/schemas tests/integration/test_workflow_dify_compile.py
    uv run mypy backend/workflow/dify_runtime.py backend/workflow/dify_graphon_client.py
