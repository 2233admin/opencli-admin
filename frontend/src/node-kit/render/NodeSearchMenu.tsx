// ComfyUI-style "add node" search popup. Triggered by double-click / Tab / Ctrl+A
// at the cursor; type to filter the registry, Enter/click to drop the node there.
import { useMemo, useState } from 'react'

import type { NodeSpec } from '../spec'
import { iconByName } from './atoms'

export function NodeSearchMenu({
  x,
  y,
  specs,
  onPick,
  onClose,
}: {
  x: number
  y: number
  specs: NodeSpec[]
  onPick: (type: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return specs
    return specs.filter((s) => `${s.title} ${s.type} ${s.category} ${s.subtitle ?? ''}`.toLowerCase().includes(k))
  }, [q, specs])

  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="absolute z-50 w-64 overflow-hidden rounded-lg border border-white/15 bg-[#0c0d10] shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter' && filtered[0]) onPick(filtered[0].type)
          }}
          placeholder="搜索节点…"
          className="w-full border-b border-white/10 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-hidden placeholder:text-zinc-600"
        />
        <div className="max-h-64 overflow-auto py-1">
          {filtered.length === 0 && <div className="px-3 py-2 text-xs text-zinc-600">无匹配节点</div>}
          {filtered.map((s) => {
            const Icon = iconByName(s.icon)
            return (
              <button
                key={s.type}
                type="button"
                onClick={() => onPick(s.type)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-300 transition hover:bg-sky-500/10 hover:text-white"
              >
                <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
                <span className="flex-1 truncate">{s.title}</span>
                <span className="font-code text-[10px] text-zinc-600">{s.type}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
