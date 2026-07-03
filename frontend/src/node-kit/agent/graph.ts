// Agent graph authoring — the inverse of agent/toSchema. toSchema tells the agent
// WHAT atoms exist (catalog + JSON-schema); this consumes the agent's answer (a
// {nodes,edges} blob) and materializes a validated, canvas-ready graph. Every
// problem is reported in `errors` so the agent can fix-and-retry instead of
// emitting a silently-broken graph.
import type { Edge, Node } from '@xyflow/react'

import { getNode, instantiate } from '../registry'
import type { ConfigValues } from '../spec'

export interface AgentGraphNode {
  type: string
  /** optional stable id the agent uses to reference this node from edges */
  id?: string
  config?: ConfigValues
  position?: { x: number; y: number }
}
export interface AgentGraphEdge {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}
export interface AgentGraph {
  nodes: AgentGraphNode[]
  edges?: AgentGraphEdge[]
}
export interface GraphBuildResult {
  nodes: Node[]
  edges: Edge[]
  /** human-readable validation problems — empty = clean graph. */
  errors: string[]
}

const COL_W = 260
const ROW_H = 150

/** Validate + materialize an agent-emitted graph into xyflow nodes+edges.
 *  Unknown types, config validation failures, dangling edges and bad port refs
 *  are collected (never thrown) so the whole graph is reported in one pass. */
export function instantiateGraph(graph: AgentGraph): GraphBuildResult {
  const errors: string[] = []
  const nodes: Node[] = []
  const idMap = new Map<string, string>() // agent-supplied id (and final id) -> final id

  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  if (rawNodes.length === 0) errors.push('graph.nodes 为空')

  rawNodes.forEach((gn, i) => {
    if (!gn || typeof gn.type !== 'string') {
      errors.push(`nodes[${i}]: 缺少 type`)
      return
    }
    const made = instantiate({ type: gn.type, id: gn.id, config: gn.config, position: gn.position })
    if (!made) {
      errors.push(`nodes[${i}]: 未注册的节点类型 "${gn.type}"`)
      return
    }
    const finalId = made.instance.id
    if (gn.id) idMap.set(gn.id, finalId)
    idMap.set(finalId, finalId)
    for (const [key, msg] of Object.entries(made.parse.errors)) {
      errors.push(`${gn.type}.${key}: ${msg}`)
    }
    nodes.push({
      id: finalId,
      type: gn.type,
      position: gn.position ?? { x: 80 + (i % 4) * COL_W, y: 80 + Math.floor(i / 4) * ROW_H },
      data: { config: made.instance.config },
    })
  })

  const edges: Edge[] = []
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges : []
  rawEdges.forEach((ge, i) => {
    if (!ge || typeof ge.source !== 'string' || typeof ge.target !== 'string') {
      errors.push(`edges[${i}]: 缺少 source/target`)
      return
    }
    const s = idMap.get(ge.source)
    const t = idMap.get(ge.target)
    if (!s) {
      errors.push(`edges[${i}]: 找不到 source 节点 "${ge.source}"`)
      return
    }
    if (!t) {
      errors.push(`edges[${i}]: 找不到 target 节点 "${ge.target}"`)
      return
    }
    // light port validation against the registered specs
    const sSpec = getNode(String(nodes.find((n) => n.id === s)?.type))
    const tSpec = getNode(String(nodes.find((n) => n.id === t)?.type))
    if (ge.sourceHandle && sSpec && !sSpec.ports.outputs.some((p) => p.id === ge.sourceHandle)) {
      errors.push(`edges[${i}]: 节点无输出端口 "${ge.sourceHandle}"`)
    }
    if (ge.targetHandle && tSpec && !tSpec.ports.inputs.some((p) => p.id === ge.targetHandle)) {
      errors.push(`edges[${i}]: 节点无输入端口 "${ge.targetHandle}"`)
    }
    edges.push({
      id: `e-${s}-${t}-${i}`,
      source: s,
      target: t,
      sourceHandle: ge.sourceHandle,
      targetHandle: ge.targetHandle,
      type: 'default',
    })
  })

  return { nodes, edges, errors }
}
