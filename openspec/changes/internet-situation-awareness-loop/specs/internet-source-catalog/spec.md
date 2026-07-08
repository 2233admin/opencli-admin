## ADDED Requirements

### Requirement: Source support is cataloged before use
The system SHALL represent every internet source family, site, API, RSS feed,
browser source, OpenCLI adapter, and OpenTabs tool family as a source capability
record before treating it as supported.

#### Scenario: Proposed source is visible but not runnable
- **WHEN** a new source family is proposed
- **THEN** the catalog records its name, type, owner, support state, required auth/session mode, expected schema, rate-limit policy, legal/technical boundary, and blocked reasons.
- **AND** the source is not shown as supported or runnable until PTT evidence is approved.

#### Scenario: Supported source has acceptance evidence
- **WHEN** a source capability is marked supported
- **THEN** it has a normalized output schema, freshness policy, failure-mode notes, smoke or PTT evidence links, and at least one approved runtime path.

### Requirement: Source resolution hides infrastructure internals
The system MUST resolve cookies, browser sessions, profile ids, raw OpenCLI
commands, worker pools, and runtime node choices from catalog and runtime
metadata instead of asking the operator to type those values into a workflow.

#### Scenario: Resource exists
- **WHEN** an approved source is used in a workflow
- **THEN** runtime resolution attaches the required adapter, auth/session, worker, and runtime references without exposing raw cookie/profile/command fields as user inputs.

#### Scenario: Resource is missing
- **WHEN** required auth/session, worker, runtime, or command metadata is missing
- **THEN** the source run is blocked with a structured reason and MUST NOT be reported as a successful collection.

### Requirement: Capability inventory includes runtime reachability
The source catalog SHALL distinguish source capability from runtime reachability
so an adapter can exist while no current Agent can run it.

#### Scenario: Adapter exists but no node can run it
- **WHEN** a source requires a runtime not advertised by any online Agent
- **THEN** Fleet match returns a missing-runtime or missing-node blocked reason and the catalog keeps the source out of supported runnable state.

#### Scenario: Node can run the source
- **WHEN** an online Agent advertises the required runtime and source/session resources are present
- **THEN** Fleet inventory exposes the source/runtime capability pair as eligible for PTT or supported execution.

