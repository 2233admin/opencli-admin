// Collection Canvas palette (Plan IR issue 07): category -> node type ->
// Preset, keyboard-searchable via cmdk (already a dependency — CommandPalette
// uses the same `cmdk` package, see components/CommandPalette.tsx). Preset
// chips come exclusively from GET /api/v1/presets (issue 06) — nothing about
// a specific site/command is hardcoded here; only the three graph-node kinds
// (transform/merge/sink) are structural chrome, not channel data.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import { GripVertical, Search } from 'lucide-react'

import { listPresets } from '../api/endpoints'
import type { Preset } from '../api/types'
import { SOURCE_NODES } from '../node-kit'
import { CATEGORY_STYLE, iconByName } from '../node-kit/render/atoms'
import type { NodeCategory } from '../node-kit/spec'
import { presetMatchesQuery } from '../lib/planCanvasModel'

// Level-2 "node type" list — every real backend collection channel, taken
// straight from the node-kit SOURCE_NODES registry (frontend/src/node-kit/
// nodes/sources.tsx, one spec per backend/channels/* channel) rather than
// hand-listed here, per the issue's "categories/node types from the node-kit
// NodeSpec registry + channel types" instruction. `subtitle` on each spec IS
// the channel_type string (see sources.tsx: subtitle: 'rss', 'opencli', ...).
const CHANNEL_TYPES_FROM_REGISTRY: string[] = SOURCE_NODES.map((spec) => spec.subtitle ?? '').filter(Boolean)

// channel_type -> its source spec icon, so palette rows carry the same glyph
// the node shows on the canvas (visual continuity palette ↔ graph).
const SOURCE_ICON_BY_CHANNEL: Record<string, string | undefined> = Object.fromEntries(
  SOURCE_NODES.map((spec) => [spec.subtitle ?? '', spec.icon]),
)

export type PaletteDropPayload =
  | { kind: 'preset'; preset: Preset }
  | { kind: 'draft-channel'; channelType: string }
  | { kind: 'graph-node'; nodeKind: 'transform' | 'merge' | 'sink' }

export const PALETTE_DRAG_MIME = 'application/x-opencli-plan-canvas-palette'

const GRAPH_NODE_KINDS: Array<{
  nodeKind: 'transform' | 'merge' | 'sink'
  label: string
  hint: string
  icon: string
  category: NodeCategory
}> = [
  { nodeKind: 'transform', label: '变换', hint: 'dedupe / map / filter 等下游处理', icon: 'shuffle', category: 'transform' },
  { nodeKind: 'merge', label: '合并', hint: '合并多个上游分支', icon: 'git-merge', category: 'transform' },
  { nodeKind: 'sink', label: '汇', hint: '写入存储 / 下游 sink', icon: 'database', category: 'sink' },
]

interface PlanCanvasPaletteProps {
  onPick: (payload: PaletteDropPayload) => void
}

function serializePayload(payload: PaletteDropPayload): string {
  return JSON.stringify(payload)
}

export function parsePalettePayload(raw: string): PaletteDropPayload | null {
  try {
    return JSON.parse(raw) as PaletteDropPayload
  } catch {
    return null
  }
}

