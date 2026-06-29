// Self-built P0 runtime for the node graph (Plan A: React Flow UI + own runtime).
// Steps: topological sort → light input validation → run pure-function nodes
// (spec.run) → dispatch backend-only nodes via a hook → collect terminal artifact.
// No external execution engine; ~one file. Adding richer scheduling later must
// not change this signature.
import { getNode } from '../registry'
import type { ConfigValues, RunResult } from '../spec'

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
  opts: { backend?: BackendRunner } = {},
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

  // 3/4. execute in order
  const outputs: Record<string, RunResult> = {}
  for (const id of order) {
    const node = byId.get(id) as RunNode
    const spec = getNode(node.type)
    const inputs: Record<string, unknown> = {}
    for (const e of incoming.get(id) ?? []) {
      const up = outputs[e.source]
      if (up) inputs[e.targetHandle ?? 'in'] = up[e.sourceHandle ?? 'out']
    }
    try {
      if (spec?.run) {
        outputs[id] = await spec.run({ id, config: node.config, inputs })
      } else if (opts.backend) {
        outputs[id] = await opts.backend(node, inputs)
      } else {
        // backend-only node with no runner wired yet → mark, don't crash
        outputs[id] = { _pending: `${spec?.title ?? node.type} 需后端执行（未接 backend runner）` }
      }
    } catch (err) {
      errors[id] = err instanceof Error ? err.message : String(err)
      outputs[id] = {}
    }
  }

  // 5. artifact = terminal nodes' outputs (no outgoing edge)
  const hasOut = new Set(edges.map((e) => e.source))
  const artifact: Record<string, RunResult> = {}
  for (const id of order) if (!hasOut.has(id)) artifact[id] = outputs[id]

  return { order, outputs, errors, warnings, artifact }
}
