// The one generic renderer. Give it a NodeSpec + instance config/facts and it
// draws a complete node — header, ports, body, ops — with zero per-node React.
// spec.render() overrides the auto-body when a node needs something custom.
import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'

import type { ConfigValues, NodeRenderContext, NodeSpec } from '../spec'
import type { RunLogEntry } from '../runtime/runLog'
import { NodeField, NodeFieldEdit, NodeHeader, NodeOpButton, NodePort } from './atoms'

export interface KitNodeData<C extends ConfigValues = ConfigValues> {
  config: C
  facts?: Record<string, unknown>
  /** live execution state for this node instance, set by the host (NodeWorkbench)
   *  from its runState map during/after a runGraph() call. Absent = never run
   *  (or state was cleared for a new run) — renders as the normal idle look. */
  runState?: RunLogEntry
}

// Border/ring per execution state — 'queued' reads dim/inert, 'running' pulses
// amber (in-flight), 'success'/'error' land on a static emerald/red border so
// the outcome is legible without re-reading the run log panel.
const RUN_STATE_BORDER: Record<RunLogEntry['state'], string> = {
  queued: 'border-zinc-700/60',
  running: 'border-amber-400/70 animate-pulse',
  success: 'border-emerald-500/70',
  error: 'border-red-500/70',
  skipped: 'border-zinc-700/40',
}

export function KitNode<C extends ConfigValues = ConfigValues>({
  spec,
  id,
  data,
  selected,
  hideOps,
}: {
  spec: NodeSpec<C>
  id: string
  data: KitNodeData<C>
  selected?: boolean
  /** Observation-only surfaces (总览 topology overview) show status, not
   *  mutation buttons — spec.ops (启停/测连通/采集…) render nowhere on the
   *  card; those same actions live in the inspector drawer instead. The
   *  editable Plan canvas (当前 Plan lens) never sets this, so its cards keep
   *  their ops exactly as before. */
  hideOps?: boolean
}) {
  const { updateNodeData } = useReactFlow()
  const config = (data.config ?? {}) as C
  const facts = data.facts ?? {}
  const runState = data.runState

  // Inline config edit: write the changed field back onto this node's data.config.
  const setField = useCallback(
    (key: string, value: unknown) => {
      updateNodeData(id, { config: { ...(data.config ?? {}), [key]: value } })
    },
    [updateNodeData, id, data.config],
  )

  const ctx: NodeRenderContext<C> = {
    id,
    spec,
    config,
    selected: Boolean(selected),
    facts,
    emit: () => {},
  }

  const runBorder = runState ? RUN_STATE_BORDER[runState.state] : null

  return (
    <div
      style={{ width: 248 }}
      title={runState?.state === 'error' ? runState.detail.errorMessage : undefined}
      className={[
        'relative rounded-lg border bg-ops-panel/95 px-3 py-3 text-left shadow-xl backdrop-blur-sm transition-colors',
        runBorder ?? (selected ? 'border-sky-500 ring-2 ring-sky-500/30' : 'border-white/12 hover:border-white/30'),
        runBorder && selected ? 'ring-2 ring-sky-500/30' : '',
      ].join(' ')}
    >
      {spec.ports.inputs.map((p) => (
        <NodePort key={`in-${p.id}`} port={p} side="input" />
      ))}
      {spec.ports.outputs.map((p) => (
        <NodePort key={`out-${p.id}`} port={p} side="output" />
      ))}

      <div className="flex items-start justify-between gap-1.5">
        <NodeHeader icon={spec.icon} title={spec.title} subtitle={spec.subtitle} />
        {runState?.state === 'success' && runState.detail.durationMs != null && (
          <span className="shrink-0 rounded-xs border border-emerald-500/35 bg-emerald-500/10 px-1 py-0.5 font-code text-[9px] text-emerald-200">
            {runState.detail.durationMs}ms
          </span>
        )}
        {runState?.state === 'error' && (
          <span className="shrink-0 rounded-xs border border-red-500/35 bg-red-500/10 px-1 py-0.5 font-code text-[9px] text-red-200">
            ERR
          </span>
        )}
      </div>

      <div className="mt-2.5">
        {spec.render ? (
          spec.render(ctx)
        ) : (
          <AutoBody spec={spec} config={config} facts={facts} onField={setField} />
        )}
      </div>

      {!hideOps && spec.ops && spec.ops.length > 0 && (
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
  onField,
}: {
  spec: NodeSpec<C>
  config: C
  facts: Record<string, unknown>
  onField: (key: string, value: unknown) => void
}) {
  const fields = spec.config?.fields ?? []
  const factRows = Object.entries(facts)

  if (fields.length === 0 && factRows.length === 0) {
    return <div className="text-2xs text-zinc-600">{spec.category}</div>
  }
  return (
    <div className="grid gap-1.5">
      {fields.map((f) => (
        <NodeFieldEdit key={f.key} field={f} value={config[f.key]} onChange={(v) => onField(f.key, v)} />
      ))}
      {factRows.slice(0, 5).map(([k, v]) => (
        <NodeField key={k} label={k} value={formatValue(v)} />
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
