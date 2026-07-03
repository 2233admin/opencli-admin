// Plan Canvas view-model (Plan IR issue 07 — Collection Canvas edit lens).
// Framework-free pure functions: IR <-> canvas projection, Draft Source Node
// lifecycle, Preset -> node param mapping, and 422 validation-error anchoring.
// No React, no xyflow import beyond the plain data shapes it hands back —
// PlanCanvasPage.tsx is the only place these get wired into actual xyflow
// Node/Edge objects. Mirrors backend.schemas.plan_ir field-for-field (see
// api/types.ts PlanGraph/PlanNode/PlanEdge, generated from that schema).
import type { PlanEdge, PlanGraph, PlanNode, PlanValidationErrorItem, Preset } from '../api/types.ts'

// ── Canvas-side node/edge shapes ─────────────────────────────────────────────
// A position-bearing projection of PlanNode/PlanEdge — what the canvas actually
// renders (xyflow Node/Edge are structurally compatible supersets of these; the
// page module does the final wrap so this file stays xyflow-import-free).

export interface CanvasPosition {
  x: number
  y: number
}

export interface CanvasNode {
  id: string
  /** xyflow node "type" — the node-kit NodeSpec type this node renders as. */
  type: string
  position: CanvasPosition
  /** The full PlanNode this canvas node represents — round-trips byte-faithfully. */
  planNode: PlanNode
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
  planEdge: PlanEdge
}

export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

const DEFAULT_POSITION_COL_GAP = 260
const DEFAULT_POSITION_ROW_GAP = 160
const DEFAULT_COLS = 4

/** Deterministic fallback grid position for a node with no stored position
 * (a freshly-authored node, or a projected degenerate Plan — issue 01's
 * projection endpoint carries no layout at all). Index-based so re-running
 * this over the same node list is stable and doesn't jitter node placement. */
export function fallbackPosition(index: number): CanvasPosition {
  const col = index % DEFAULT_COLS
  const row = Math.floor(index / DEFAULT_COLS)
  return { x: col * DEFAULT_POSITION_COL_GAP, y: row * DEFAULT_POSITION_ROW_GAP }
}

/** Node-kit NodeSpec type for a PlanNode. Source nodes render through the
 * per-channel `source.<channel_type>` specs (frontend/src/node-kit/nodes/
 * sources.tsx) so materializing/editing reuses the existing per-channel body;
 * transform/merge/sink nodes render through kind-generic `plan.<kind>` specs
 * this issue's canvas page registers (no per-node-type catalog exists yet —
 * issue 01 explicitly scoped node `type` as free-form, not enumerated). */
export function canvasNodeType(node: PlanNode): string {
  if (node.kind === 'source') {
    const channelType = typeof node.params.channel_type === 'string' ? node.params.channel_type : ''
    return channelType ? `source.${channelType}` : 'plan.source-draft'
  }
  return `plan.${node.kind}`
}

/** PlanGraph -> CanvasGraph. Pure projection: every PlanNode/PlanEdge is kept
 * verbatim inside `.planNode`/`.planEdge` (round-trip fidelity — issue 07
 * acceptance criterion "a saved Plan reloads onto the canvas identically").
 * Position comes from `params.__canvas_position` when present (this module's
 * own `withCanvasPosition` stamps it there before save) else a deterministic
 * fallback grid slot, so a Plan saved by this canvas reloads at the same
 * layout, and a Plan with no stored layout (e.g. the degenerate projection)
 * still renders somewhere sane instead of all nodes stacking at (0,0). */
export function planGraphToCanvas(graph: PlanGraph): CanvasGraph {
  const nodes: CanvasNode[] = graph.nodes.map((planNode, index) => ({
    id: planNode.id,
    type: canvasNodeType(planNode),
    position: readCanvasPosition(planNode) ?? fallbackPosition(index),
    planNode,
  }))
  const edges: CanvasEdge[] = graph.edges.map((planEdge) => ({
    id: planEdge.id,
    source: planEdge.source_node,
    target: planEdge.target_node,
    sourceHandle: planEdge.source_port,
    targetHandle: planEdge.target_port,
    planEdge,
  }))
  return { nodes, edges }
}

/** CanvasGraph -> PlanGraph. Inverse of planGraphToCanvas: stamps the live
 * canvas position back into `params.__canvas_position` (so the next load
 * restores the same layout) and reassembles nodes/edges in the exact PlanNode/
 * PlanEdge shape the Plans API accepts. `irVersion`/`name`/`draft` come from
 * the caller (the page holds those as top-level Plan fields, not per-node). */
