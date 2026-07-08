## ADDED Requirements

### Requirement: Collection outputs become evidence
The system SHALL store collected internet messages as evidence records with
provenance before downstream analysis or situation summaries can depend on them.

#### Scenario: Collection succeeds
- **WHEN** a workflow collects real internet messages
- **THEN** each evidence record includes source capability id, source item id or stable digest, collected_at, collector Agent, runtime, workflow id, run id, node id, raw payload or artifact link, and normalized schema version.

#### Scenario: Collection fails
- **WHEN** a collection step fails, times out, or is blocked
- **THEN** the run trace records the typed failure reason and no downstream situation summary is promoted as successful.

### Requirement: Situation outputs cite evidence
The system MUST link every generated event, entity, topic, timeline entry,
confidence score, impact score, alert, and summary back to evidence records and
workflow trace.

#### Scenario: Summary is generated
- **WHEN** the system creates a situation summary
- **THEN** the summary includes evidence references, run id, generated_at, confidence, uncertainty notes, and the source/time range it covers.

#### Scenario: Evidence is missing
- **WHEN** an analysis step produces a claim without evidence references
- **THEN** the output is marked invalid or draft and cannot be promoted as a supported situation result.

### Requirement: Evidence projection is idempotent
The system SHALL preserve stable evidence ids when workflow run events are
replayed, refetched, or reprocessed.

#### Scenario: Same raw item is processed twice
- **WHEN** the same source item or raw artifact digest is seen again in the same run
- **THEN** projection updates or reuses the existing evidence record instead of creating a duplicate.

#### Scenario: Same topic appears across sources
- **WHEN** multiple sources mention the same external event
- **THEN** entity/event normalization may link them into one situation event while preserving separate evidence records for each source item.

### Requirement: Operator can inspect the full chain
The system SHALL provide an operator-facing way to inspect raw item, normalized
evidence, event/entity extraction, situation summary, workflow trace, Agent node,
runtime profile, and PTT approval state.

#### Scenario: Operator reviews an alert
- **WHEN** an operator opens an alert or situation summary
- **THEN** they can navigate to the underlying evidence, raw artifact, collection source, workflow run trace, and Agent/runtime details.

