// C0 Control Room v0 (docs/CONTROL_THEORY_ARCHITECTURE.md §0): the ONE shared
// polling hook + body fragment every source-shaped node (node-kit's
// source.* atoms AND collection.source on the main topology canvas) reuses, so
// "never a fake healthy" lives in exactly one place instead of being
// reimplemented per node type. TanStack Query only — no websocket in v0.
import { useQuery } from '@tanstack/react-query'

import { getSourceControlState } from '../../api/endpoints'
import { ControlBadge, SensorCoverageBadge, SuggestedActionsRow, SystemContextBadge, TrendSummary } from './atoms'

export const CONTROL_STATE_POLL_MS = 15_000

/** Poll GET /sources/{id}/control-state for one node instance. `sourceId` empty
 *  (unconfigured palette node, or a non-source stage) disables the query — no
 *  control facts to show, not an error. */
export function useSourceControlState(sourceId: string) {
  return useQuery({
    queryKey: ['source-control-state', sourceId],
    queryFn: () => getSourceControlState(sourceId),
    enabled: sourceId.length > 0,
    refetchInterval: CONTROL_STATE_POLL_MS,
  })
}

/** The badge row every source node renders below its config/status fields.
 *  Renders nothing when `sourceId` is empty (nothing to poll for yet). While
 *  loading/erroring it says so explicitly rather than going silent — silence
 *  reads as "nothing wrong", which is exactly the false signal C0 forbids. */
export function SourceControlStrip({ sourceId }: { sourceId: string }) {
  const query = useSourceControlState(sourceId)
  if (!sourceId) return null

  if (query.isLoading) {
    return <div className="mt-1 text-3xs text-zinc-600">sensors: loading…</div>
  }
  if (query.isError) {
    return <div className="mt-1 text-3xs text-red-300">sensors: fetch failed</div>
  }

  const state = query.data
  return (
    <div className="mt-1 grid gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <ControlBadge controlState={state?.control_state ?? null} confidence={state?.confidence ?? null} />
        <SensorCoverageBadge coverage={state?.sensor_coverage ?? null} missingSignals={state?.missing_signals ?? []} />
        <TrendSummary trend={state?.trend} />
        <SystemContextBadge systemContext={state?.system_context} />
      </div>
      {/* PR-Control-3: ADVISORY suggested actions only — display only, never
          an execute button. See atoms.SuggestedActionsRow. */}
      <SuggestedActionsRow actions={state?.suggested_actions} controlMode={state?.control_mode} />
    </div>
  )
}
