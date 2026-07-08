## ADDED Requirements

### Requirement: User demand is a first-class runtime input
The system SHALL model the user's collection need as a real input node whose output feeds assembly, compile, and runtime execution without requiring the user to choose low-level node strategy.

#### Scenario: Need text enters assembly
- **WHEN** a user enters a demand such as "抓小红书热帖" on Canvas
- **THEN** the workflow graph contains a typed need/input node with stable node id, output port, locale, and demand text available to downstream assembly.

#### Scenario: Need text is not treated as adapter configuration
- **WHEN** the demand is compiled into source, trigger, transform, and projection nodes
- **THEN** cookie, profile, raw OpenCLI command, and worker policy fields are absent from user-editable demand params.

### Requirement: Adapter resources are resolved implicitly
The runtime MUST resolve adapter, source, cookie, browser profile, worker pool, concurrency, and OpenCLI command details from catalog, adapter registry, or runtime resource metadata.

#### Scenario: Resource exists
- **WHEN** a source slot references a supported site or adapter capability
- **THEN** the compiled runtime node contains the resolved adapter contract and resource references required to run the OpenCLI source.

#### Scenario: Resource is missing
- **WHEN** an adapter, session, profile, cookie, worker pool, or command cannot be resolved
- **THEN** the node is marked blocked with a structured missing-resource reason and MUST NOT be reported as runnable.

### Requirement: Webhook ingress is a real node input
The system SHALL expose webhook-triggered workflow input as a typed runtime input that can be linked to downstream nodes and traced by workflow id, run id, node id, and source id.

#### Scenario: Webhook starts a run
- **WHEN** a webhook payload is accepted for a workflow
- **THEN** the runtime creates node run events for the webhook input and downstream nodes using the same identifiers Canvas uses.

#### Scenario: Webhook payload fails validation
- **WHEN** a webhook payload is malformed or references an unsupported node contract
- **THEN** the runtime returns node-anchored validation errors and does not dispatch worker execution.

### Requirement: EvidenceBatch is the normalized output contract
The runtime SHALL project successful source, transform, and normalize results into EvidenceBatch output records keyed by workflow id, run id, node id, and source id.

#### Scenario: Source output is projected
- **WHEN** an OpenCLI source slot completes with crawl or extraction data
- **THEN** the projection API returns normalized EvidenceBatch records linked to the originating source slot and downstream normalize node.

#### Scenario: Projection is idempotent
- **WHEN** the same run event is replayed or fetched more than once
- **THEN** the EvidenceBatch projection preserves stable ids and does not duplicate output records.

### Requirement: Node execution emits traceable run events
The runtime MUST emit node run events for queued, running, blocked, succeeded, failed, and result-ready states.

#### Scenario: Node status changes
- **WHEN** a node transitions between runtime states
- **THEN** the event stream includes the node id, status, timestamps, output summary, and any structured blocked or error reason.