export function canvasToPlanGraph(
  canvas: CanvasGraph,
  meta: { irVersion: string; name?: string | null; draft?: boolean },
): PlanGraph {
  return {
    ir_version: meta.irVersion,
    name: meta.name ?? undefined,
    draft: meta.draft ?? false,
    nodes: canvas.nodes.map((n) => withCanvasPosition(n.planNode, n.position)),
    edges: canvas.edges.map((e) => e.planEdge),
  }
}

function readCanvasPosition(node: PlanNode): CanvasPosition | null {
  const raw = node.params.__canvas_position
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as CanvasPosition).x === 'number' &&
    typeof (raw as CanvasPosition).y === 'number'
  ) {
    return { x: (raw as CanvasPosition).x, y: (raw as CanvasPosition).y }
  }
  return null
}

function withCanvasPosition(node: PlanNode, position: CanvasPosition): PlanNode {
  return { ...node, params: { ...node.params, __canvas_position: position } }
}

// ── Draft Source Node lifecycle (glossary: Draft Source Node) ───────────────
// "Renders visibly unmaterialized, cannot run" — draft=true, source_id unset.
// Materializing swaps draft=false and stamps the real source_id; nothing else
// about the node (id, position, params) changes, so wiring/selection survive
// materialization untouched.

let draftSeq = 0

/** Reset the draft-id counter — test-only, mirrors registry._clearRegistry's
 * pattern for deterministic ids across test cases. */
export function _resetDraftSeq(): void {
  draftSeq = 0
}

/** A brand-new Draft Source Node dropped from the palette (a bare node type,
 * no Preset) — draft=true, no source_id, empty params beyond channel_type.
 * `required_params` always includes at least channel_type-implied requireds
 * so save-time validation (missing_required_param) can catch an incomplete
 * draft that somehow gets flagged runnable — see deriveDraftAndRunnable. */
export function createDraftSourceNode(
  channelType: string,
  position: CanvasPosition,
  idSeed?: string,
): PlanNode {
  const id = idSeed ?? `draft-${channelType}-${draftSeq++}`
  return {
    id,
    kind: 'source',
    type: `${channelType}_source`,
    label: undefined,
    params: { channel_type: channelType, __canvas_position: position },
    required_params: [],
    inputs: [],
    outputs: [{ name: 'out', type: 'records' }],
    source_id: undefined,
    draft: true,
  }
}

/** A Draft Source Node seeded from a Preset (PRD story 4) — same shape as
 * createDraftSourceNode but params are prefilled from the preset's exact
 * payload (backend.plan_ir.presets.Preset.params), never hand-typed. The
 * advanced inspector can still edit every field afterward (PRD story 6 —
 * presets prefill, they never cap what's expressible). */
export function createDraftNodeFromPreset(preset: Preset, position: CanvasPosition, idSeed?: string): PlanNode {
  const id = idSeed ?? `draft-${preset.id}-${draftSeq++}`
  return {
    id,
    kind: 'source',
    type: preset.node_type,
    label: preset.label,
    params: { ...preset.params, __canvas_position: position },
    required_params: [],
    inputs: [],
    outputs: [{ name: 'out', type: 'records' }],
    source_id: undefined,
    draft: true,
  }
}

/** Materialize a draft into a reference to a real, just-created DataSource
 * (issue 07 acceptance criterion: inspector materializes draft -> real
 * source). Pure: the caller is responsible for actually calling POST
 * /sources first and passing the resulting id in. Only draft/source_id flip;
 * params/position/id/wiring are untouched so edges into/out of this node
 * survive materialization unchanged. */
export function materializeDraftNode(node: PlanNode, sourceId: string): PlanNode {
  return { ...node, draft: false, source_id: sourceId }
}

/** True if this PlanNode is an unmaterialized Draft Source Node (glossary
 * term) — the one predicate every "draft" render/behavior decision should
 * go through, so the draft rule (source kind + draft flag + no source_id)
 * lives in exactly one place. */
export function isDraftSourceNode(node: PlanNode): boolean {
  return node.kind === 'source' && node.draft === true && !node.source_id
}

/** Plan-level draft/runnable flags (mirrors backend.services.plan_service.
 * derive_flags so the canvas can preview the same flags the server will
 * compute on save, before round-tripping). draft = any source node is an
 * unmaterialized draft; runnable = at least one source node, all materialized. */
export function deriveDraftAndRunnable(nodes: PlanNode[]): { draft: boolean; runnable: boolean } {
  const sourceNodes = nodes.filter((n) => n.kind === 'source')
  const draft = sourceNodes.some(isDraftSourceNode)
  const runnable = sourceNodes.length > 0 && sourceNodes.every((n) => !isDraftSourceNode(n))
  return { draft, runnable }
}

