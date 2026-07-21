# P0-06: Wire the plugin center, Studio and end-to-end acceptance

Labels: `p0`, `frontend`, `plugins`, `studio`, `qa`

Parent: `docs/dify-p0-compatibility-runtime-PRD.md`

Blocked by: P0-04, P0-05

## Outcome

Expose the two P0 capabilities through the current product surfaces: Dify workflow import in Studio and honest installed/runtime state in the plugin center.

## Files

Create:

- `frontend/lib/plugins/backend-plugin-catalog.ts`
- `frontend/components/plugins/dify-package-import-dialog.tsx`
- `frontend/scripts/check-dify-p0-regressions.mjs`
- `docs/acceptance/dify-p0-runbook.md`

Modify:

- `frontend/app/(app)/plugins/page.tsx:41-54,326-516`
- `frontend/lib/plugins/provider-catalog.ts:22-39`
- `frontend/lib/workflow/node-catalog.ts`
- `frontend/components/flow/command-palette.tsx`
- Studio import component(s) that currently call `frontend/lib/workflow/io.ts:26-38`
- `frontend/lib/workflow/runtime-bridge.ts:17-173`
- `frontend/package.json:5-15`

## Build

- Load installed providers and marketplace placeholders from the backend registry.
- Keep a small frontend fallback catalog only for backend-unavailable rendering; label it unavailable and do not call it installed.
- Add local Dify manifest/`.difypkg` import.
- Show version, author, capability families, permissions, signature state, runtime state and blockers in provider details.
- Add a Studio Dify DSL import path using the backend endpoint.
- Show the imported package as one expandable managed node.
- Show compile blockers before Run.
- During a run, update nested node status from existing run events.
- Add projected locked node definitions to Studio search/palette with provider/version provenance.
- Never load plugin-owned JavaScript, routes or navigation.
- Write a deterministic acceptance runbook with expected API payload fields and screenshots to capture.

## Acceptance criteria

- [ ] The plugin center’s installed tab is backed by `GET /api/v1/plugins`.
- [ ] Backend unavailable state does not falsely label frontend constants as installed.
- [ ] A `.difypkg` can be imported and its blocked capabilities are understandable without opening developer tools.
- [ ] Studio imports the pure-logic fixture and shows one expandable Dify package.
- [ ] Compile shows structured blockers for LLM, HTTP, code and tool cases.
- [ ] Running the pure-logic fixture updates nested nodes and ends completed.
- [ ] A configured LLM fixture either returns its real answer or an exact actionable blocker.
- [ ] Refreshing the run page rebuilds identical nested states from persisted events.
- [ ] Plugin capability entries are searchable in Studio and remain locked.
- [ ] Keyboard navigation, visible focus, empty/loading/error states and Chinese labels follow the current design system.
- [ ] No Dify application frontend code or plugin-owned UI is bundled.

## Verification

Run:

    npm --prefix frontend run check:workflow-regressions
    npm --prefix frontend run check:control-plane
    npm --prefix frontend run lint
    npm --prefix frontend run build
    node --test frontend/scripts/check-dify-p0-regressions.mjs
    uv run pytest tests/integration/test_workflow_dify_import_api.py tests/integration/test_workflow_dify_compile.py tests/integration/test_workflow_dify_run.py tests/integration/test_plugin_dify_import_api.py

Then execute `docs/acceptance/dify-p0-runbook.md` against Docker Compose and record the run id, event count, nested node states, output artifact/reference and installed plugin id.

Local-process evidence: `docs/acceptance/dify-p0-local-e2e-2026-07-21.md`. The record explicitly keeps Docker Compose and screenshot capture open because the local Docker daemon was unavailable during this acceptance run.
