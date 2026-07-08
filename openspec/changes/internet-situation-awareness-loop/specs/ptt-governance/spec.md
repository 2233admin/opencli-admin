## ADDED Requirements

### Requirement: New product capabilities require PTT approval
The system SHALL require proposal, test evidence, and operator approval before
new source families, runtime profiles, workflow templates, or external
framework integrations become supported product capabilities.

#### Scenario: New idea is proposed
- **WHEN** a new framework, source, runtime, or workflow idea is introduced
- **THEN** it starts in proposed state with scope, non-goals, expected evidence, smoke/PTT commands, and promotion criteria.

#### Scenario: PTT passes
- **WHEN** all required smoke/PTT checks pass and the operator approves the evidence
- **THEN** the capability may be promoted to supported and exposed in the normal product path.

#### Scenario: PTT fails or is incomplete
- **WHEN** any required check fails, is skipped without accepted reason, or lacks evidence
- **THEN** the capability remains experimental or blocked and MUST NOT be described as supported.

### Requirement: PTT evidence is durable
The system MUST keep PTT evidence linked to the promoted capability.

#### Scenario: Capability is promoted
- **WHEN** a source/runtime/workflow is promoted from ptt-ready to supported
- **THEN** the system records the PTT run id, command/API checks, trace links, evidence artifacts, operator approval, approval timestamp, and known residual risks.

#### Scenario: Capability changes
- **WHEN** the adapter, runtime, source schema, auth/session mode, workflow, or deployment profile materially changes
- **THEN** the capability returns to ptt-ready or experimental until updated evidence is approved.

### Requirement: PTT has a closed-loop acceptance path
The first PTT candidate SHALL be Market Situation Monitor running through a real
Fleet/NAS Agent path.

#### Scenario: Market Situation Monitor is tested
- **WHEN** the PTT run starts
- **THEN** it verifies Agent online state, Fleet inventory capability, runtime dispatch, workflow run trace, evidence capture, normalization, and situation summary output.

#### Scenario: Runtime path is only local or mocked
- **WHEN** a run uses only local fixtures, mocked source data, or a developer-only runtime path
- **THEN** it may satisfy unit or dry-run checks but MUST NOT satisfy the real PTT gate.

