// Left palette rail for the 采集网络 (collection-network) canvas — issue:
// palette / drag-create. Same searchable-cmdk visual language as the plan
// editor's palette (see pages/PlanCanvasPalette.tsx — cmdk is already a
// dependency, CommandPalette uses the same package) so 总览 and 当前 Plan read
// as one family, per the visual-parity task. Still its own component:
// NetworkPage/ReactFlowTopologyCanvas own this file, node-kit is not touched.
//
// A palette item here is NOT a node-kit NodeSpec — it creates a real DataSource
// via the same createSource() mutation SourcesPage uses. Dropping/clicking never
// fabricates a node on the canvas; the canvas only shows what the next refetch
// confirms exists in the DB (topology queries already poll). Unlike the plan
// editor's palette (which lists Presets fetched from GET /api/v1/presets),
// there is nothing to fetch here — TOPOLOGY_PALETTE_SOURCES is the complete,
// static list of real backend channel types.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'
import { toast } from 'sonner'

import { createSource } from '../../api/endpoints'
import type { DataSource } from '../../api/types'
import ChannelConfigForm, { type ChannelType } from '../../components/ChannelConfigForm'
import { paletteDropToCreatePayload, TOPOLOGY_PALETTE_SOURCES, type PaletteChannelType, type PaletteSourceItem } from './topologyModel'

const DRAG_MIME = 'application/x-opencli-topology-palette'

interface TopologyPaletteProps {
  onCreated?: () => void
}

function sourceMatchesQuery(item: PaletteSourceItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
}

/** Left rail: searchable cmdk panel (same pattern as PlanCanvasPalette) —
 * click or drag a channel type onto the canvas to open the create-source
 * modal preseeded with that type. */
export function TopologyPalette({ onCreated }: TopologyPaletteProps) {
  const { t } = useTranslation()
  const [draftType, setDraftType] = useState<ChannelType | null>(null)
  const [query, setQuery] = useState('')

  const filtered = TOPOLOGY_PALETTE_SOURCES.filter((item) => sourceMatchesQuery(item, query))

  return (
    <>
      <div className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/20">
        <p className="px-3 pb-1 pt-2 font-code text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          {t('topology.paletteTitle')}
        </p>
        <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col bg-transparent text-zinc-100">
          <div className="flex items-center gap-1.5 border-b border-white/8 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={t('topology.paletteSearchPlaceholder')}
              className="h-6 min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 outline-hidden placeholder:text-zinc-600"
            />
          </div>
          <Command.List className="thin-scrollbar flex-1 overflow-y-auto py-1">
            <Command.Empty className="px-3 py-4 text-center text-[11px] text-zinc-600">
              {t('topology.paletteEmpty')}
            </Command.Empty>
            <Command.Group
              heading={t('topology.paletteCategorySources')}
              className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600"
            >
              {filtered.map((item) => (
                <PaletteRow key={item.type} item={item} onPick={() => setDraftType(item.type as ChannelType)} />
              ))}
            </Command.Group>
          </Command.List>
        </Command>
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

function PaletteRow({ item, onPick }: { item: PaletteSourceItem; onPick: () => void }) {
  return (
    <Command.Item
      value={`${item.label} ${item.hint} ${item.type}`}
      onSelect={onPick}
      className="mx-1 flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left aria-selected:bg-sky-500/15"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, item.type)
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <span className="truncate text-[12px] font-medium text-zinc-200">{item.label}</span>
      <span className="truncate text-[10px] text-zinc-600">{item.hint}</span>
    </Command.Item>
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
