## ADDED Requirements

### Requirement: Deployment PTT gates support claims
The system SHALL require deployment PTT evidence before any deployment or runtime
profile is called supported.

#### Scenario: Deployment profile passes
- **WHEN** D0 through D7 deployment gates pass or have approved scoped waivers
- **THEN** the profile may be promoted to supported with links to commands, API checks, traces, backup/restore evidence, and operator approval.

#### Scenario: Gate fails
- **WHEN** any required deployment gate fails
- **THEN** the profile remains dry-run, ptt-ready, experimental, or blocked and MUST NOT be called supported.

### Requirement: Deployment PTT uses real persisted state
Deployment PTT MUST use real services and persisted state for support promotion.

#### Scenario: Unit tests pass
- **WHEN** only unit tests or static checks pass
- **THEN** D0 may pass, but deployment support is not promoted until runtime, restart, persistence, backup/restore, and upgrade/rollback gates are satisfied.

#### Scenario: Restart persistence is verified
- **WHEN** services restart during PTT
- **THEN** the operator can still read previous workflow traces, evidence records, source catalog entries, browser profile policy, and Agent runtime inventory.

### Requirement: Deployment PTT links to product PTT
Product workflow PTT MUST reference deployment PTT when it depends on a real
Agent, NAS, Docker, or NetBird runtime path.

#### Scenario: Market Situation Monitor runs on a remote Agent
- **WHEN** Market Situation Monitor is promoted as a product workflow
- **THEN** its PTT evidence links to the deployment profile evidence proving the Agent/runtime path is supported.

