## 1. Contract

- [x] 1.1 Define the workflow runtime conformance OpenSpec capability.
- [x] 1.2 Specify the first-slice event source, fixture expectations, and runtime passport.
- [x] 1.3 Mark config-blocked, SSE, and ODP/Redis stream conformance as later fixture groups.

## 2. Backend Harness

- [x] 2.1 Add canonical workflow conformance fixture builders.
- [x] 2.2 Add expected event transcript schemas and matcher.
- [x] 2.3 Add expected transcript golden files for happy, permission-blocked, and missing-binding cases.
- [x] 2.4 Add runtime passport artifact writer scoped to caller-provided output directories.

## 3. Verification

- [x] 3.1 Add integration tests for the first conformance slice.
- [x] 3.2 Run `.\.venv\Scripts\python.exe -m pytest tests\integration\test_workflow_conformance.py -q --no-cov`.
- [x] 3.3 Run `openspec validate workflow-runtime-conformance --strict`.
- [x] 3.4 Re-run code-intel/Sentrux checks and record the existing frontend hotspot as baseline debt.
