// defineNode — the human authoring entry. Identity + light normalization so a
// spec is complete and safe to register. Agents skip this and emit raw JSON that
// registry.instantiate() validates against the registered spec.
import type { ConfigSchema, ConfigValues, NodeSpec } from './spec'

export function defineNode<C extends ConfigValues = ConfigValues>(spec: NodeSpec<C>): NodeSpec<C> {
  if (!spec.type) throw new Error('defineNode: spec.type is required')
  return {
    ...spec,
    ports: { inputs: spec.ports?.inputs ?? [], outputs: spec.ports?.outputs ?? [] },
    ops: spec.ops ?? [],
  }
}

export interface ConfigParseResult<C extends ConfigValues = ConfigValues> {
  values: C
  errors: Record<string, string>
  ok: boolean
}

/** Validate + coerce a (possibly agent-supplied) config blob against a schema.
 *  Zero-dependency; fills defaults, coerces primitive types, checks required. */
export function parseConfig<C extends ConfigValues = ConfigValues>(
  schema: ConfigSchema | undefined,
  input: ConfigValues = {},
): ConfigParseResult<C> {
  const values: ConfigValues = {}
  const errors: Record<string, string> = {}
  for (const f of schema?.fields ?? []) {
    let v = input[f.key] ?? f.default
    if (v === undefined || v === '') {
      if (f.required) errors[f.key] = `${f.label ?? f.key} 必填`
      values[f.key] = f.default ?? defaultForType(f.type)
      continue
    }
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v)
        if (Number.isNaN(n)) errors[f.key] = `${f.label ?? f.key} 必须是数字`
        v = Number.isNaN(n) ? 0 : n
        break
      }
      case 'boolean':
        v = v === true || v === 'true'
        break
      case 'json':
        if (typeof v === 'string') {
          try {
            v = JSON.parse(v)
          } catch {
            errors[f.key] = `${f.label ?? f.key} 不是合法 JSON`
          }
        }
        break
      default:
        v = String(v)
    }
    values[f.key] = v
  }
  return { values: values as C, errors, ok: Object.keys(errors).length === 0 }
}

function defaultForType(t: string): unknown {
  switch (t) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'json':
      return null
    default:
      return ''
  }
}
