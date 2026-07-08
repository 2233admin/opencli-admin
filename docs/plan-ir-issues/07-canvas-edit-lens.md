# 07 — Collection Canvas edit lens

Labels: ready-for-agent
Parent: docs/plan-ir-PRD.md (ADR-0008)

## What to build

The authoring experience on the Collection Canvas: a palette organized category →
node type → Preset chips with keyboard search (cmdk is already a dependency);
dragging or clicking places a Draft Source Node that renders visibly unmaterialized;
selecting any node opens an inspector panel (reusing the existing per-channel config
form components as inspector internals) where a draft node can be materialized into
a real Data Source; wiring nodes and saving persists the Plan through the issue-02
API; save-time validation errors render anchored on the offending node. Deleting a
source node only detaches it from the graph — never deletes the entity. ALL new UI
strings go through the existing i18n layer (t()) — the design-audit gap must not
recur (stories 1–6, 19, 24, 25).

## Acceptance criteria

- [ ] Palette: three-level organization with search; Preset chips come from the issue-06 endpoint, nothing hardcoded
- [ ] Drag/click places a Draft Source Node visually distinct from materialized nodes; draft nodes cannot run
- [ ] Inspector materializes a draft into a real Data Source (create) and edits existing source config (update) — forms live only in the inspector
- [ ] Save round-trips the graph via the Plans API; a saved Plan reloads onto the canvas identically
- [ ] 422 node-anchored validation errors render on the offending nodes
- [ ] Deleting a source node from the graph never deletes the Data Source entity
- [ ] Every new user-facing string uses t(); framework-free view-model logic (IR ↔ canvas projection, draft lifecycle, preset → param mapping) has node --test coverage

## Blocked by

- 02-plans-table-crud
- 06-preset-service
