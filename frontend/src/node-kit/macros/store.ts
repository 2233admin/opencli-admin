// localStorage-only macro persistence (MVP, no backend). Mirrors the defensive
// try/catch + per-entry validation posture of loadWorkflowLayout
// (collectionWorkflowModel.ts:325-360): a corrupt entry must never crash the
// workbench. Stores the FULL MacroDef list under one key.
import type { Node } from '@xyflow/react'

import type { MacroDef } from './macro'

const KEY = 'node-kit:macros'

/** Shallow shape guard so a malformed stored blob can't poison the registry. */
function isMacroDef(v: unknown): v is MacroDef {
  if (!v || typeof v !== 'object') return false
  const m = v as Partial<MacroDef>
  return (
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    !!m.subgraph &&
    Array.isArray(m.subgraph.nodes) &&
    Array.isArray(m.subgraph.edges) &&
    Array.isArray(m.inputs) &&
    Array.isArray(m.outputs)
  )
}

export function listMacros(storage: Storage = localStorage): MacroDef[] {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return []
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter(isMacroDef) : []
  } catch {
    return []
  }
}

/** Strip transient/runtime-only node fields before persisting so saved defs
 *  never carry collision ghost classes ('kit-collide') or stale selection. */
function stripTransientNode(n: Node): Node {
  const { className: _className, selected: _selected, dragging: _dragging, ...rest } = n
  return rest as Node
}

function sanitizeForSave(def: MacroDef): MacroDef {
  return {
    ...def,
    subgraph: {
      nodes: def.subgraph.nodes.map(stripTransientNode),
      edges: def.subgraph.edges,
    },
  }
}

export function saveMacro(def: MacroDef, storage: Storage = localStorage): void {
  try {
    const all = listMacros(storage).filter((m) => m.id !== def.id)
    all.push(sanitizeForSave(def))
    storage.setItem(KEY, JSON.stringify(all))
  } catch (e) {
    // localStorage unavailable / quota — fail soft; the macro still lives in-session
    // (registered in memory), it just won't survive a reload.
    console.warn('[node-kit] saveMacro: localStorage write failed', e)
  }
}

export function getMacro(id: string, storage: Storage = localStorage): MacroDef | undefined {
  return listMacros(storage).find((m) => m.id === id)
}

export function deleteMacro(id: string, storage: Storage = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(listMacros(storage).filter((m) => m.id !== id)))
  } catch {
    // ignore — see saveMacro.
  }
}