// ── Preset -> node param mapping (PRD stories 4, 6, 26) ──────────────────────

/** Group presets by their declared node_type (not channel_type) — the
 * palette's second level ("node type") groups Preset chips this way; backend
 * groups by channel_type (issue 06), this regroups client-side for the
 * three-level category -> node type -> Preset organization (story 25).
 * Pure regrouping only — no preset content is invented here. */
export function groupPresetsByNodeType(grouped: Record<string, Preset[]>): Record<string, Preset[]> {
  const byNodeType: Record<string, Preset[]> = {}
  for (const presets of Object.values(grouped)) {
    for (const preset of presets) {
      byNodeType[preset.node_type] ??= []
      byNodeType[preset.node_type].push(preset)
    }
  }
  return byNodeType
}

/** Case-insensitive substring match over label/description/channel_type/
 * node_type — the palette's cmdk search predicate (issue 07: "Presets
 * searchable from the palette", PRD story 5). Pure so it's independently
 * testable from cmdk's own filtering. */
export function presetMatchesQuery(preset: Preset, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    preset.label.toLowerCase().includes(q) ||
    preset.description.toLowerCase().includes(q) ||
    preset.channel_type.toLowerCase().includes(q) ||
    preset.node_type.toLowerCase().includes(q)
  )
}

// ── Validation-error anchoring (PRD "Graph validation" decision) ─────────────
// Backend 422 detail is a flat PlanValidationErrorItem[] with optional
// node_id/edge_id. The canvas renders per-node error badges — this groups the
// flat list by anchor so a node/edge component can do a single map lookup.

export interface AnchoredErrors {
  /** node_id -> errors anchored on that node (includes edge errors whose
   * node_id points at one of the edge's endpoints, per the validator's own
   * convention — e.g. unknown_target_port anchors node_id=target node). */
  byNode: Map<string, PlanValidationErrorItem[]>
  /** edge_id -> errors anchored on that edge, for edge-only rendering (e.g.
   * a dangling-edge highlight independent of any node badge). */
  byEdge: Map<string, PlanValidationErrorItem[]>
  /** Errors with neither node_id nor edge_id (should not occur per the
   * validator's own contract, but never silently dropped). */
  unanchored: PlanValidationErrorItem[]
}

export function anchorValidationErrors(errors: PlanValidationErrorItem[]): AnchoredErrors {
  const byNode = new Map<string, PlanValidationErrorItem[]>()
  const byEdge = new Map<string, PlanValidationErrorItem[]>()
  const unanchored: PlanValidationErrorItem[] = []

  for (const err of errors) {
    let anchored = false
    if (err.node_id) {
      const list = byNode.get(err.node_id) ?? []
      list.push(err)
      byNode.set(err.node_id, list)
      anchored = true
    }
    if (err.edge_id) {
      const list = byEdge.get(err.edge_id) ?? []
      list.push(err)
      byEdge.set(err.edge_id, list)
      anchored = true
    }
    if (!anchored) unanchored.push(err)
  }

  return { byNode, byEdge, unanchored }
}

/** Extract the node-anchored error list from a save-call failure. The API
 * client (api/client.ts normalizeApiError) attaches the raw 422 `detail`
 * array onto the thrown Error as `.detail` when it's an array (every other
 * endpoint's `detail` is a string, left on `.message` instead) — this reads
 * that convention back out, defensively, without assuming the error shape. */
export function extractPlanValidationErrors(err: unknown): PlanValidationErrorItem[] {
  if (!err || typeof err !== 'object') return []
  const detail = (err as { detail?: unknown }).detail
  if (!Array.isArray(detail)) return []
  return detail.filter(
    (item): item is PlanValidationErrorItem =>
      Boolean(item) && typeof item === 'object' && typeof (item as PlanValidationErrorItem).code === 'string',
  )
}

// ── Function groups (Houdini-style subnets, 三层节点: 项目→功能→实现) ────────
// A node may belong to one "function group" (功能组). Membership is stored in
// `params.__canvas_group` exactly like `__canvas_position` — free-form params
// ride through the backend contract untouched, so grouping is a pure canvas
// concern. The top-level (功能层) view collapses each group into one subnet
// node; diving in (实现层) shows only that group's atomic nodes.

export interface CanvasGroup {
  id: string
  label: string
}

