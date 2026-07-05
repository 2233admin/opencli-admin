## ADDED Requirements

### Requirement: Deployment profiles declare support boundaries
The system SHALL represent each deployable shape as a deployment profile with
install commands, required environment, persistent paths, health checks, logs,
backup coverage, runtime support, and support state.

#### Scenario: Profile is proposed
- **WHEN** a deployment profile is introduced
- **THEN** it starts as proposed or dry-run and records its target environment, install command, expected services, required secrets, persistent paths, and blocked reasons.

#### Scenario: Profile is supported
- **WHEN** a deployment profile is marked supported
- **THEN** it has passed deployment PTT, has evidence links, and documents restart, backup, restore, upgrade, and rollback behavior.

### Requirement: Supported profiles survive restart
Supported deployment profiles MUST preserve configured state and collected data
across service/container restarts.

#### Scenario: Services restart
- **WHEN** the center, worker, beat, Agent, or NAS host restarts
- **THEN** database records, source catalog, credentials references, browser profiles, workflow bundles, evidence records, run events, and audit artifacts remain readable.

#### Scenario: State path is missing
- **WHEN** a required persistent path or volume is absent
- **THEN** deployment preflight blocks promotion and reports the missing path instead of starting as supported.

### Requirement: Deployment status is observable
The system SHALL expose enough deployment status for an operator to diagnose a
running profile.

#### Scenario: Operator checks deployment
- **WHEN** an operator opens node/system status
- **THEN** they can see deployment profile, deploy type, image/tag or package version, service health, runtime inventory, last heartbeat, current task, failure count, and log tail availability.

