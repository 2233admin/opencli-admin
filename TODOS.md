# TODOs

## Workflow Runtime Conformance

### Maintain config-blocked conformance cases

- **Status:** First taxonomy-backed fixtures are implemented for missing webhook URL, missing source credential, and missing runtime resource.
- **What:** Keep `config-blocked` conformance cases current as new runtime bindings add config, credential, or resource gates.
- **Why:** The first conformance slice covers happy path, permission-blocked, and missing-binding evidence; config absence is a separate failure class that open-source users must be able to diagnose without guessing.
- **Pros:** Extends the drift gate beyond permissions and missing bindings, and makes live/preview/simulated claims harder to overstate.
- **Cons:** New bindings must register stable reason taxonomy entries before tests can assert exact failures without churn.
- **Context:** `Administrator-codex-opinion-monitor-quickstart-design-20260706-182303.md` defines runtime truth as registry declaration plus executable fixture plus observed event transcript. Config-blocked cases were intentionally deferred from the first PR-sized slice to keep the initial harness small.
- **Depends on / blocked by:** Future binding-specific config gates and their stable block reason definitions.

### Maintain SSE event stream smoke coverage

- **Status:** Canonical happy-path `/events/stream` smoke coverage now reuses the snapshot expected transcript matcher.
- **What:** Keep `/api/v1/workflows/runs/{runId}/events/stream` smoke coverage aligned with the snapshot-based conformance matcher as event shapes evolve.
- **Why:** The conformance matcher should use the deterministic `/events` snapshot as its primary evidence source, but the live UI still depends on the stream endpoint.
- **Pros:** Protects the live event-stream user path without making the main conformance gate depend on polling windows or SSE timing.
- **Cons:** SSE tests are more timing-sensitive than snapshot tests and should stay out of the primary conformance matcher.
- **Context:** The `/plan-eng-review` decision for performance was to use `/events` snapshots for conformance evidence and reserve `/events/stream` for a later smoke test only.
- **Depends on / blocked by:** Future event shape changes must update both snapshot expected transcripts and SSE parser expectations.

### Maintain ODP/Redis-stream conformance after the interim harness

- **Status:** Workflow-run event mirror conformance now publishes stable event facts through the Redis stream interface and reads them back with the shared transcript matcher.
- **What:** Keep ODP/Redis-stream conformance cases current as the event mirror moves from fixture Redis clients to deployment Redis and later ODP consumers.
- **Why:** The first conformance slice certifies the current `/events` API, but the longer-term architecture makes ODP/event streams the runtime source of truth.
- **Pros:** Prevents the interim snapshot harness from becoming the permanent definition of runtime truth, and keeps the open-source conformance story aligned with the event-stream-first architecture.
- **Cons:** Expands scope into executor/source-of-truth migration and should wait until the transcript schema is stable.
- **Context:** The current design deliberately separates interim workflow-run event evidence from long-term ODP/Redis event-stream evidence.
- **Depends on / blocked by:** Deployment Redis/ODP consumer coverage.

### Maintain real node I/O contract coverage

- **Status:** Runtime bindings now declare stable input shape, output shape, permission gate, config gate, event shape, and fixture coverage through `backend/workflow/runtime_contracts.py`.
- **What:** Keep each new runtime binding in the contract table before exposing it as runnable in compile output or Canvas capability/status surfaces.
- **Why:** A binding is not runtime-certified just because compile can produce a node or the UI can place it on the Canvas; it needs a stable I/O contract first.
- **Pros:** Prevents runnable/status drift and keeps resource internals out of user-entered fields.
- **Cons:** New runtime bindings must update both the contract table and focused fixture coverage before they can honestly appear runnable.
- **Context:** The contract is projected into both registry metadata and capability manifests; webhook delivery now has its own deterministic request-capture fixture.
- **Depends on / blocked by:** Future runtime bindings must add contract declarations and fixture evidence before being exposed as runnable.

### Maintain webhook real delivery fixtures

- **Status:** `workflow.notifier.webhook.send` now sends through the registered webhook notifier when send permission, configured URL, and upstream EvidenceBatch projection are present.
- **What:** Keep the success request-capture fixture and negative missing-permission, missing-URL, and missing-projection fixtures aligned with the delivery payload.
- **Why:** Webhook delivery is the final runtime layer; regressions here would silently turn real delivery back into a projection-only claim.
- **Pros:** Confirms actual POST construction while keeping SSRF-safe notifier plumbing and blocked preconditions visible.
- **Cons:** Payload schema changes must update both request-capture assertions and expected transcript evidence.
- **Context:** Capability/status surfaces remain blocked by default because each run still needs user configuration and upstream projection input, but the backend delivery path is now executable.
- **Depends on / blocked by:** Future webhook payload schema or notifier security changes.

## Consolidated follow-ups from completed goals

### Activate or remove model-provider failover

- **Status:** `ProviderResolver.resolve_with_fallback()` is implemented and tested but has no production caller.
- **What:** Either route one explicit provider role through the resolver or remove the unused failover surface.
- **Why:** Defaults and cooldown currently imply runtime failover that the application does not perform.

### Live-test the model-provider UI

- **Status:** Type checking, linting, and production build passed; create/edit/delete, sync, connection test, defaults ordering, and toast behavior were not exercised against a live backend.
- **What:** Run one focused full-stack acceptance pass and record or fix the observed result.
- **Why:** Compile-time checks do not validate mutation wiring or response handling.

### Expand Browser Act support only from real demand

- **Status:** 78 vendored packs exist, but only 2 have manifests; the interpreter does not URL-encode parameters or model arithmetic pagination.
- **What:** Add manifests and interpreter features when onboarding a concrete pack, starting with correct URL encoding for any URL-bound parameter.
- **Why:** Bulk-promising support for every vendored pack would overstate runtime capability; demand-led onboarding keeps each claim testable.

### Execute capability probes

- **Status:** Capability manifests expose probe names, but the workflow capability layer does not execute richer runtime probes.
- **What:** Add probe execution when a concrete capability needs environment-level readiness evidence.
- **Why:** A declared probe name alone cannot prove that a capability is runnable in the current deployment.

### Add guarded production tool executors

- **Status:** `workflow.external-tool.capability` accepts only the deterministic fixture executor seam.
- **What:** Add a real executor adapter only when onboarding the first production external Tool Capability.
- **Why:** Imported tools should remain blocked until a guarded, observable executor exists; speculative adapters are unnecessary.
