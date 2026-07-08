# PRD: Plan IR & the Collection Canvas as Primary Authoring Surface

Status: ready-for-agent
Date: 2026-07-02
Grounding: ADR-0008 (Collection Canvas promotion), ADR-0009 (Plan IR: free graph,
two-tier attribution, backend-authoritative execution), CONTEXT.md Plan section.
Reference note: the React Flow Pro "Workflow Editor" template is a paid product —
its feature set and interaction shape are legitimate REFERENCE, its source is not
copyable. React Flow UI open components (BaseNode, NodeStatusIndicator, …) and
synergycodes/workflowbuilder (Apache-2.0) are the copy-permitted wheels.

## Problem Statement

An operator who wants to define what gets collected today edits per-channel JSON
config through modal forms. The canvas is a picture of the database, not a program:
dragging a node opens a form; the node workbench executes a toy graph in the browser
that the real collection pipeline never sees; three node representations (topology
view, per-source dive, workbench) disagree with each other. Configuring an opencli
source means walking raw site × command × format dropdowns over 200+ adapters.
Multi-source flows ("collect from 雪球 and 微博, merge, dedupe, summarize, store")
cannot be expressed at all — the operator must fake them with disconnected sources
and cannot see or control the shared downstream steps.

## Solution

The Collection Canvas becomes the place where collection logic is authored: the
graph IS the program. An operator drags source nodes (or one-click Presets like
"雪球·热帖"), wires them through transforms and merges into sinks, and saves a Plan.
The backend compiles and executes that Plan: source segments run through the
existing channel/runner machinery under the untouched per-source control loop;
shared segments run server-side with their own Plan Health observability. The
browser can still preview a graph on fixture data, explicitly labeled as a Dry-Run
Preview. Existing sources keep working untouched — each is the degenerate
single-node Plan.

## User Stories

1. As an operator, I want to drag a source type from the palette onto the Collection Canvas and get a Draft Source Node, so that I can sketch a collection flow before committing entities.
2. As an operator, I want a Draft Source Node to look visibly unmaterialized, so that I never mistake a sketch for a running source.
3. As an operator, I want to materialize a Draft Source Node into a real Data Source from its inspector panel, so that creation happens where I'm looking, not in a separate page.
4. As an operator, I want to pick a Preset (e.g. "雪球·热帖") instead of walking site/command/format dropdowns, so that standing up a common source takes one click.
5. As an operator, I want Presets searchable from the palette (keyboard-first), so that 200+ adapters don't become 200 chips.
6. As an operator, I want the advanced inspector to still expose raw channel parameters, so that Presets don't cap what's expressible.
7. As an operator, I want to wire two source nodes into a merge and downstream transforms, so that multi-source flows are one Plan instead of disconnected sources.
8. As an operator, I want to save a Plan and have the graph persist, so that my authored program survives reloads and is versioned.
9. As an operator, I want saving a Plan with unmaterialized Draft Source Nodes to be allowed but clearly marked draft, so that I can pause mid-authoring without losing work.
10. As an operator, I want a Plan whose source nodes are all materialized to be runnable end-to-end by the backend, so that what I drew is what actually executes.
11. As an operator, I want each source node to keep firing on its own schedule, so that a 5-minute RSS source and an hourly adapter source coexist in one Plan without lockstep.
12. As an operator, I want any upstream delivery to run the downstream shared segment incrementally with source-tagged provenance, so that merged data is traceable to its origin.
13. As an operator, I want a manual "run whole plan" action for debugging, so that I can exercise the full graph on demand.
14. As an operator, I want per-source measurements and control state to behave exactly as before for source segments, so that the control loop I trust keeps working.
15. As an operator, I want failures in shared segments recorded as Plan Health, so that a broken dedupe node never marks my healthy sources DEGRADED.
16. As an operator, I want to see Plan Health per shared node, so that I can locate which downstream step is failing.
17. As an operator, I want the Evidence Ledger and advisory loop to stay per-source, so that recovery-rate gate data isn't polluted by plan-level noise.
18. As an operator, I want existing sources to appear as degenerate single-node Plans without any migration action, so that nothing I run today breaks.
19. As an operator, I want editing an existing source's config through its node inspector, so that forms survive only as the inspector of a selected node.
20. As an operator, I want an observe lens on the same canvas showing control badges and run states over the same graph, so that authoring and diagnosing are two lenses, not two apps.
21. As an operator, I want a Dry-Run Preview of a Plan in the browser on fixture data, clearly labeled, so that I can sanity-check wiring without touching production collection.
22. As an operator, I want the Dry-Run Preview to never write records or task runs, so that preview and real execution can't be confused.
23. As an operator, I want invalid graphs (cycles, type-incompatible wires, orphan merges) rejected at save with node-anchored errors, so that I fix problems where they are.
24. As an operator, I want deleting a source node from a Plan to only detach it from the graph — never silently delete the Data Source entity, so that graphs stay safe to edit.
25. As an operator, I want the palette organized category → node type → Preset with search, so that finding a node scales past a flat list.
26. As an operator, I want Preset definitions fed from backend adapter metadata, so that the palette stays current without frontend releases.
27. As an agent-facing consumer, I want the Plan IR to be a documented JSON schema, so that agents can author Plans programmatically through the same API.
28. As an operator, I want plan runs visible in the Run Inbox like any other run, so that triage stays in one queue.
29. As an operator, I want the per-source dive and the standalone workbench page retired from the product nav, so that there is one canvas, not three.
30. As a maintainer, I want the node-kit registry and KitNode renderer reused as the rendering layer, so that the canvas rebuild doesn't fork a fourth node system.

