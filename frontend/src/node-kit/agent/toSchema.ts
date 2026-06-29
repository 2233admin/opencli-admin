// Agent authoring bridge. Turns registered node specs into JSON-schema so an
// agent can be told "here are the node types and their params" and emit a plain
// `{ type, config }` blob — which registry.instantiate() then validates. This is
// how "agents develop nodes" without writing code. Feed nodeCatalogForAgent()
// into the backend chat.py TOOLS (e.g. a `create_node` tool).
import { listNodes } from '../registry'
import type { ConfigSchema, FieldDef, NodeSpec } from '../spec'

interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export function configToJsonSchema(config: ConfigSchema | undefined): JsonSchema {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const f of config?.fields ?? []) {
    properties[f.key] = fieldToJsonSchema(f)
    if (f.required) required.push(f.key)
  }
  return required.length ? { type: 'object', properties, required } : { type: 'object', properties }
}

function fieldToJsonSchema(f: FieldDef): Record<string, unknown> {
  const base: Record<string, unknown> = { description: f.label ?? f.key }
  switch (f.type) {
    case 'number':
      return { ...base, type: 'number' }
    case 'boolean':
      return { ...base, type: 'boolean' }
    case 'select':
      return { ...base, type: 'string', enum: (f.options ?? []).map((o) => o.value) }
    case 'json':
      return { ...base, type: ['object', 'array', 'string', 'number', 'boolean', 'null'] }
    default:
      return { ...base, type: 'string' }
  }
}

export interface AgentNodeDescriptor {
  type: string
  title: string
  category: string
  subtitle?: string
  config: JsonSchema
}

export function nodeToAgentDescriptor(spec: NodeSpec): AgentNodeDescriptor {
  return {
    type: spec.type,
    title: spec.title,
    category: spec.category,
    subtitle: spec.subtitle,
    config: configToJsonSchema(spec.config),
  }
}

/** Full catalog of registered node types for the agent to choose + author from. */
export function nodeCatalogForAgent(): AgentNodeDescriptor[] {
  return listNodes().map(nodeToAgentDescriptor)
}
