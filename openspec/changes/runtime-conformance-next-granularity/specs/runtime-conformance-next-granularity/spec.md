## ADDED Requirements

### Requirement: Next runtime conformance is layered
The project SHALL complete workflow runtime conformance through separately
verifiable layers rather than a single broad runtime-support claim.

#### Scenario: Layers are ordered
- **WHEN** planning work after the first backend conformance slice
- **THEN** the acceptance order is block reason taxonomy, config-blocked fixtures, SSE parity with `/events` snapshot, ODP/Redis event mirror, real node I/O contracts, and webhook real delivery.

#### Scenario: First slice remains partial
- **WHEN** only the current `/events` snapshot conformance slice has passed
- **THEN** generated runtime passports remain `partial` and SHALL NOT claim config-blocked, SSE, ODP/Redis, real node I/O, or real webhook delivery certification.

### Requirement: Config absence is blocked, not failed
The backend SHALL expose missing runtime configuration as stable blocked
evidence instead of failed runs or silent skips.

#### Scenario: Missing webhook URL blocks delivery
- **WHEN** `workflow.notifier.webhook.send` is selected without a configured webhook URL
- **THEN** the run remains `valid=true`, projection status is `blocked`, and the event transcript includes a stable block reason code for missing webhook configuration.

#### Scenario: Missing source credential blocks fetch
- **WHEN** a source/fetch binding requires a credential that is absent
- **THEN** the run remains `valid=true`, projection status is `blocked`, and the event transcript includes a stable block reason code for missing source credential.

#### Scenario: Missing runtime resource blocks execution
- **WHEN** a runtime-backed node requires a resource that cannot be resolved
- **THEN** the run remains `valid=true`, projection status is `blocked`, and the event transcript includes a stable block reason code for missing runtime resource.

### Requirement: SSE stream matches snapshot semantics
The workflow event stream SHALL carry the same stable event facts as the
existing `/api/v1/workflows/runs/{runId}/events` snapshot API.

#### Scenario: Snapshot and stream share a matcher
- **WHEN** a conformance run is observed through both `/events` and `/events/stream`
- **THEN** the same expected transcript matcher can validate node id, event type, binding id, block reason code, message substring, event details subset, and block reason details subset from both sources.

#### Scenario: Volatile stream fields are ignored
- **WHEN** stream event ids, timestamps, sequence numbers, or transport framing differ from snapshot output
- **THEN** the matcher ignores those volatile fields unless a fixture explicitly asserts ordering.

### Requirement: ODP and Redis mirror runtime event evidence
Workflow-run event evidence SHALL be available from the ODP/Redis event stream
after the event transport layer is enabled.

#### Scenario: Redis stream mirrors stable event facts
- **WHEN** a canonical conformance run emits workflow events
- **THEN** Redis/ODP stream output contains the same stable event facts required by the expected transcript.

#### Scenario: Stream mirror does not replace public API evidence
- **WHEN** ODP/Redis stream evidence is generated
- **THEN** `/events` snapshot evidence remains available and both sources can be compared against the same expected transcript.

### Requirement: Supported runtime bindings declare real node I/O
Every binding marked runnable SHALL have an explicit runtime I/O contract.

#### Scenario: Runnable binding has complete contract
- **WHEN** a runtime binding is marked runnable
- **THEN** it declares input shape, output shape, permission gate, config gate, event shape, and fixture coverage.

#### Scenario: Incomplete binding is not runnable
- **WHEN** a binding lacks input shape, output shape, permission gate, config gate, event shape, or fixture coverage
- **THEN** Canvas and backend capability surfaces expose it as blocked, preview-only, or design-only rather than runnable.

#### Scenario: Contract truth is projected without resource internals
- **WHEN** Canvas capability/status surfaces expose a runtime binding
- **THEN** they include the stable node I/O contract summary and do not expose secret values, service URLs, or runtime resource internals as user-entered fields.

### Requirement: Webhook delivery becomes real only when all gates pass
`workflow.notifier.webhook.send` SHALL perform real HTTP delivery only when its
permission, configuration, and resource projection gates are satisfied.

#### Scenario: Webhook sends real HTTP request
- **WHEN** send permission is granted, webhook URL is configured, and EvidenceBatch/resource projection is available
- **THEN** the node performs deterministic HTTP delivery and emits stable delivery evidence in the run transcript.

#### Scenario: Webhook preconditions block explicitly
- **WHEN** send permission, webhook URL, or EvidenceBatch/resource projection is missing
- **THEN** the node does not send HTTP and emits stable blocked evidence for the unmet precondition.
