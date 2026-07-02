# Plans are free multi-source graphs with two-tier attribution, compiled and executed by the backend

With the Collection Canvas promoted to primary authoring surface (ADR-0008), the graph
needs a single intermediate representation both sides speak. Decisions (2026-07-02):

**Unit — free graph.** A Plan is one graph holding any number of source nodes,
transforms, merges, and sinks (Houdini-style), not a per-source pipeline. A Data
Source's legacy channel config is the degenerate single-node Plan, so existing sources
migrate by definition, not by rewrite.

**Attribution — two tiers.** The control kernel (source_measurements, Evidence
Ledger, objectives, gates — all keyed by source_id) stays untouched: a source node IS
a real DataSource and its collection segment keeps per-source measurement. Everything
downstream of a merge belongs to **Plan Health**, a separate dimension measured per
plan node. A shared dedupe node failing never writes DEGRADED into an upstream
source's state — the alternatives (blame all upstream sources, or re-key the whole
control loop by plan) either poison the evidence ledger or throw away the just-closed
PR-Control stack.

**Execution — backend authoritative.** The backend gains a Plan executor: source
segments call the existing channel/runner machinery; shared segments run transforms
sequentially. The in-browser node-kit runtime is demoted to an explicitly-labeled
dry-run preview on fixture data — it never produces collection results. One graph,
one semantics.

**Persistence — plans table, entities only at the source boundary.** Plans persist as
graph JSON in a new table; source nodes must reference a real DataSource id;
transforms/merges/sinks are pure graph data (no per-node tables). Draft graphs may be
saved, but draft source nodes do not enter the control loop until materialized.

**Triggering — dataflow semantics.** Schedules stay on sources (zero migration); each
source node fires on its own cadence, and any upstream delivery runs the downstream
shared segment incrementally with source-tagged provenance. No plan-level cron —
lockstep scheduling would force a 5-minute RSS source and an hourly adapter source
onto one clock. A manual whole-plan run exists for debugging only.

Main risk accepted: free graphs make attribution and incremental execution genuinely
harder than per-source pipelines — that is the price of the expressiveness the product
direction demands, and the two-tier contract is what keeps the hard part out of the
control kernel.
