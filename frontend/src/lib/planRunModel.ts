// Plan Canvas run-projection + lens view-model (Plan IR issue 08 — Collection
// Canvas observe lens + plan runs). Framework-free pure functions: lens
// toggle state, "can this Plan run" gating (draft/runnable), and projecting
// a backend PlanRunRead / PlanHealthRead[] onto the node-kit RunStateMap
// (frontend/src/node-kit/runtime/runLog.ts) that KitNode already knows how
// to render as running/success/error borders (see node-kit/render/KitNode.tsx
// RUN_STATE_BORDER) — reusing that mechanism rather than inventing new
// execution-state visuals, per the issue's "reuse KitNode execution-state
// rendering conventions" instruction.
import type {
  PlanHealthRead,
  PlanNode,
  PlanRunRead,
  SourceSegmentRead,
} from '../api/types.ts'
import type { RunLogEntry, RunNodeState, RunStateMap } from '../node-kit/runtime/runLog.ts'
import { isDraftSourceNode } from './planCanvasModel.ts'

// ── Lens state ────────────────────────────────────────────────────────────────
// The Collection Canvas has exactly two lenses on one canvas (issue 07 edit,
// issue 08 observe) — no separate page/route. A plain union + toggle so the
// page can keep this in useState without any framework coupling here.

export type PlanCanvasLens = 'edit' | 'observe'

export function toggleLens(current: PlanCanvasLens): PlanCanvasLens {
  return current === 'edit' ? 'observe' : 'edit'
}

// ── Run gating (issue 08 acceptance criterion: draft Plans show a disabled
// run affordance with the reason) ───────────────────────────────────────────

export type RunBlockReason = 'draft' | 'not-runnable'

export interface RunGate {
  canRun: boolean
  /** Present only when canRun is false — the i18n key suffix the page looks
   * up under `planCanvas.run.blocked.<reason>` for the tooltip/disabled text. */
  reason?: RunBlockReason
}

/** Whether a Plan's run button should be enabled — mirrors the backend's own
 * refusal (`plans.py run_plan`: draft/non-runnable Plans 400). Draft takes
 * precedence in the reported reason because it's the more actionable one
 * (materialize the draft sources) — a Plan can be draft AND technically have
 * zero source nodes at the same time, but draft is always surfaced first. */
export function evaluateRunGate(plan: { draft: boolean; runnable: boolean }): RunGate {
  if (plan.draft) return { canRun: false, reason: 'draft' }
  if (!plan.runnable) return { canRun: false, reason: 'not-runnable' }
  return { canRun: true }
}

// ── Dispatch state (issue 08: "set all participating nodes 'running' on
// dispatch") ──────────────────────────────────────────────────────────────────

/** Every source node id in the graph — the set that goes "running" the
 * instant the operator clicks Run, before the (synchronous) response comes
 * back. Shared nodes (transform/merge/sink) are intentionally NOT marked
 * running here: the run endpoint's response only carries a shared_segment
 * outcome when shared nodes exist, and Plan Health (not this dispatch state)
 * is the shared-node source of truth once the response lands. */
export function sourceNodeIds(nodes: PlanNode[]): string[] {
  return nodes.filter((n) => n.kind === 'source').map((n) => n.id)
}

/** Build the RunStateMap to show immediately on Run click: every source node
 * -> 'running', seq assigned in array order so a later toRunLogRows() call
 * (if the page also drives a RunLogPanel) reads chronologically. */
export function markNodesRunning(nodeIds: string[], seqStart = 0): RunStateMap {
  const map: RunStateMap = {}
  nodeIds.forEach((id, i) => {
    map[id] = { nodeId: id, state: 'running', detail: {}, seq: seqStart + i }
  })
  return map
}

// ── Response projection (issue 08: "project the PlanRunRead response ...
// onto node states") ─────────────────────────────────────────────────────────

/** Resolve which PlanNode a SourceSegmentRead belongs to. Multi-source runs
 * (issue 04) key segments by node_id directly; a degenerate (single-source)
 * Plan run (issue 03) has no source_results at all — the top-level
 * PlanRunRead fields (source_id/success/...) describe that single source
 * node instead, which projectPlanRunOntoNodes handles as a fallback. */
function findNodeBySourceId(nodes: PlanNode[], sourceId: string | null | undefined): PlanNode | undefined {
  if (!sourceId) return undefined
  return nodes.find((n) => n.kind === 'source' && n.source_id === sourceId)
}

function segmentToRunState(nodeId: string, seg: { success: boolean; error?: string | null }, seq: number): RunLogEntry {
  const state: RunNodeState = seg.success ? 'success' : 'error'
  return {
    nodeId,
    state,
    detail: seg.error ? { errorMessage: seg.error } : {},
    seq,
  }
}

