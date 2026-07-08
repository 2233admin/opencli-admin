# Workflow Runtime Conformance

This backend conformance slice turns live workflow support into executable
evidence. Runtime compatibility is treated as the triple of registry
declaration, executable fixture, and observed transcript from
`/api/v1/workflows/runs/{runId}/events`.

## Current Slice

Ordered conformance ladder:

`block reason taxonomy -> config-blocked fixtures -> SSE parity -> ODP/Redis event mirror -> real node I/O contracts -> webhook real delivery`

- Event source: workflow-run event snapshot API, plus SSE parity smoke for
  `/api/v1/workflows/runs/{runId}/events/stream`.
- Fixture builder: `tests/fixtures/workflow_conformance.py`.
- Matcher and passport contracts: `backend/workflow/conformance/contracts.py`.
- ODP/Redis event mirror: `backend/workflow/event_mirror.py`, stream
  `odp.workflow_run.events` when `WORKFLOW_EVENT_MIRROR_BACKEND=redis`.
- Real node I/O contracts: `backend/workflow/runtime_contracts.py`; compile
  output and Canvas capability/status surfaces both project the same contract
  summary for supported runtime bindings.
- Webhook real delivery: `backend/workflow/webhook_delivery.py` sends through
  the registered webhook notifier when send permission, a configured URL, and
  upstream EvidenceBatch projection are all present.
- Expected transcripts: `backend/workflow/conformance/expected_events/`.
- Runtime passport artifact: caller-provided directory ending in
  `opencli-runtime-passport.json`; generated files are ignored under
  `.tmp/opencli-conformance/`.

Covered cases:

- `happy-path`: source outputs flow through normalize, router, inbox, and
  generic notify delivery projection.
- `permission-blocked`: missing fetch/send permissions produce stable blocked
  events, not compile failure.
- `missing-binding`: a schema-valid unsupported node reaches the runtime
  registry and emits `missing_runtime_binding`.
- `config-blocked`: missing webhook URL, source credential, and runtime
  resource preconditions remain `valid=true`, project `blocked`, and match
  stable block reason taxonomy entries. These fixtures prove blocked evidence
  only; they do not certify real webhook delivery.
- `sse-parity`: the canonical happy-path expected transcript is matched
  against both `/events` snapshot output and `/events/stream` `node_event`
  payloads.
- `odp-redis-mirror`: the canonical happy-path expected transcript is matched
  against workflow-run event records published through the Redis stream mirror
  interface. The fixture uses a fake Redis client at the boundary, and the
  production path uses Redis `XADD` when `WORKFLOW_EVENT_MIRROR_BACKEND=redis`.
- `real-node-io-contracts`: every declared runtime binding now has input
  shape, output shape, permission gate, config gate, event shape, and fixture
  coverage. Bindings missing that contract are converted to blocked runtime
  metadata instead of being exposed as runnable, and Canvas manifests only
  expose stable summaries.
- `webhook-real-delivery`: the webhook notifier performs a real POST through
  the registered notifier path under deterministic request capture. Missing
  send permission, missing URL, and missing EvidenceBatch/projection all remain
  stable blocked cases and do not send HTTP.

## Block Reason Taxonomy

Stable block reason codes live in `backend/workflow/block_reasons.py`.

Stable matcher inputs:

- `code`
- `source`
- selected `details.*` keys listed in the taxonomy definition
- conformance `blockReasonCategory`

Volatile diagnostics:

- generated event ids
- timestamps
- run/trace ids
- SSE transport framing and `run_state` events
- Redis stream entry ids
- environment-specific resource paths such as local MCP config paths
- free-text messages unless a fixture asserts a short substring

## Verification

Last verified on 2026-07-06:

```powershell
.\.venv\Scripts\python.exe -m ruff check backend\workflow\block_reasons.py backend\workflow\event_mirror.py backend\workflow\runtime_registry.py backend\workflow\opencli_hda_tracer.py backend\workflow\conformance\contracts.py backend\workflow\conformance\__init__.py tests\fixtures\workflow_conformance.py tests\integration\test_workflow_conformance.py
.\.venv\Scripts\python.exe -m ruff check backend\workflow\runtime_contracts.py backend\workflow\webhook_delivery.py backend\workflow\capability_projection.py tests\integration\test_workflow_capabilities_api.py
.\.venv\Scripts\python.exe -m pytest tests\integration\test_workflow_conformance.py -q --no-cov
.\.venv\Scripts\python.exe -m pytest tests\integration\test_workflow_capabilities_api.py -q --no-cov
.\.venv\Scripts\python.exe -m pytest tests\integration\test_workflow_opencli_hda_trace_api.py -q --no-cov
.\.venv\Scripts\python.exe -m pytest tests\integration\test_workflow_turbopush_publish_api.py -q --no-cov
openspec validate runtime-conformance-next-granularity --strict
openspec validate workflow-runtime-conformance --strict
pwsh -NoLogo -NoProfile -File C:\c\Users\Administrator\projects\code-intel-pipeline\check-code-intel-tools.ps1 -RepoPath C:\c\Users\Administrator\projects\opencli-admin-backend -Json
pwsh -NoLogo -NoProfile -File C:\c\Users\Administrator\projects\code-intel-pipeline\Invoke-SentruxAgentTool.ps1 check_rules C:\c\Users\Administrator\projects\opencli-admin-backend
pwsh -NoLogo -NoProfile -File C:\c\Users\Administrator\projects\code-intel-pipeline\Invoke-SentruxAgentTool.ps1 test_gaps C:\c\Users\Administrator\projects\opencli-admin-backend
pwsh -NoLogo -NoProfile -File C:\c\Users\Administrator\projects\code-intel-pipeline\invoke-code-intel.ps1 -RepoPath C:\c\Users\Administrator\projects\opencli-admin-backend -Mode normal
```

Focused backend tests, ruff check, and OpenSpec passed:
`test_workflow_conformance.py` reported 15 passed,
`test_workflow_capabilities_api.py` reported 5 passed,
`test_workflow_opencli_hda_trace_api.py` reported 15 passed, and
`test_workflow_turbopush_publish_api.py` reported 6 passed. Code Intel normal
mode produced artifacts under
`C:\Users\Administrator\AppData\Local\code-intel\artifacts\opencli-admin-backend\20260706-220352`;
it reported 6 passed steps, 1 skipped step (`node lint hygiene`), and failed
only at `sentrux gate`.

The Sentrux failure category was `sentrux_fail=1`; `provider_quota`,
`local_tool_error`, and `graph_missing` were all zero. `check_rules` passed.
The reported Sentrux hotspot was `frontend/lib/flow/store.ts`
(`useFlowStore`, cc=124), outside this backend conformance slice.
