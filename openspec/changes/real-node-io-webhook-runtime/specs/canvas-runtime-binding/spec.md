## ADDED Requirements

### Requirement: Canvas nodes are projected from real catalog contracts
Canvas SHALL render workflow nodes from backend catalog, contract, visual, template, and runtime projection data instead of hard-coded placeholder forms.

#### Scenario: Inspector shows selected node schema
- **WHEN** a user selects any node on Canvas
- **THEN** the inspector displays that node's own parameter schema, ports, contract, internals, run result, and trace sections.

#### Scenario: Unsupported node is explicit
- **WHEN** a projected node lacks a supported runtime contract
- **THEN** Canvas renders it as unsupported or blocked with the backend reason and MUST NOT fall back to schedule trigger fields.

### Requirement: Canvas supports real input and output attachment points
Canvas SHALL expose typed connection handles for need input, trigger input, webhook input, source output, normalized output, and EvidenceBatch result output.

#### Scenario: Need node connects to assembly
- **WHEN** a user adds or edits the demand input node
- **THEN** Canvas can connect its output to assembly/runtime nodes without hidden mock edges.

#### Scenario: EvidenceBatch output is visible
- **WHEN** a run produces EvidenceBatch records
- **THEN** Canvas exposes the output on the producing node and result workbench with the same run identifiers returned by the backend.

### Requirement: Mini and full node views share one contract
Canvas SHALL provide compact and full node render states from the same catalog/runtime contract so zoom level never changes node meaning.

#### Scenario: Node is zoomed out
- **WHEN** a user views the graph at mini scale
- **THEN** the node still shows identity, kind, status, and key ports from the real contract.

#### Scenario: Node is zoomed in
- **WHEN** a user opens the full card or inspector
- **THEN** the expanded view shows real params, internals, outputs, and trace data for the same node id.

### Requirement: Runtime patches drive node status
Canvas MUST apply backend run events as real patches to nodes, edges, result panes, and trace panes.

#### Scenario: Run status updates
- **WHEN** the backend emits queued, running, blocked, succeeded, failed, or result-ready events
- **THEN** Canvas updates the matching node and panels without relying on fixtures or synthetic local state.

#### Scenario: Blocked resource is shown
- **WHEN** a node is blocked by missing adapter resources
- **THEN** Canvas shows the structured missing-resource reason while keeping user-facing input focused on the demand, not cookie/profile/worker fields.
