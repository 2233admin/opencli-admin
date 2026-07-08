## 1. Alignment Contract

- [x] 1.1 Define the five next-granularity conformance layers.
- [x] 1.2 Preserve the first conformance slice as partial until all later layers have evidence.
- [x] 1.3 Align with `real-node-io-webhook-runtime` without marking its runtime work complete.

## 2. Block Reason Taxonomy

- [x] 2.1 Define stable block reason codes for missing config, missing source credential, missing runtime resource, missing permission, and missing runtime binding.
- [x] 2.2 Document which block reason fields are stable matcher inputs and which fields are volatile diagnostics.
- [x] 2.3 Add matcher support for config/resource block reason details without depending on timestamps, generated ids, or environment-specific paths.

## 3. Config-Blocked Fixtures

- [x] 3.1 Add a missing `webhook_url` fixture for `workflow.notifier.webhook.send`.
- [x] 3.2 Add a missing source credential fixture for a source/fetch binding.
- [x] 3.3 Add a missing runtime resource fixture for a runtime-backed node.
- [x] 3.4 Verify each fixture remains `valid=true`, emits projection status `blocked`, and records stable `block_reason.code`.

## 4. SSE Events Stream

- [x] 4.1 Add `/api/v1/workflows/runs/{runId}/events/stream` smoke coverage for a canonical conformance run.
- [x] 4.2 Reuse the same expected transcript matcher for `/events` snapshot and `/events/stream` output.
- [x] 4.3 Document the volatile fields that differ between snapshot and stream events.

## 5. ODP/Redis Event Mirror

- [x] 5.1 Identify or add the workflow-run event publisher path for ODP/Redis.
- [x] 5.2 Add a fixture that reads the same stable event facts from Redis/ODP stream output.
- [x] 5.3 Verify Redis/ODP stream evidence aligns with the canonical expected transcript.

## 6. Real Node I/O Contracts

- [x] 6.1 Require every supported runtime binding to declare input shape, output shape, permission gate, config gate, event shape, and fixture coverage.
- [x] 6.2 Mark bindings without that contract as blocked or design-only rather than runnable.
- [x] 6.3 Project contract truth to Canvas capability/status surfaces without exposing resource internals as user-entered fields.

## 7. Webhook Real Delivery

- [x] 7.1 Connect EvidenceBatch/resource projection, send permission, and configured webhook URL for `workflow.notifier.webhook.send`.
- [x] 7.2 Add a real HTTP delivery fixture with deterministic request capture.
- [x] 7.3 Add negative fixtures for missing permission, missing URL, and missing EvidenceBatch/resource projection.
- [x] 7.4 Verify success emits real delivery evidence and all unmet preconditions emit stable blocked evidence.

## 8. Verification

- [x] 8.1 Run `openspec validate runtime-conformance-next-granularity --strict`.
- [x] 8.2 Run targeted pytest suites for each implemented layer as it lands.
- [x] 8.3 Run Code Intel Pipeline and Sentrux after implementation slices, recording any baseline debt separately from conformance evidence.
