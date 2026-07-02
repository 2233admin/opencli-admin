# OpenCLI Admin Context

OpenCLI Admin is an operations console for collection work that needs browser session control, scheduled collection, and operator review.

## Language

**Collection Operations Console**: The primary operator surface for turning collection work into captured, triaged, owned, stateful, and closed work. It is the product shape that contains Run Inbox, Data Sources, Live Collection View, and the Collection Canvas.
_Avoid_: Dashboard wall

**Collection Operations**: The operator-facing domain for deciding what should be collected, when collection should run, what recently happened, and which actions are currently safe. It groups Data Sources, Collection Plans, Recent Runs, and Node Actions.
_Avoid_: Source Workflow Workbench

**Collection Canvas**: The primary authoring surface for collection logic — the graph IS the program. Defining and editing what a source collects happens on the canvas; forms survive only as the inspector panel of a selected node. Absorbs the old Diagnostic Canvas's troubleshooting role.
_Avoid_: Diagnostic Canvas (superseded 2026-07-02: canvas promoted from secondary diagnostic view to primary authoring surface), form-first configuration

**Live Collection View**: The operator-facing view of an active collection run as it happens, including streamed progress, rendered browser or pipeline state, and run-specific artifacts. It is anchored to a Recent Run, not to the default configuration surface.
_Avoid_: Static task log, canvas-only monitoring

**Adaptive Run Surface**: The on-demand layout that opens the right Live Collection View panels for the active run type. It should reveal pipeline events, browser or adapter rendering, and artifacts only when they help the operator understand that run.
_Avoid_: Clock shop, always-on dashboard wall

**Run Inbox**: The operator-facing queue of collection runs that need observation, review, retry, acknowledgement, or dismissal. It treats a run as work to triage and close, not as a passive row in a log table.
_Avoid_: Recent tasks table, static run history

### Control

**Advisory Mode**: The control-loop operating mode in which suggested actions are surfaced to the operator and recorded as evidence, but never executed.
_Avoid_: dry-run mode, suggestion mode

**Automatic Mode**: The control-loop operating mode in which the Actuator may execute suggestions itself, opened per state class only when accumulated evidence justifies it.
_Avoid_: autopilot, self-healing mode

**Actuator**: The component that carries out control actions against the collection system. It executes only whitelisted safe actions; everything else it downgrades.
_Avoid_: executor, auto-fixer

**Evidence Ledger**: The durable record of every control suggestion and execution, together with the outcome later judged from post-decision measurements.
_Avoid_: action log, audit trail

**Recovery Rate**: The share of judged suggestions whose triggering state later cleared. It is the quantified basis for opening Automatic Mode.
_Avoid_: success rate, fix rate

**Require-Review Downgrade**: The policy that suggestions too dangerous to automate are executed only as "flag the source for human review", never as the suggested action itself.
_Avoid_: blocked action, action rejection

**Control Cycle**: The background loop that periodically measures every source, decides, and — in Automatic Mode — acts. It runs regardless of whether any UI is open.
_Avoid_: polling-driven control, frontend-triggered control

### Plan

**Plan**: A free multi-source graph on the Collection Canvas — any number of source nodes, transforms, merges, and sinks in one graph. The Plan is the program; a Data Source's legacy config is the degenerate single-node Plan.
_Avoid_: per-source pipeline (rejected 2026-07-02 in favor of free graphs), workflow (overloaded)

**Two-Tier Attribution**: The observability contract for Plans. A source node is a real Data Source and its collection segment keeps per-source measurement unchanged (the control kernel is untouched); everything downstream of a merge belongs to Plan Health, and a shared-segment failure is never written into any source's state.
_Avoid_: blaming all upstream sources, plan-only attribution

**Plan Health**: The health of a Plan's shared (post-merge) segments, measured per plan node, kept as its own dimension beside per-source measurement. A dedupe node failing does not make its upstream sources DEGRADED.
_Avoid_: folding plan failures into source state

**Preset**: A packaged, one-click node configuration (e.g. an opencli site + command + format bundled as "雪球·热帖") registered in the node library and searchable from the palette. Presets are fed from backend adapter metadata, never hardcoded in the frontend. The advanced inspector still exposes raw parameters.
_Avoid_: raw site/command dropdowns as the default UI

**Draft Source Node**: A source node placed on the Collection Canvas that does not yet reference a real Data Source. It renders visibly unmaterialized, cannot run, and does not enter the control loop until it is materialized into an entity.
_Avoid_: fake canvas-only nodes that look real

**Dry-Run Preview**: The in-browser execution of a Plan on fixture data, explicitly labeled as a preview. It never produces collection results — the backend Plan executor is the only authoritative execution.
_Avoid_: browser-side "real" runs, split-brain execution