/** Project a completed PlanRunRead onto a RunStateMap covering every source
 * node the run touched. Handles both shapes the backend returns:
 *  - multi-source (issue 04): `source_results` has one entry per source node
 *  - degenerate (issue 03): `source_results` is empty; the run's own
 *    top-level fields (source_id/success/error) describe the one source node
 * Nodes the run never touched (e.g. a node added to the canvas after this
 * run started) are left out of the returned map — the caller merges this
 * over the "all running" map from markNodesRunning, so an untouched node
 * simply keeps whatever state it already had. */
export function projectPlanRunOntoNodes(nodes: PlanNode[], run: PlanRunRead): RunStateMap {
  const map: RunStateMap = {}
  let seq = 0

  if (run.source_results.length > 0) {
    for (const seg of run.source_results) {
      map[seg.node_id] = segmentToRunState(seg.node_id, seg, seq++)
    }
  } else {
    // Degenerate single-source run: no per-node segments, project the
    // top-level result onto whichever source node owns run.source_id.
    const node = findNodeBySourceId(nodes, run.source_id)
    if (node) {
      map[node.id] = segmentToRunState(node.id, { success: run.success, error: run.error }, seq++)
    }
  }

  return map
}

/** Per-node detail derived from a SourceSegmentRead — collected/stored/
 * skipped counts the observe lens can show alongside the run-state border
 * (the RunLogEntry.detail.outputPreview slot, reusing the existing KitNode
 * "duration/preview" convention rather than adding new node-kit fields). */
export function segmentSummary(seg: SourceSegmentRead): string {
  return `collected ${seg.collected} · stored ${seg.stored} · skipped ${seg.skipped}`
}

// ── Plan Health projection (issue 08: shared nodes -> Plan Health; honest
// "no data" when there are no rows — never fake healthy) ────────────────────

/** Latest PlanHealthRead per node_id. Backend returns newest-first (issue 04:
 * "GET /plans/{plan_id}/health ... newest first") but this sorts defensively
 * by recorded_at so the projection is correct regardless of API ordering. */
export function latestHealthByNode(rows: PlanHealthRead[]): Map<string, PlanHealthRead> {
  const byNode = new Map<string, PlanHealthRead>()
  for (const row of rows) {
    const existing = byNode.get(row.node_id)
    if (!existing || row.recorded_at > existing.recorded_at) {
      byNode.set(row.node_id, row)
    }
  }
  return byNode
}

/** Project the latest-per-node Plan Health rows onto a RunStateMap for the
 * shared (transform/merge/sink) nodes. A node with no recorded health row
 * gets NO entry in the map at all (not a fabricated 'success') — the
 * caller/renderer must treat "absent from this map" as the honest "no data"
 * state, exactly like ControlBadge's `controlState == null` -> "NO DATA"
 * chip for source nodes. This is the one place that guarantee lives for
 * shared nodes. */
export function projectHealthOntoSharedNodes(nodes: PlanNode[], health: PlanHealthRead[]): RunStateMap {
  const latest = latestHealthByNode(health)
  const map: RunStateMap = {}
  let seq = 0
  for (const node of nodes) {
    if (node.kind === 'source') continue
    const row = latest.get(node.id)
    if (!row) continue // no data — deliberately absent, not a fake state
    const state: RunNodeState = row.success ? 'success' : 'error'
    map[node.id] = {
      nodeId: node.id,
      state,
      detail: {
        durationMs: row.duration_ms,
        errorMessage: row.error_message ?? undefined,
        outputPreview: `in ${row.items_in} · out ${row.items_out}`,
      },
      seq: seq++,
    }
  }
  return map
}

/** Merge two RunStateMaps, right-biased (b's entries win on key collision) —
 * the shared merge primitive this module uses everywhere it needs to layer
 * "all running" under "resolved results" under "health refetch", so there is
 * exactly one merge rule instead of three ad-hoc spreads. */
export function mergeRunState(a: RunStateMap, b: RunStateMap): RunStateMap {
  return { ...a, ...b }
}

// ── Draft-run guard (defensive mirror of the backend's own refusal) ─────────

/** True if any source node in the graph is an unmaterialized draft — used
 * defensively alongside evaluateRunGate's `plan.draft` flag so a canvas that
 * hasn't been saved since the last edit (stale `draft` flag from the last
 * load) still refuses to dispatch a run client-side. The backend is still
 * the authority (it 400s independently) — this only prevents firing a
 * request the operator can already see will fail. */
export function hasUnmaterializedDraftSource(nodes: PlanNode[]): boolean {
  return nodes.some((n) => n.kind === 'source' && isDraftSourceNode(n))
}
