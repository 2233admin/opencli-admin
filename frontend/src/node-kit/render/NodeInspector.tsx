// Right-side property panel. When ONE node is selected the workbench shows this:
// the node's full config as a roomy editable form (the same NodeFieldEdit controls
// as the inline body, just bigger and always-visible). Writes go back through the
// host's updateNodeData, so panel + inline edits stay in sync.
import type { Node } from '@xyflow/react'

import { getNode } from '../registry'
import type { ConfigValues } from '../spec'
import { NodeFieldEdit } from './atoms'

export function NodeInspector({
  node,
  onField,
}: {
  node: Node
  onField: (key: string, value: unknown) => void
}) {
  const spec = getNode(String(node.type))
  const config = ((node.data as { config?: ConfigValues })?.config ?? {}) as ConfigValues
  const fields = spec?.config?.fields ?? []

  return (
    <div className="w-64 shrink-0 overflow-auto border-l border-white/10 bg-[#0b0c0e] p-3">
      <p className="pb-2 font-telemetry text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
        属性
      </p>
      <div className="mb-3 border-b border-white/6 pb-2.5">
        <div className="truncate text-sm font-semibold text-white" title={spec?.title}>
          {spec?.title ?? String(node.type)}
        </div>
        <div className="truncate text-[11px] text-zinc-500">{spec?.subtitle ?? String(node.type)}</div>
      </div>
      {fields.length === 0 ? (
        <div className="text-[11px] text-zinc-600">此节点无可配置字段</div>
      ) : (
        <div className="grid gap-2.5">
          {fields.map((f) => (
            <NodeFieldEdit key={f.key} field={f} value={config[f.key]} onChange={(v) => onField(f.key, v)} />
          ))}
        </div>
      )}
    </div>
  )
}
