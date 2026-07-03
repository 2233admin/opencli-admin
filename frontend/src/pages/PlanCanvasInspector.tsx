// Collection Canvas inspector (Plan IR issue 07): selecting a node opens this
// panel. Two modes for a source node — materialize a Draft Source Node into a
// real Data Source (POST /sources, then bind source_id into the node), or
// edit an already-materialized source's config (PATCH /sources/{id}). Forms
// live ONLY here (issue 07 acceptance criterion: "forms live only in the
// inspector") — reuses the existing ChannelConfigForm component verbatim, the
// same per-channel bodies SourcesPage/TopologyPalette already use.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { X } from 'lucide-react'

import { createSource, getSource, updateSource } from '../api/endpoints'
import type { PlanNode } from '../api/types'
import Card from '../components/Card'
import ChannelConfigForm, { type ChannelType } from '../components/ChannelConfigForm'
import { getNode, NodeBadge } from '../node-kit'
import { CATEGORY_STYLE, iconByName } from '../node-kit/render/atoms'
import type { NodeCategory } from '../node-kit/spec'
import { isDraftSourceNode } from '../lib/planCanvasModel'

const KNOWN_CHANNEL_TYPES: ChannelType[] = ['opencli', 'rss', 'api', 'web_scraper', 'crawl4ai', 'cli', 'skill']

// Map a PlanNode's raw kind to a node-kit category when the registry has no
// spec for its type (draft / graph nodes carry a bare kind string as type).
const KIND_CATEGORY: Record<string, NodeCategory> = {
  source: 'source',
  transform: 'transform',
  merge: 'transform',
  sink: 'sink',
}

/** Resolve the category + icon so the inspector header mirrors the canvas card. */
function resolveNodeVisual(node: PlanNode): { category: NodeCategory; icon?: string } {
  const spec = getNode(String(node.type))
  if (spec) return { category: spec.category, icon: spec.icon }
  return { category: KIND_CATEGORY[node.kind] ?? 'custom' }
}

interface PlanCanvasInspectorProps {
  node: PlanNode
  errors: string[]
  onClose: () => void
  onDetach: () => void
  /** Called once materialize succeeds — the caller re-types this node onto
   * source.<channel_type> and flips draft=false/source_id=sourceId onto the
   * PlanNode (planCanvasModel.materializeDraftNode). */
  onMaterialized: (sourceId: string) => void
  /** Called on every param edit (draft or materialized) so the canvas node's
   * live params (and hence save payload) stay in sync as the operator types —
   * mirrors NodeWorkbench's setSelectedField -> updateNodeData convention. */
  onParamsChange: (params: Record<string, unknown>) => void
}