export function PlanCanvasPalette({ onPick }: PlanCanvasPaletteProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  const presetsQuery = useQuery({
    queryKey: ['plan-canvas', 'presets'],
    queryFn: listPresets,
    staleTime: 30_000,
  })
  const groupedByChannel = presetsQuery.data ?? {}

  // Union the registry's channel-type list with whatever channel_types the
  // presets endpoint actually returned (defensive: a channel could in theory
  // ship presets under a channel_type this frontend build's registry doesn't
  // know about yet) — every channel is browsable even with zero presets.
  const allChannelTypes = useMemo(() => {
    const set = new Set(CHANNEL_TYPES_FROM_REGISTRY)
    for (const channelType of Object.keys(groupedByChannel)) set.add(channelType)
    return [...set].sort()
  }, [groupedByChannel])

  const filteredByChannel = useMemo(() => {
    const result: Record<string, Preset[]> = {}
    for (const channelType of allChannelTypes) {
      const matches = (groupedByChannel[channelType] ?? []).filter((p) => presetMatchesQuery(p, query))
      const channelItselfMatches = presetMatchesQuery(
        { id: channelType, channel_type: channelType, node_type: `${channelType}_source`, label: channelType, description: '', params: {} },
        query,
      )
      if (matches.length > 0 || channelItselfMatches) result[channelType] = matches
    }
    return result
  }, [allChannelTypes, groupedByChannel, query])

  const channelTypes = Object.keys(filteredByChannel).sort()

  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-black/20">
      <p className="px-3 pb-1 pt-2 font-code text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
        {t('planCanvas.paletteTitle')}
      </p>
      <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col bg-transparent text-zinc-100">
        <div className="flex items-center gap-1.5 border-b border-white/8 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder={t('planCanvas.paletteSearchPlaceholder')}
            className="h-6 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-hidden placeholder:text-zinc-600"
          />
        </div>
        <Command.List className="thin-scrollbar flex-1 overflow-y-auto py-1">
          <Command.Empty className="px-3 py-4 text-center text-2xs text-zinc-600">
            {t('planCanvas.paletteEmpty')}
          </Command.Empty>

          {/* level 1: 数据源 category, level 2: channel_type (node type), level 3: Preset chips */}
          <Command.Group
            heading={t('planCanvas.paletteCategoryChannels')}
            className="px-1 text-3xs font-semibold uppercase tracking-wide text-zinc-600"
          >
            {channelTypes.map((channelType) => {
              const channelIcon = SOURCE_ICON_BY_CHANNEL[channelType] ?? 'plug'
              const presetCount = filteredByChannel[channelType].length
              return (
                <div key={channelType} className="mb-1.5">
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <span className="text-3xs font-semibold uppercase tracking-wide text-emerald-300/80">{channelType}</span>
                    {presetCount > 0 && (
                      <span className="rounded-full bg-emerald-400/10 px-1.5 font-code text-[9px] text-emerald-300/70">
                        {presetCount}
                      </span>
                    )}
                  </div>
                  {/* bare channel type (no Preset) — story 1: drag a source TYPE, presets
                   * (story 4) are the faster one-click path, not the only path. */}
                  <PaletteRow
                    label={`${channelType} (blank)`}
                    hint={t('planCanvas.inspectorChannelTypePlaceholder')}
                    value={`${channelType} blank empty custom`}
                    icon={channelIcon}
                    category="source"
                    payload={{ kind: 'draft-channel', channelType }}
                    onPick={onPick}
                  />
                  {filteredByChannel[channelType].map((preset) => (
                    <PaletteRow
                      key={preset.id}
                      label={preset.label}
                      hint={preset.description || preset.node_type}
                      value={`${channelType} ${preset.label} ${preset.description} ${preset.node_type}`}
                      icon={channelIcon}
                      category="source"
                      payload={{ kind: 'preset', preset }}
                      onPick={onPick}
                    />
                  ))}
                </div>
              )
            })}
          </Command.Group>

          {channelTypes.length === 0 && (
            <Command.Group
              heading={t('planCanvas.paletteCategoryChannels')}
              className="px-1 text-3xs font-semibold uppercase tracking-wide text-zinc-600"
            >
              <p className="px-3 py-1.5 text-2xs text-zinc-600">
                {presetsQuery.isError ? t('common.error') : t('planCanvas.paletteEmpty')}
              </p>
            </Command.Group>
          )}

          <Command.Group
            heading={t('planCanvas.paletteCategoryGraph')}
            className="px-1 pt-1 text-3xs font-semibold uppercase tracking-wide text-zinc-600"
          >
            {GRAPH_NODE_KINDS.filter((g) => presetMatchesQuery(
              { id: g.nodeKind, channel_type: '', node_type: g.nodeKind, label: g.label, description: g.hint, params: {} },
              query,
            )).map((g) => (
              <PaletteRow
                key={g.nodeKind}
                label={g.label}
                hint={g.hint}
                value={`${g.label} ${g.hint} ${g.nodeKind}`}
                icon={g.icon}
                category={g.category}
                payload={{ kind: 'graph-node', nodeKind: g.nodeKind }}
                onPick={onPick}
              />
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  )
}

function PaletteRow({
  label,
  hint,
  value,
  icon,
  category,
  payload,
  onPick,
}: {
  label: string
  hint: string
  value: string
  icon?: string
  category: NodeCategory
  payload: PaletteDropPayload
  onPick: (payload: PaletteDropPayload) => void
}) {
  const cat = CATEGORY_STYLE[category]
  const Icon = iconByName(icon)
  return (
    <Command.Item
      value={value}
      onSelect={() => onPick(payload)}
      title={`${label} — 拖入画布或点击添加`}
      className="group mx-1 flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/4 active:cursor-grabbing aria-selected:bg-sky-500/12"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_DRAG_MIME, serializePayload(payload))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <span className={['grid h-6 w-6 shrink-0 place-items-center rounded-md border', cat.chip].join(' ')}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-zinc-200">{label}</span>
        <span className="truncate text-3xs text-zinc-600">{hint}</span>
      </span>
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </Command.Item>
  )
}
