# P0-02: Move Dify import and inspection behind the backend

Labels: `p0`, `backend`, `frontend`, `workflow`, `dify`

Parent: `docs/dify-p0-compatibility-runtime-PRD.md`

Blocked by: P0-01

## Outcome

Make Dify import reproducible and runtime-aware. The backend owns canonical source hashing and Graphon inspection; the browser remains a file picker and Canvas projection client.

## Files

Create:

- `backend/workflow/dify_importer.py`
- `backend/workflow/dify_graphon_client.py`
- `backend/schemas/dify_compat.py`
- `tests/fixtures/dify/pure_logic.yml`
- `tests/fixtures/dify/http_request.yml`
- `tests/fixtures/dify/llm_answer.yml`
- `tests/fixtures/dify/code_blocked.yml`
- `tests/integration/test_workflow_dify_import_api.py`
- `frontend/lib/workflow/backend-dify-import.ts`
- `frontend/app/api/workflow/import/dify/route.ts`

Modify:

- `backend/api/v1/workflows.py:213-225`
- `backend/schemas/workflow.py:219-356`
- `frontend/lib/workflow/codec.ts:1-55`
- `frontend/lib/workflow/dify-translator.ts:42-127`
- `frontend/lib/workflow/io.ts:26-38`
- `frontend/scripts/check-workflow-regressions.mjs:746-779`

## Build

- Add `POST /api/v1/workflows/import/dify`.
- Parse JSON/YAML server-side.
- Accept only Dify app DSL modes `workflow` and `advanced-chat`.
- Canonicalize the parsed payload, compute SHA-256 and enforce a 1 MiB source limit.
- Build the same `WorkflowProject` shape currently expected by Canvas, but add versioned managed-runtime source metadata:

    {
      "packageExecution": "managed",
      "compatRuntime": {
        "engine": "graphon",
        "contractVersion": "opencli.graphon.compat.v1",
        "sourceFormat": "dify-app-dsl",
        "sourceSha256": "...",
        "sourceContent": "...",
        "engineVersion": "0.7.0",
        "engineCommit": "..."
      }
    }

- Preserve original Dify node ids as internal ids. Do not slug them for event identity; use display slugs only where UI needs them.
- Lock imported internals by default.
- Include Graphon inspection and blocker details in the translation report.
- Remove mock/fixture claims from imported nodes. Unknown nodes must be explicit blockers.
- Keep the existing client translator only as a backward-compatible fallback until the new endpoint is wired; mark its result non-executable.
- Ensure source content is excluded from ordinary debug logging and event details.

## Acceptance criteria

- [ ] The pure-logic fixture returns one managed package and a `ready` inspection.
- [ ] Original Dify source node ids survive import and a save/load round trip.
- [ ] The source digest is stable across YAML formatting differences that parse to the same canonical object.
- [ ] Payloads over 1 MiB return `413` with `dify_source_too_large`.
- [ ] Unsupported app modes return `422` with `dify_app_mode_unsupported`.
- [ ] Unknown node types appear in `blockers`; they are not converted to generic action/send nodes.
- [ ] The returned project passes both frontend and backend `WorkflowProject` validation.
- [ ] No model key, authorization header or ephemeral grant value is present in the project JSON or import report.
- [ ] Existing canonical and n8n import behavior is unchanged.

## Verification

Run:

    uv run pytest tests/integration/test_workflow_dify_import_api.py
    npm --prefix frontend run check:workflow-regressions