export function PlanCanvasInspector({
  node,
  errors,
  onClose,
  onDetach,
  onMaterialized,
  onParamsChange,
}: PlanCanvasInspectorProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isDraft = isDraftSourceNode(node)
  const channelType = (node.params.channel_type as string) ?? ''
  const [name, setName] = useState(node.label || channelType || 'source')

  // Only fetch the live source record for a MATERIALIZED node — a draft has
  // no source_id yet, so there is nothing to fetch (params already live on
  // the PlanNode itself for a draft).
  const sourceQuery = useQuery({
    queryKey: ['plan-canvas', 'source', node.source_id],
    queryFn: () => getSource(node.source_id as string),
    enabled: Boolean(node.source_id) && !isDraft,
  })

  const materializeMut = useMutation({
    mutationFn: () =>
      createSource({
        name: name.trim() || channelType || 'source',
        channel_type: channelType as ChannelType,
        channel_config: node.params,
        enabled: true,
        tags: [],
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      toast.success(t('planCanvas.inspectorMaterializeSuccess'))
      onMaterialized(created.id)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('planCanvas.inspectorMaterializeFailed')),
  })

  const updateMut = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      updateSource(node.source_id as string, { channel_config: config }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan-canvas', 'source', node.source_id] })
      qc.invalidateQueries({ queryKey: ['sources'] })
      toast.success(t('planCanvas.inspectorUpdateSuccess'))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('planCanvas.inspectorUpdateFailed')),
  })

  const isKnownChannel = KNOWN_CHANNEL_TYPES.includes(channelType as ChannelType)
  const visual = resolveNodeVisual(node)
  const cat = CATEGORY_STYLE[visual.category]
  const HeaderIcon = iconByName(visual.icon)

  return (
    <Card padding={false} className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-0 border-l border-white/10 bg-ops-panel">
      <div className="relative flex items-start justify-between gap-2 border-b border-white/8 px-4 py-3">
        <div className={['absolute inset-x-0 top-0 h-0.5', cat.bar].join(' ')} aria-hidden />
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={['mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border', cat.chip].join(' ')}>
            <HeaderIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="telemetry-label">{t('planCanvas.inspectorTitle')}</p>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-white">{node.label || node.id}</h2>
            <p className="truncate text-2xs text-zinc-500">
              <span className={cat.label}>{cat.name}</span> · {node.type}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('common.cancel')}
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/12 bg-black/60 text-zinc-400 hover:border-white/[0.28] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {errors.length > 0 && (
        <div className="grid gap-1 border-b border-red-500/20 bg-red-500/6 px-4 py-2.5">
          {errors.map((message, i) => (
            <NodeBadge key={i} tone="danger">
              {message}
            </NodeBadge>
          ))}
        </div>
      )}

      <div className="thin-scrollbar flex-1 space-y-4 overflow-auto px-4 py-4">
        {node.kind !== 'source' ? (
          <p className="text-xs text-zinc-500">{t('planCanvas.inspectorNonSourceHint')}</p>
        ) : isDraft ? (
          <>
            <p className="text-2xs font-semibold uppercase tracking-wide text-amber-300/80">
              {t('planCanvas.inspectorDraftHeading')}
            </p>
            <p className="text-2xs text-zinc-500">{t('planCanvas.inspectorDraftHint')}</p>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300" htmlFor="plan-canvas-source-name">
                {t('common.name')}
              </label>
              <input
                id="plan-canvas-source-name"
                className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-hidden focus:border-primary-500/60 focus:ring-2 focus:ring-primary-500/30"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300" htmlFor="plan-canvas-channel-type">
                {t('planCanvas.inspectorChannelTypeLabel')}
              </label>
              <select
                id="plan-canvas-channel-type"
                className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-hidden focus:border-primary-500/60 focus:ring-2 focus:ring-primary-500/30"
                value={channelType}
                onChange={(e) => onParamsChange({ ...node.params, channel_type: e.target.value })}
              >
                <option value="">{t('planCanvas.inspectorChannelTypePlaceholder')}</option>
                {KNOWN_CHANNEL_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>
            </div>

            {isKnownChannel && (
              <div className="border border-white/10 bg-black/25 p-3">
                <ChannelConfigForm
                  channelType={channelType as ChannelType}
                  config={node.params}
                  onChange={onParamsChange}
                />
              </div>
            )}

            <button
              type="button"
              disabled={!isKnownChannel || materializeMut.isPending}
              onClick={() => materializeMut.mutate()}
              className="inline-flex h-9 w-full items-center justify-center rounded-md border border-sky-500/40 bg-sky-500/10 text-xs font-semibold text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {materializeMut.isPending ? t('planCanvas.inspectorMaterializing') : t('planCanvas.inspectorMaterialize')}
            </button>
          </>
        ) : (
          <>
            <p className="text-2xs font-semibold uppercase tracking-wide text-emerald-300/80">
              {t('planCanvas.inspectorEditSource')}
            </p>
            {node.source_id && (
              <p className="text-3xs text-zinc-600">
                {t('planCanvas.inspectorSourceIdLabel')}: <span className="font-code">{node.source_id}</span>
              </p>
            )}

            {sourceQuery.isLoading ? (
              <p className="text-2xs text-zinc-600">{t('common.loading')}</p>
            ) : isKnownChannel ? (
              <div className="border border-white/10 bg-black/25 p-3">
                <ChannelConfigForm
                  channelType={channelType as ChannelType}
                  config={node.params}
                  onChange={onParamsChange}
                  sourceId={node.source_id ?? undefined}
                />
              </div>
            ) : (
              <p className="text-2xs text-zinc-600">{t('planCanvas.inspectorNonSourceHint')}</p>
            )}

            {isKnownChannel && (
              <button
                type="button"
                disabled={updateMut.isPending}
                onClick={() => updateMut.mutate(node.params)}
                className="inline-flex h-9 w-full items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {updateMut.isPending ? t('planCanvas.saving') : t('planCanvas.inspectorUpdateSource')}
              </button>
            )}
          </>
        )}
      </div>

      <div className="border-t border-white/8 p-3">
        <button
          type="button"
          onClick={onDetach}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-white/12 bg-white/2 text-2xs font-semibold text-zinc-300 hover:border-red-400/40 hover:text-red-200"
        >
          {t('planCanvas.detachNode')}
        </button>
      </div>
    </Card>
  )
}
