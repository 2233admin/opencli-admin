// Macro = a saved subgraph that collapses to one node and expands back. The whole
// feature is PURE GRAPH OPS over xyflow Node[]/Edge[] plus one synthetic NodeSpec
// per macro (so the existing <KitNode> renderer + P0 engine stay untouched).
//
// Iron rule honored: there is NO second executor. A macro never runs as a unit —
// `flattenForRun` inlines every macro back to its atoms before `runGraph`, so the
// existing Kahn topo-sort engine handles cross-boundary ordering for free.
import { createElement } from 'react'
import type { Edge, Node } from '@xyflow/react'

import { defineNode } from '../define'
import { getNode, registerNode } from '../registry'
import type { NodeSpec, PortDef } from '../spec'
import { MacroBody } from './MacroNode'

/** A boundary handle promoted to an external port of the macro. The synthetic
 *  port id (`innerNodeId:innerHandle`) encodes its interior target so collapse
 *  and expand can reconnect crossing edges deterministically. */
export interface MacroPort extends PortDef {
  innerNodeId: string
  innerHandle: string
}

export interface MacroDef {
  /** 'macro.<slug>-<rand>' — ALSO the registered spec.type and the store key. */
  id: string
  name: string
  /** RELATIVE positions; ids are LOCAL (namespaced only at expand/flatten time). */
  subgraph: { nodes: Node[]; edges: Edge[] }
  inputs: MacroPort[]
  outputs: MacroPort[]
  createdAt: number
}

// Handle-id convention matches the atoms + engine: an input handle defaults to
// 'in', an output handle to 'out' (engine.ts:70,84; pipeline.ts:13,37).
const IN = 'in'
const OUT = 'out'

/** Derive the boundary ports of a subgraph: every spec handle that has NO
 *  INTERNAL edge becomes an external macro port. Inputs first, then outputs,
 *  each in node-declaration order so the rendered handles are stable. */
export function deriveBoundaryPorts(
  subNodes: Node[],
  subEdges: Edge[],
): { inputs: MacroPort[]; outputs: MacroPort[] } {
  const inputs: MacroPort[] = []
  const outputs: MacroPort[] = []

  const hasInternalTarget = (nodeId: string, handle: string) =>
    subEdges.some((e) => e.target === nodeId && (e.targetHandle ?? IN) === handle)
  const hasInternalSource = (nodeId: string, handle: string) =>
    subEdges.some((e) => e.source === nodeId && (e.sourceHandle ?? OUT) === handle)

  for (const node of subNodes) {
    const spec = getNode(String(node.type))
    if (!spec) continue
    for (const p of spec.ports.inputs) {
      if (!hasInternalTarget(node.id, p.id)) {
        inputs.push(makePort(spec, node.id, p))
      }
    }
    for (const p of spec.ports.outputs) {
      if (!hasInternalSource(node.id, p.id)) {
        outputs.push(makePort(spec, node.id, p))
      }
    }
  }
  return { inputs, outputs }
}

function makePort(spec: NodeSpec, innerNodeId: string, port: PortDef): MacroPort {
  return {
    id: `${innerNodeId}:${port.id}`,
    label: `${spec.title} · ${port.label ?? port.id}`,
    kind: port.kind,
    innerNodeId,
    innerHandle: port.id,
  }
}

let macroSeq = 0

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'macro'
}

/** Build a MacroDef from a captured selection. `subNodes` should already be
 *  stripped of transient fields (className/selected) by the caller. */
export function buildMacroDef(name: string, subNodes: Node[], internalEdges: Edge[]): MacroDef {
  const { inputs, outputs } = deriveBoundaryPorts(subNodes, internalEdges)
  const id = `macro.${slugify(name)}-${Date.now().toString(36)}${(macroSeq++).toString(36)}`
  return {
    id,
    name,
    subgraph: { nodes: subNodes, edges: internalEdges },
    inputs,
    outputs,
    createdAt: Date.now(),
  }
}

/** One generic synthetic spec per macro — NOT a hand-written spec. External
 *  handles use the macro-port ids so a macro node maps 1:1 to its interior. */