export function readCanvasGroup(node: PlanNode): CanvasGroup | null {
  const raw = node.params.__canvas_group
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as CanvasGroup).id === 'string' &&
    typeof (raw as CanvasGroup).label === 'string'
  ) {
    return { id: (raw as CanvasGroup).id, label: (raw as CanvasGroup).label }
  }
  return null
}

/** Assign (or clear, with null) a node's function group. */
export function withCanvasGroup(node: PlanNode, group: CanvasGroup | null): PlanNode {
  if (group === null) {
    const { __canvas_group: _dropped, ...rest } = node.params
    return { ...node, params: rest }
  }
  return { ...node, params: { ...node.params, __canvas_group: { id: group.id, label: group.label } } }
}

/** Distinct groups present in a node list, in first-appearance order. */
export function listCanvasGroups(nodes: PlanNode[]): CanvasGroup[] {
  const seen = new Map<string, CanvasGroup>()
  for (const n of nodes) {
    const g = readCanvasGroup(n)
    if (g && !seen.has(g.id)) seen.set(g.id, g)
  }
  return [...seen.values()]
}

export interface SubnetView {
  /** Atomic canvas nodes visible at this level. */
  nodes: CanvasNode[]
  /** Edges whose two visible endpoints both render at this level. Boundary-
   * crossing edges are re-anchored onto the subnet node (top level) or
   * dropped (dive level renders only intra-group wiring). */
  edges: CanvasEdge[]
  /** Collapsed subnet placeholders (top level only; empty when diving). */
  subnets: Array<{ group: CanvasGroup; memberCount: number; position: CanvasPosition }>
}

/** Project the flat graph into what one hierarchy level actually shows —
 * pure, so it's testable without xyflow. `activeGroup=null` is the 功能层
 * (groups collapsed to subnets); a group id is the 实现层 dive. */
export function buildSubnetView(canvas: CanvasGraph, activeGroup: string | null): SubnetView {
  const groupOf = (nodeId: string): CanvasGroup | null => {
    const node = canvas.nodes.find((n) => n.id === nodeId)
    return node ? readCanvasGroup(node.planNode) : null
  }

  if (activeGroup !== null) {
    const nodes = canvas.nodes.filter((n) => readCanvasGroup(n.planNode)?.id === activeGroup)
    const visible = new Set(nodes.map((n) => n.id))
    const edges = canvas.edges.filter((e) => visible.has(e.source) && visible.has(e.target))
    return { nodes, edges, subnets: [] }
  }

  const nodes = canvas.nodes.filter((n) => readCanvasGroup(n.planNode) === null)
  const groups = listCanvasGroups(canvas.nodes.map((n) => n.planNode))
  const subnets = groups.map((group) => {
    const members = canvas.nodes.filter((n) => readCanvasGroup(n.planNode)?.id === group.id)
    const cx = members.reduce((s, m) => s + m.position.x, 0) / Math.max(members.length, 1)
    const cy = members.reduce((s, m) => s + m.position.y, 0) / Math.max(members.length, 1)
    return { group, memberCount: members.length, position: { x: cx, y: cy } }
  })

  // Re-anchor boundary-crossing edges onto subnet ids; dedupe collapsed pairs.
  const subnetId = (gid: string) => `__subnet-${gid}`
  const seen = new Set<string>()
  const edges: CanvasEdge[] = []
  for (const e of canvas.edges) {
    const gs = groupOf(e.source)
    const gt = groupOf(e.target)
    if (gs === null && gt === null) {
      edges.push(e)
      continue
    }
    if (gs?.id === gt?.id) continue // fully inside one subnet — invisible here
    const source = gs ? subnetId(gs.id) : e.source
    const target = gt ? subnetId(gt.id) : e.target
    const sourceHandle = gs ? 'out' : e.sourceHandle
    const targetHandle = gt ? 'in' : e.targetHandle
    const key = `${source}→${target}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ id: `agg-${key}`, source, target, sourceHandle, targetHandle, planEdge: e.planEdge })
  }

  return { nodes, edges, subnets }
}

// ── Detach (never delete) ────────────────────────────────────────────────────

/** Remove a node (and every edge touching it) from the graph WITHOUT ever
 * touching the underlying DataSource entity (issue 07 acceptance criterion /
 * PRD story 24: "deleting a source node from the graph only detaches it").
 * This function only edits the in-memory CanvasGraph; the caller (the page)
 * must never call the sources-delete API as a side effect of this — the
 * separation itself is the safety property, not something this function can
 * enforce by return type alone. */
export function detachNode(canvas: CanvasGraph, nodeId: string): CanvasGraph {
  return {
    nodes: canvas.nodes.filter((n) => n.id !== nodeId),
    edges: canvas.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  }
}
