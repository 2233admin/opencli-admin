// The one generic renderer. Give it a NodeSpec + instance config/facts and it
// draws a complete node — header, ports, body, ops — with zero per-node React.
// spec.render() overrides the auto-body when a node needs something custom.
import type { ConfigValues, NodeRenderContext, NodeSpec } from '../spec'
import { NodeField, NodeHeader, NodeOpButton, NodePort } from './atoms'

export interface KitNodeData<C extends ConfigValues = ConfigValues> {
  config: C
  facts?: Record<string, unknown>
}

export function KitNode<C extends ConfigValues = ConfigValues>({
  spec,
  id,
  data,
  selected,
}: {
  spec: NodeSpec<C>
  id: string
  data: KitNodeData<C>
  selected?: boolean
}) {
  const config = (data.config ?? {}) as C
  const facts = data.facts ?? {}

  const ctx: NodeRenderContext<C> = {
    id,
    spec,
    config,
    selected: Boolean(selected),
    facts,
    emit: () => {},
  }

  return (
    <div
      style={{ width: 248 }}
      className={[
        'relative rounded-lg border bg-[#0a0a0c]/95 px-3 py-3 text-left shadow-xl backdrop-blur transition-colors',
        selected ? 'border-sky-500 ring-2 ring-sky-500/30' : 'border-white/[0.12] hover:border-white/30',
      ].join(' ')}
    >
      {spec.ports.inputs.map((p) => (
        <NodePort key={`in-${p.id}`} port={p} side="input" />
      ))}
      {spec.ports.outputs.map((p) => (
        <NodePort key={`out-${p.id}`} port={p} side="output" />
      ))}

      <NodeHeader icon={spec.icon} title={spec.title} subtitle={spec.subtitle} />

      <div className="mt-2.5">
        {spec.render ? (
          spec.render(ctx)
        ) : (
          <AutoBody spec={spec} config={config} facts={facts} />
        )}
      </div>

      {spec.ops && spec.ops.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {spec.ops.map((op) => (
            <NodeOpButton
              key={op.id}
              label={op.label}
              icon={op.icon}
              danger={op.danger}
              onClick={() => void op.run(ctx)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Default body when a spec has no render(): show config + facts as field rows.
function AutoBody<C extends ConfigValues>({
  spec,
  config,
  facts,
}: {
  spec: NodeSpec<C>
  config: C
  facts: Record<string, unknown>
}) {
  const rows = [
    ...(spec.config?.fields ?? []).map((f) => ({
      label: f.label ?? f.key,
      value: formatValue(config[f.key]),
    })),
    ...Object.entries(facts).map(([k, v]) => ({ label: k, value: formatValue(v) })),
  ].slice(0, 5)

  if (rows.length === 0) {
    return <div className="text-[11px] text-zinc-600">{spec.category}</div>
  }
  return (
    <div className="grid gap-1.5">
      {rows.map((r, i) => (
        <NodeField key={i} label={r.label} value={r.value} />
      ))}
    </div>
  )
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
