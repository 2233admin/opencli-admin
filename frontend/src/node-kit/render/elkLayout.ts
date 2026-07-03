// ELK auto-layout for the node-kit canvas. Takes xyflow nodes+edges, runs the
// layered (Sugiyama) algorithm left→right so the graph reads as a dataflow, and
// returns nodes with fresh positions. Pure: callers setNodes() + fitView().
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import type { Edge, Node } from '@xyflow/react'

const elk = new ELK()

// KitNode is a fixed 248px-wide card; height grows with body rows. Fall back to
// these when xyflow hasn't measured a node yet (e.g. freshly seeded graph).
const FALLBACK_W = 248
const FALLBACK_H = 116

const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '96',
  'elk.spacing.nodeNode': '52',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
}

function sizeOf(n: Node): { width: number; height: number } {
  return {
    width: n.measured?.width ?? (typeof n.width === 'number' ? n.width : undefined) ?? FALLBACK_W,
    height: n.measured?.height ?? (typeof n.height === 'number' ? n.height : undefined) ?? FALLBACK_H,
  }
}

export async function elkLayout(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  if (nodes.length === 0) return nodes

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((n) => ({ id: n.id, ...sizeOf(n) })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  const laid = await elk.layout(graph)
  const placed = new Map((laid.children ?? []).map((c) => [c.id, c]))

  return nodes.map((n) => {
    const p = placed.get(n.id)
    return p && p.x != null && p.y != null ? { ...n, position: { x: p.x, y: p.y } } : n
  })
}
