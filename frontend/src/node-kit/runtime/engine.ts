// Self-built P0 runtime for the node graph (Plan A: React Flow UI + own runtime).
// Steps: topological sort → light input validation → run pure-function nodes
// (spec.run) → dispatch backend-only nodes via a hook → collect terminal artifact.
// No external execution engine; ~one file. Adding richer scheduling later must
// not change this signature.
import { getNode } from '../registry.ts'
import type { ConfigValues, RunResult } from '../spec.ts'
import type { RunNodeDetail, RunNodeState } from './runLog.ts'

export interface RunNode {
  id: string
  type: string
  config: ConfigValues
}
export interface RunEdge {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}
export type BackendRunner = (node: RunNode, inputs: Record<string, unknown>) => Promise<RunResult>

/** Observability hook: fired on every node-state transition during a run, in
 *  execution order (queued for the whole run up front, then running/success/
 *  error/skipped per node as the Kahn-ordered loop walks it). Purely additive
 *  — omitting `opts.observer` reproduces the old silent behavior exactly. */
export type NodeStateObserver = (nodeId: string, state: RunNodeState, detail?: RunNodeDetail) => void

export interface RunGraphResult {
  order: string[]
  outputs: Record<string, RunResult>
  errors: Record<string, string>
  warnings: string[]
  artifact: Record<string, RunResult>
}

export async function runGraph(
  nodes: RunNode[],
  edges: RunEdge[],
  opts: { backend?: BackendRunner; observer?: NodeStateObserver; signal?: { aborted: boolean } } = {},
): Promise<RunGraphResult> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, RunEdge[]>()
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]))
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    const list = incoming.get(e.target) ?? []
    list.push(e)
    incoming.set(e.target, list)
  }

  // 1. topological sort (Kahn)
  const deg = new Map(indeg)
  const queue = nodes.filter((n) => (deg.get(n.id) ?? 0) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift() as string
    order.push(id)
    for (const e of edges) {
      if (e.source !== id) continue
      const d = (deg.get(e.target) ?? 0) - 1
      deg.set(e.target, d)
      if (d === 0) queue.push(e.target)
    }
  }

  const errors: Record<string, string> = {}
  const warnings: string[] = []
  if (order.length < nodes.length) {
    for (const n of nodes) if (!order.includes(n.id)) errors[n.id] = '存在环，跳过执行'
  }

  // 2. light validation: required inputs should be connected
  for (const n of nodes) {
    const spec = getNode(n.type)
    const connected = new Set((incoming.get(n.id) ?? []).map((e) => e.targetHandle ?? 'in'))
    for (const p of spec?.ports.inputs ?? []) {
      if (!connected.has(p.id)) warnings.push(`${spec?.title ?? n.type} 的输入「${p.label ?? p.id}」未连接`)
    }
  }

  // Announce the whole run order up front so a UI can pre-render every node as
  // 'queued' before execution reaches it (matches the React Flow workflow-editor
  // template's "runner" look: the whole graph is visibly queued, then lights up
  // node-by-node).
  for (const id of order) opts.observer?.(id, 'queued')
  for (const n of nodes) if (!order.includes(n.id)) opts.observer?.(n.id, 'skipped', { errorMessage: errors[n.id] })

  // 3/4. execute in order
  const outputs: Record<string, RunResult> = {}
  for (const id of order) {
    if (opts.signal?.aborted) {
      opts.observer?.(id, 'skipped', { errorMessage: '已停止' })
      continue
    }
    const node = byId.get(id) as RunNode
    const spec = getNode(node.type)
    const inputs: Record<string, unknown> = {}
    for (const e of incoming.get(id) ?? []) {
      const up = outputs[e.source]
      if (up) inputs[e.targetHandle ?? 'in'] = up[e.sourceHandle ?? 'out']
    }
    opts.observer?.(id, 'running')
    const startedAt = Date.now()
    try {
      if (spec?.run) {
        outputs[id] = await spec.run({ id, config: node.config, inputs })
      } else if (opts.backend) {
        outputs[id] = await opts.backend(node, inputs)
      } else {
        // backend-only node with no runner wired yet → mark, don't crash
        outputs[id] = { _pending: `${spec?.title ?? node.type} 需后端执行（未接 backend runner）` }
      }
      opts.observer?.(id, 'success', {
        durationMs: Date.now() - startedAt,
        outputPreview: previewOutput(outputs[id]),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors[id] = message
      outputs[id] = {}
      opts.observer?.(id, 'error', { durationMs: Date.now() - startedAt, errorMessage: message })
    }
  }

  // 5. artifact = terminal nodes' outputs (no outgoing edge)
  const hasOut = new Set(edges.map((e) => e.source))
  const artifact: Record<string, RunResult> = {}
  for (const id of order) if (!hasOut.has(id)) artifact[id] = outputs[id]

  return { order, outputs, errors, warnings, artifact }
}

/** Short, safe one-line preview of a node's RunResult for the run log row —
 *  never throws on cyclic/exotic values (falls back to String()). */
function previewOutput(result: RunResult): string {
  try {
    const s = JSON.stringify(result)
    return s ?? String(result)
  } catch {
    return String(result)
  }
}