export function makeMacroSpec(def: MacroDef): NodeSpec {
  return defineNode({
    type: def.id,
    category: 'custom',
    title: def.name,
    subtitle: `${def.subgraph.nodes.length} 节点`,
    icon: 'box',
    ports: {
      inputs: def.inputs.map((p) => ({ id: p.id, label: p.label, kind: p.kind })),
      outputs: def.outputs.map((p) => ({ id: p.id, label: p.label, kind: p.kind })),
    },
    render: () => createElement(MacroBody, { def }),
  })
}

// In-memory mirror of registered macro defs, keyed by def.id (= spec.type). The
// hot paths (flatten-on-run, double-click expand) read this instead of parsing
// localStorage on every call.
const MACRO_DEFS = new Map<string, MacroDef>()

/** Look up a registered macro def by id/type — in-memory, no localStorage. */
export function getMacroDef(id: string): MacroDef | undefined {
  return MACRO_DEFS.get(id)
}

/** Register (or overwrite) the synthetic spec for a macro. Idempotent by type. */
export function registerMacroSpec(def: MacroDef): NodeSpec {
  MACRO_DEFS.set(def.id, def)
  return registerNode(makeMacroSpec(def))
}

/** Replace one macro node with its subgraph, namespaced + offset to the macro
 *  slot, reconnecting incident crossing edges back onto the inner boundary
 *  handles. Pure: returns fresh arrays. Shared by double-click expand AND the
 *  run-time flattener (single source of truth). */
export function inlineMacro(
  nodes: Node[],
  edges: Edge[],
  macroNode: Node,
  def: MacroDef,
): { nodes: Node[]; edges: Edge[] } {
  // Namespace with the macro NODE-INSTANCE id (not the def id) so two instances
  // of the same macro on one canvas never collide.
  const ns = `${macroNode.id}__`
  const remap = (lid: string) => `${ns}${lid}`
  const at = macroNode.position ?? { x: 0, y: 0 }

  const children: Node[] = def.subgraph.nodes.map((n) => ({
    ...n,
    id: remap(n.id),
    position: {
      x: at.x + (n.position?.x ?? 0),
      y: at.y + (n.position?.y ?? 0),
    },
  }))

  const innerEdges: Edge[] = def.subgraph.edges.map((e) => ({
    ...e,
    id: remap(e.id ?? `${e.source}-${e.target}`),
    source: remap(e.source),
    target: remap(e.target),
  }))

  // Reconnect every edge that touched the macro node onto the inner handle the
  // synthetic port id encodes.
  const incident = edges.filter((e) => e.source === macroNode.id || e.target === macroNode.id)
  const reconnected: Edge[] = incident.map((e) => {
    if (e.target === macroNode.id) {
      const [innerId, innerH] = splitPort(e.targetHandle)
      return { ...e, target: remap(innerId), targetHandle: innerH }
    }
    const [innerId, innerH] = splitPort(e.sourceHandle)
    return { ...e, source: remap(innerId), sourceHandle: innerH }
  })

  const keptNodes = nodes.filter((n) => n.id !== macroNode.id)
  const keptEdges = edges.filter((e) => e.source !== macroNode.id && e.target !== macroNode.id)
  return {
    nodes: [...keptNodes, ...children],
    edges: [...keptEdges, ...innerEdges, ...reconnected],
  }
}

/** Split a synthetic macro-port id `innerNodeId:innerHandle` back into parts.
 *  Tolerates a literal handle id containing ':' by re-joining the tail. */
function splitPort(handle: string | null | undefined): [string, string] {
  const raw = String(handle ?? '')
  const idx = raw.indexOf(':')
  if (idx < 0) return [raw, IN]
  return [raw.slice(0, idx), raw.slice(idx + 1)]
}

/** Flatten ALL macro nodes back to atoms before a run. Loops (handles nested
 *  macros defensively even though create-time forbids nesting) with a guard. */
export function flattenForRun(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  let curN = nodes
  let curE = edges
  let guard = 0
  while (guard++ < 50) {
    const macroNode = curN.find((n) => getMacroDef(String(n.type)))
    if (!macroNode) break
    const def = getMacroDef(String(macroNode.type))
    if (!def) break
    const next = inlineMacro(curN, curE, macroNode, def)
    curN = next.nodes
    curE = next.edges
  }
  return { nodes: curN, edges: curE }
}
