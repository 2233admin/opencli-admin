## ADDED Requirements

### Requirement: Runtime support is proved by executable conformance evidence
The backend SHALL treat workflow runtime compatibility as the combination of a
registry declaration, an executable workflow fixture, and an observed event
transcript from the public workflow-run event API.

#### Scenario: Happy path emits expected runtime evidence
- **WHEN** the canonical conformance workflow runs with deterministic source outputs and configured notification delivery
- **THEN** `/api/v1/workflows/runs/{runId}/events` contains expected transcript evidence for `workflow.source.fetch`, `workflow.transform.normalize`, `workflow.router.route`, `workflow.inbox.store`, and `workflow.notify.send`.

#### Scenario: Permission absence is blocked, not failed
- **WHEN** the canonical conformance workflow runs without fetch and notification permissions
- **THEN** the run remains `valid=true`, the projection status is `blocked`, and event block reasons include `fetch_permission_required` and `send_permission_required`.

#### Scenario: Unsupported runtime binding is explicit
- **WHEN** a conformance fixture includes an unsupported node through the normal compile/runtime path
- **THEN** the run remains `valid=true`, the projection status is `blocked`, and the unsupported node emits `missing_runtime_binding`.

### Requirement: Expected transcripts ignore volatile event fields
The conformance matcher SHALL compare stable event facts while ignoring volatile
fields such as run id, trace id, generated event id, timestamp, and sequence
numbers unless a case explicitly asserts ordering.

#### Scenario: Stable event facts match
- **WHEN** the matcher evaluates an expected event
- **THEN** it checks node id, event type, optional binding id, optional block reason code, message substring, event details subset, and block reason details subset.

### Requirement: Runtime passports are generated artifacts
The backend SHALL write generated `opencli-runtime-passport.json` files only
under a caller-provided artifact directory.

#### Scenario: Passport is artifact-scoped
- **WHEN** the conformance harness writes a runtime passport
- **THEN** the file is created under the provided artifact directory and not at the repository root.

### Requirement: Later conformance groups remain out of the first slice
The first backend conformance slice SHALL NOT claim config-blocked, SSE stream,
or ODP/Redis-stream certification.

#### Scenario: Later groups are documented as follow-up
- **WHEN** first-slice evidence is generated
- **THEN** the runtime passport status remains `partial` until later fixture groups are implemented.
