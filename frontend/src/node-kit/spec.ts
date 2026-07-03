// @opencli/node-kit — L3 node contract (INCUBATING at frontend/src/node-kit/;
// extract to top-level NX lib `node-kit` (@opencli/node-kit) once stable).
//
// One serializable description of a node TYPE. Humans author via defineNode()
// in TS; agents emit the same shape as JSON. Both land in one registry and are
// rendered by one generic <KitNode>. The execution-engine surface (run / edges /
// RunContext) is DECLARED here from day one but intentionally NOT implemented
// yet — scope choice "A skeleton, reserve engine hooks". Adding the engine later
// must not change these types.
import type { ReactNode } from 'react'

export type NodeCategory =
  | 'source'
  | 'transform'
  | 'sink'
  | 'control'
  | 'display'
  | 'agent'
  | 'custom'

export interface PortDef {
  id: string
  label?: string
  /** free-form data kind for future edge type-checking (e.g. 'record', 'number') */
  kind?: string
  /** allow many connections on this port */
  multiple?: boolean
}

/** Zero-dependency, fully-serializable config field. Renders a form, validates,
 *  and exports to JSON-schema for agent authoring — no zod/external dep. */
export interface FieldDef {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select' | 'json'
  label?: string
  default?: unknown
  required?: boolean
  placeholder?: string
  /** for type: 'select' */
  options?: Array<{ value: string; label: string }>
}

export interface ConfigSchema {
  fields: FieldDef[]
}

export type ConfigValues = Record<string, unknown>

/** C0 Control Room v0 (docs/CONTROL_THEORY_ARCHITECTURE.md §0): the shape a
 *  node's `facts.__control` carries once a host wires up GET
 *  /sources/{id}/control-state polling for that node instance. One contract on
 *  NodeRenderContext.facts — every node type gets ControlBadge/
 *  SensorCoverageBadge for free by reading this key, instead of each node
 *  inventing its own health facts shape. Mirrors
 *  backend.schemas.control.SourceControlStateRead (see frontend/src/api/types.ts
 *  SourceControlState) minus the objective (not rendered on the node body).
 *  Absent (`undefined`) means "no control-state facts wired up for this node
 *  instance" — NOT the same as a source that returned control_state: null;
 *  render `undefined` as neutral, not as a health verdict either way. */
export interface ControlFacts {
  control_state: string | null
  confidence: 'high' | 'medium' | 'low' | null
  sensor_coverage: { run: boolean; cursor: boolean; freshness: boolean; error_kinds: boolean; odp: boolean } | null
  missing_signals: string[]
  error_rate?: number | null
  duplicate_rate?: number | null
  freshness_lag_seconds?: number | null
}

/** Context handed to a node's render(). UI-only; no execution state. */
export interface NodeRenderContext<C extends ConfigValues = ConfigValues> {
  id: string
  spec: NodeSpec<C>
  config: C
  selected: boolean
  /** live, node-instance-specific facts the host feeds in (status, counts, …).
   *  `facts.__control` is the well-known C0 control-state slot — see
   *  {@link ControlFacts}. */
  facts: Record<string, unknown>
  emit: (op: string, payload?: unknown) => void
}

export interface NodeOp<C extends ConfigValues = ConfigValues> {
  id: string
  label: string
  icon?: string
  danger?: boolean
  /** declarative action — usually calls a backend API. Reused across systems. */
  run: (ctx: NodeRenderContext<C>) => void | Promise<void>
}

// ── RESERVED execution-engine surface (declared, not implemented) ────────────
/** A value flowing along an edge. Reserved for the future dataflow engine. */
export interface EdgeValue {
  port: string
  value: unknown
}
/** Context for the future run(). Inputs arrive per input-port; outputs returned. */
export interface NodeRunContext<C extends ConfigValues = ConfigValues> {
  id: string
  config: C
  inputs: Record<string, unknown>
  signal?: AbortSignal
}
export type RunResult = Record<string, unknown>
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeSpec<C extends ConfigValues = ConfigValues> {
  /** unique type id, e.g. 'source.http', 'transform.filter', 'collection.task' */
  type: string
  category: NodeCategory
  title: string
  subtitle?: string
  /** lucide icon name, e.g. 'database' */
  icon?: string
  ports: { inputs: PortDef[]; outputs: PortDef[] }
  config?: ConfigSchema
  ops?: NodeOp<C>[]
  /** override the auto-render; omit to get the default spec-driven body */
  render?: (ctx: NodeRenderContext<C>) => ReactNode
  /** RESERVED: execution. Present in the contract; the engine that calls it
   *  does not exist yet. L3 atoms may define it; nothing runs it today. */
  run?: (ctx: NodeRunContext<C>) => Promise<RunResult>
}

/** The instance a graph/host stores: which spec + its config + live facts. */
export interface NodeInstance<C extends ConfigValues = ConfigValues> {
  id: string
  type: string
  config: C
  facts?: Record<string, unknown>
  position?: { x: number; y: number }
}
