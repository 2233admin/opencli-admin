// Graph helpers used by "Prevent Cycles", "Connection Limit" and "Validation".
// All functions are pure so they can be unit-tested and reused server-side.

import type { Edge, Node, Connection } from "@xyflow/react"

/** Would adding `source → target` introduce a directed cycle in `edges`? */
export function wouldCreateCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) return true
  // BFS from target — if we can reach source, adding source→target closes a cycle.
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (!e.source || !e.target) continue
    const arr = adj.get(e.source) ?? []
    arr.push(e.target)
    adj.set(e.source, arr)
  }
  const stack = [target]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === source) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    const next = adj.get(cur)
    if (next) stack.push(...next)
  }
  return false
}

/** Count how many edges already touch a given (node, handle, direction). */
export function countHandleConnections(
  edges: Edge[],
  nodeId: string,
  handleId: string | null | undefined,
  direction: "source" | "target",
): number {
  return edges.filter((e) => {
    if (direction === "source") {
      if (e.source !== nodeId) return false
      return (e.sourceHandle ?? null) === (handleId ?? null)
    } else {
      if (e.target !== nodeId) return false
      return (e.targetHandle ?? null) === (handleId ?? null)
    }
  }).length
}

export interface ValidateConnectionOptions {
  /** false → allow cycles */
  preventCycles: boolean
  /** max outgoing edges per source handle. undefined = unlimited */
  maxSourceConnections?: number
  /** max incoming edges per target handle. undefined = unlimited */
  maxTargetConnections?: number
  /** if a node type carries `handleType`, target must match source */
  typedHandles?: boolean
  nodes?: Node[]
}

export function validateConnection(
  edges: Edge[],
  connection: Connection,
  opts: ValidateConnectionOptions,
): { ok: true } | { ok: false; reason: string } {
  const { source, target, sourceHandle, targetHandle } = connection
  if (!source || !target) return { ok: false, reason: "缺少端点" }
  if (source === target) return { ok: false, reason: "不能自连" }

  if (opts.preventCycles && wouldCreateCycle(edges, source, target)) {
    return { ok: false, reason: "该连线会形成环" }
  }

  if (typeof opts.maxSourceConnections === "number") {
    if (countHandleConnections(edges, source, sourceHandle, "source") >= opts.maxSourceConnections) {
      return { ok: false, reason: `输出端口最多 ${opts.maxSourceConnections} 条连线` }
    }
  }
  if (typeof opts.maxTargetConnections === "number") {
    if (countHandleConnections(edges, target, targetHandle, "target") >= opts.maxTargetConnections) {
      return { ok: false, reason: `输入端口最多 ${opts.maxTargetConnections} 条连线` }
    }
  }

  if (opts.typedHandles && opts.nodes) {
    const s = opts.nodes.find((n) => n.id === source)
    const t = opts.nodes.find((n) => n.id === target)
    const sType = (s?.data as { handleType?: string } | undefined)?.handleType
    const tType = (t?.data as { handleType?: string } | undefined)?.handleType
    if (sType && tType && sType !== tType) {
      return { ok: false, reason: `端口类型不兼容：${sType} → ${tType}` }
    }
  }

  return { ok: true }
}
