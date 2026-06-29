// The one registry. Both authoring paths land here: humans via registerNode,
// agents via instantiate(json). Framework-agnostic (no React) so the contract
// layer stays portable; the xyflow binding lives in render/nodeTypes.tsx.
import { parseConfig, type ConfigParseResult } from './define'
import type { ConfigValues, NodeCategory, NodeInstance, NodeSpec } from './spec'

const REGISTRY = new Map<string, NodeSpec<any>>()

export function registerNode<C extends ConfigValues>(spec: NodeSpec<C>): NodeSpec<C> {
  REGISTRY.set(spec.type, spec)
  return spec
}

export function registerNodes(specs: NodeSpec<any>[]): void {
  for (const s of specs) registerNode(s)
}

export function getNode(type: string): NodeSpec | undefined {
  return REGISTRY.get(type)
}

export function listNodes(category?: NodeCategory): NodeSpec[] {
  const all = [...REGISTRY.values()]
  return category ? all.filter((s) => s.category === category) : all
}

export function hasNode(type: string): boolean {
  return REGISTRY.has(type)
}

/** Agent authoring path: turn a raw `{ type, config }` blob into a validated
 *  NodeInstance using the registered spec. Returns null for unknown types. */
export function instantiate(
  json: { type: string; id?: string; config?: ConfigValues; position?: { x: number; y: number } },
): { instance: NodeInstance; parse: ConfigParseResult } | null {
  const spec = REGISTRY.get(json.type)
  if (!spec) return null
  const parse = parseConfig(spec.config, json.config ?? {})
  const instance: NodeInstance = {
    id: json.id ?? `${json.type}:${REGISTRY.size}:${Object.keys(json.config ?? {}).length}`,
    type: json.type,
    config: parse.values,
    position: json.position,
  }
  return { instance, parse }
}

/** test-only / hot-reload safety */
export function _clearRegistry(): void {
  REGISTRY.clear()
}
