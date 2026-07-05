## ADDED Requirements

### Requirement: Durable state has an explicit layout
The system SHALL define durable paths or volumes for every state surface needed
by a real data-platform deployment.

#### Scenario: NAS profile is configured
- **WHEN** the NAS deployment profile is selected
- **THEN** database, credentials store, browser profiles, workflow bundles, raw artifacts, EvidenceBatch records, run events, audit logs, runtime logs, backups, and PTT evidence all have resolved durable locations.

#### Scenario: Local-only temporary path is used
- **WHEN** a supported profile points critical state at a temporary or container-only path
- **THEN** deployment PTT fails with a persistent-state blocked reason.

### Requirement: Backups cover platform state
Supported deployments MUST provide a backup and restore manifest for durable
state.

#### Scenario: Backup runs
- **WHEN** an operator runs the backup procedure
- **THEN** the manifest records database snapshot, workflow bundles, raw artifact root, evidence root, browser profile policy, config snapshot, image/tag, and restore instructions.

#### Scenario: Restore runs
- **WHEN** an operator restores to a clean profile
- **THEN** existing workflow run traces, evidence records, source catalog entries, and deployment profile metadata remain readable.

### Requirement: Secrets are not written into public evidence
The deployment PTT and backup manifest MUST avoid leaking raw setup keys,
API tokens, cookies, and credentials.

#### Scenario: PTT evidence is recorded
- **WHEN** deployment PTT stores logs, commands, or manifests
- **THEN** raw secrets are redacted or referenced by secret id and are not written into repo files.