## Implementation Decisions

- **Plan IR**: one JSON schema for the graph — nodes (source / transform / merge /
  sink) with typed params, edges with port references. Versioned. Documented as an
  API contract. Source nodes carry a `source_id` reference (or a draft marker);
  transforms/merges/sinks are pure graph data with no per-node DB entities.
- **Persistence**: a new plans table storing the graph JSON plus name/version/draft
  state. A Data Source's legacy config is readable as the degenerate single-node
  Plan (adapter function, no data migration).
- **Backend Plan executor**: compiles a Plan into execution — source segments invoke
  the existing channel/runner machinery (producing TaskRuns exactly as today);
  shared segments execute transforms sequentially server-side. Dataflow triggering:
  schedules stay attached to sources; a delivery from any upstream runs the
  downstream shared segment incrementally with source-tagged provenance. Manual
  whole-plan run endpoint for debugging.
- **Two-Tier Attribution**: per-source measurement, control state, Evidence Ledger,
  objectives, and gates are untouched for source segments. Shared segments write
  Plan Health — a new per-plan-node health dimension with its own storage —
  and never write into any source's state.
- **Graph validation**: structural (cycles, orphan merges, missing required params,
  port type mismatches) enforced at save and at run, with node-anchored error
  payloads the canvas can render in place.
- **Presets**: served from backend adapter metadata (site/command/format bundles
  for opencli; analogous bundles for other channels where meaningful). The palette
  consumes them dynamically. Preset selection prefills node params; the advanced
  inspector always exposes the raw parameter set.
- **Canvas**: the existing collection-network canvas evolves into the Collection
  Canvas with two lenses — edit (draft nodes, wiring, inspector, save) and observe
  (control badges, run states — the capabilities that already exist). The
  node-kit NodeSpec registry and KitNode renderer are the rendering layer;
  React Flow UI open components may replace hand-rolled node chrome where they fit.
  The per-source dive pseudo-expansion is removed; the standalone workbench page is
  demoted to a component-library demo outside the product nav.
- **Dry-Run Preview**: the in-browser node-kit runtime (with its new observer/run-log
  machinery) runs Plans on fixture data only, visually labeled as preview, and never
  calls collection APIs.
- **Frontend framework**: stays Vite. A future SaaS/portal surface would be a
  separate app, not a migration of this console.
- **Execution ordering**: the backend executor is the first slice (IR schema, plans
  table, degenerate-plan adapter, executor for single-source plans, then shared
  segments); canvas editing and presets build on top of a working execution chain.

## Testing Decisions

- A good test asserts external behavior at the highest seam: what the API returns,
  what rows exist, what the control loop measured — never internal call order or
  private state.
- **Primary seam — HTTP API integration tests** (the repo's dominant pattern):
  plans CRUD, graph validation errors (422 with node-anchored details), preset
  listing, manual plan run, and post-run observations (task runs, records, per-source
  measurements unchanged in shape, Plan Health rows present).
- **One new seam — Plan executor body direct-invoke**: deterministic execution-
  semantics tests (source segment → channel invocation, shared-segment ordering,
  incremental trigger with provenance, Plan Health recording, abort/error paths)
  without scheduler timing. Precedent: the Control Cycle body seam from the control
  closeout.
- **Zero-regression guarantee**: existing per-source control tests must pass
  unmodified — the two-tier attribution contract makes that an explicit assertion,
  mirroring the "never mutates the data source" test discipline from PR-Control-3.
- **Frontend**: framework-free view-model modules (IR ↔ canvas projection, draft
  lifecycle, preset → param mapping, validation-error anchoring) under node --test,
  following the existing actionHistory/sourceControlRoom convention. Canvas
  components are not unit-tested; the Dry-Run Preview extends the node-kit engine
  test suite added with the runner-visualization work.

## Out of Scope

- Flipping CONTROL_MODE to automatic, or any control-kernel change — the loop is
  observed, not modified.
- Plan-level cron scheduling (dataflow semantics only; revisit only with evidence).
- Multi-plan composition, sub-graphs/macros as product features, plan sharing.
- A light theme, framework migration, or the SaaS/portal surfaces (packages C/D of
  the frontend reference doc).
- Retiring the legacy per-channel form components themselves — they are reused as
  inspector internals, not deleted.
- Copying any source from the React Flow Pro template (reference only).
- odp-store heartbeat producer / error_kinds histogram (standing backlog).

## Further Notes

- The i18n gap flagged by the design audit (zero t() in the newest pages) should not
  be repeated: new canvas/inspector UI strings go through the existing i18n layer.
- The design-audit top-10 (modal consolidation, badge unification, font-size tokens)
  is adjacent but separate work; canvas code written here should simply not add new
  violations.
- Node-organization reference points: React Flow UI open components for node chrome,
  workflowbuilder (Apache-2.0) for schema-driven config panels, cmdk (already a
  dependency) for palette search.
