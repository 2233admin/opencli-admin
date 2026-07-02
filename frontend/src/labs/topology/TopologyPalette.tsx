// Left palette rail for the 采集网络 (collection-network) canvas — issue:
// palette / drag-create. Mirrors node-kit's NodeWorkbench left rail visually
// (see src/node-kit/render/NodeWorkbench.tsx ~L370) but is its own component:
// NetworkPage/ReactFlowTopologyCanvas own this file, node-kit is not touched.
//
// A palette item here is NOT a node-kit NodeSpec — it creates a real DataSource
// via the same createSource() mutation SourcesPage uses. Dropping/clicking never
// fabricates a node on the canvas; the canvas only shows what the next refetch
// confirms exists in the DB (topology queries already poll).
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { createSource } from '../../api/endpoints'
import type { DataSource } from '../../api/types'
import ChannelConfigForm, { type ChannelType } from '../../components/ChannelConfigForm'
import { cn } from '../../lib/utils'
import { paletteDropToCreatePayload, TOPOLOGY_PALETTE_SOURCES, type PaletteChannelType, type PaletteSourceItem } from './topologyModel'

const DRAG_MIME = 'application/x-opencli-topology-palette'

interface TopologyPaletteProps {
  onCreated?: () => void
}

/** Left rail: click or drag a channel type onto the canvas to open the
 * create-source modal preseeded with that type. */
export function TopologyPalette({ onCreated }: TopologyPaletteProps) {
  const [draftType, setDraftType] = useState<ChannelType | null>(null)

  return (
    <>
      <div className="flex w-40 shrink-0 flex-col overflow-auto border-r border-white/8 bg-black/20 py-2">
        <p className="px-3 pb-1 font-code text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          新建采集源 · 拖入或点按
        </p>
        {TOPOLOGY_PALETTE_SOURCES.map((item) => (
          <PaletteEntry key={item.type} item={item} onClick={() => setDraftType(item.type as ChannelType)} />
        ))}
      </div>

      {draftType && (
        <CreateSourceModal
          initialType={draftType}
          onClose={() => setDraftType(null)}
          onCreated={() => {
            setDraftType(null)
            onCreated?.()
          }}
        />
      )}
    </>
  )
}

function PaletteEntry({ item, onClick }: { item: PaletteSourceItem; onClick: () => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, item.type)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onClick}
      title={item.hint}
      className={cn(
        'mx-2 mb-1 flex flex-col items-start gap-0.5 rounded-md border border-white/8 bg-white/3 px-2.5 py-2 text-left transition',
        'hover:border-white/20 hover:bg-white/6 active:scale-[0.98]',
        'cursor-grab active:cursor-grabbing',
      )}
    >
      <span className="font-code text-[11px] font-semibold text-zinc-200">{item.label}</span>
      <span className="truncate text-[10px] text-zinc-600">{item.hint}</span>
    </button>
  )
}

/** Drop target overlay for the canvas area — reads the palette drag MIME type
 * and opens the create modal, same as clicking a palette entry. Kept separate
 * from TopologyPalette so NetworkPage can wrap the canvas <div> with it
 * without changing ReactFlowTopologyCanvas (which this task must not fold
 * DOM-drop concerns into, since node positions there are DB-derived only). */
export function TopologyCanvasDropZone({
  children,
  onCreated,
}: {
  children: React.ReactNode
  onCreated?: () => void
}) {
  const [draftType, setDraftType] = useState<ChannelType | null>(null)
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className="relative h-full w-full"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(DRAG_MIME)
        if (!type) return
        e.preventDefault()
        setDragOver(false)
        setDraftType(type as ChannelType)
      }}
    >
      {children}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-md border-2 border-dashed border-sky-400/60 bg-sky-400/4" />
      )}
      {draftType && (
        <CreateSourceModal
          initialType={draftType}
          onClose={() => setDraftType(null)}
          onCreated={() => {
            setDraftType(null)
            onCreated?.()
          }}
        />
      )}
    </div>
  )
}

/** Minimal create-source modal. SourcesPage's own SourceModal is not exported
 * (module-private in pages/SourcesPage.tsx, a file this task does not own), so
 * this is a smaller purpose-built equivalent: same real ChannelConfigForm +
 * createSource() mutation, preseeded from the palette drop/click, control-room
 * visual language (border-white/[0.08], bg-black/20+zinc-950, font-code labels). */
function CreateSourceModal({
  initialType,
  onClose,
  onCreated,
}: {
  initialType: ChannelType
  onClose: () => void
  onCreated: () => void
}) {
  const qc = useQueryClient()
  // ChannelType (ChannelConfigForm) and PaletteChannelType (topologyModel) are
  // the same literal union kept as two separate types across an ownership
  // boundary (see topologyModel.ts comment) — safe to widen here.
  const seed = paletteDropToCreatePayload(initialType as PaletteChannelType)
  const [name, setName] = useState(seed.name ?? initialType)
  const [config, setConfig] = useState<Record<string, unknown>>((seed.channel_config as Record<string, unknown>) ?? {})

  const createMut = useMutation({
    mutationFn: (data: Partial<DataSource>) => createSource(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network', 'sources'] })
      qc.invalidateQueries({ queryKey: ['sources'] })
      toast.success('采集节点已创建')
      onCreated()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '创建失败'),
  })

  const label = TOPOLOGY_PALETTE_SOURCES.find((i) => i.type === initialType)?.label ?? initialType

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-white/8 bg-zinc-950 shadow-2xl">
        <div className="border-b border-white/8 p-5">
          <p className="font-code text-[10px] uppercase tracking-[0.14em] text-zinc-600">NEW NODE</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-50">新建 {label} 采集节点</h2>
          <p className="mt-1 text-xs text-zinc-500">从采集网络画布拖入创建 — 真实数据源，不是画布上的临时图形。</p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label htmlFor="topology-palette-name" className="mb-1 block font-code text-[10px] uppercase tracking-widest text-zinc-500">
              名称
            </label>
            <input
              id="topology-palette-name"
              className="w-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-hidden transition-colors placeholder:text-zinc-600 focus:border-primary-500/70 focus:ring-2 focus:ring-primary-500/20"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-source"
            />
          </div>
          <div>
            <p className="mb-1 block font-code text-[10px] uppercase tracking-widest text-zinc-500">配置</p>
            <div className="border border-white/10 bg-black/25 p-4">
              <ChannelConfigForm channelType={initialType} config={config} onChange={setConfig} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-white/8 p-5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-md border border-white/12 bg-white/4 px-4 text-xs font-semibold text-zinc-200 hover:border-white/24 hover:bg-white/8"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!name.trim() || createMut.isPending}
            onClick={() =>
              createMut.mutate({
                name: name.trim(),
                channel_type: initialType,
                channel_config: config,
                enabled: true,
                tags: [],
              })
            }
            className="inline-flex h-9 items-center rounded-md border border-sky-500/40 bg-sky-500/10 px-4 text-xs font-semibold text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMut.isPending ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
