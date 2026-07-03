// Pure data-mapping seam for the topology ODP system node (issue 07). Kept
// framework-free (no React/xyflow imports) so `node --test` can cover the
// "never a fake healthy" mapping without mounting anything — mirrors the
// defensive-rendering contract ControlBadge/SensorCoverageBadge already
// enforce on the render side (frontend/src/node-kit/render/atoms.tsx).
import type { OdpSystemState } from '../../api/types'
import type { TopologyGraphNode, TopologyHealth } from './topologyModel'

export const ODP_NODE_ID = 'system:odp'

export interface OdpNodeFacts {
  /** Rendered badge label chips — always present, never empty. */
  badges: string[]
  /** Compact detail rows for the inspector/body. */
  detail: Record<string, unknown>
}

/** Health classification, defensive by construction: any section reporting
 * `available: false` (down Redis / unreachable odp-ingest / no heartbeat
 * table) can only ever push the result toward 'warning'/'failed', never
 * toward 'healthy' — an absent reading must never look like a healthy one.
 * `store`/`outbox` are ALWAYS unavailable by backend design (no heartbeat
 * table, no outbox table — see backend/schemas/odp_state.py) so they are
 * deliberately excluded from the health computation: they would permanently
 * pin the node at 'warning' for a fact that isn't actionable. */
export function odpNodeHealth(state: OdpSystemState | null | undefined): TopologyHealth {
  if (!state) return 'unknown'

  const sectionsAvailable = state.ingest.available && state.stream.available && state.dlq.available
  if (!sectionsAvailable) return 'warning'

  if (state.ingest.healthy === false) return 'failed'

  const dlqBacklog = (state.dlq.last_24h ?? 0) > 0
  const streamPending = (state.stream.pending ?? 0) > 0
  if (dlqBacklog || streamPending) return 'warning'

  return 'healthy'
}

/** Badge/detail projection for the node body. Renders every section's
 * availability explicitly — silence about an unreachable section is exactly
 * the false-positive C0 forbids (see node-kit/render/atoms.tsx's module
 * docstring). Numbers are only shown when the section is available; an
 * unavailable section always says so instead of printing a bare "0". */
export function odpNodeFacts(state: OdpSystemState | null | undefined): OdpNodeFacts {
  if (!state) {
    return { badges: ['no data'], detail: {} }
  }

  const badges: string[] = []

  badges.push(
    state.ingest.available
      ? `ingest: ${state.ingest.healthy ? 'healthy' : 'unhealthy'}`
      : 'ingest: unavailable',
  )
  badges.push(
    state.stream.available
      ? `lag ${state.stream.lag ?? 0} · pending ${state.stream.pending ?? 0}`
      : 'stream: unavailable',
  )
  badges.push(
    state.dlq.available ? `dlq 24h: ${state.dlq.last_24h ?? 0}` : 'dlq: unavailable',
  )
  // store/outbox are unavailable by design today — surface the reason, not a
  // fabricated number (backend/schemas/odp_state.py StoreHealth/OutboxState).
  badges.push('store: no heartbeat')
  badges.push('outbox: no table')

  return {
    badges,
    detail: {
      ingest_available: state.ingest.available,
      ingest_healthy: state.ingest.healthy,
      ingest_error: state.ingest.error ?? null,
      stream_available: state.stream.available,
      stream_lag: state.stream.lag,
      stream_pending: state.stream.pending,
      stream_oldest_pending_idle_ms: state.stream.oldest_pending_idle_ms,
      stream_error: state.stream.error ?? null,
      dlq_available: state.dlq.available,
      dlq_total: state.dlq.total,
      dlq_last_24h: state.dlq.last_24h,
      dlq_error: state.dlq.error ?? null,
      collected_at: state.collected_at,
    },
  }
}

/** The graph-node placeholder for the ODP system node — placement/labeling
 * only, no live facts (those come from OdpSystemBody's own poll via
 * node-kit's collection.odp-system spec; health/badges by design are NOT
 * pre-computed here since this node is planted once at graph-build time,
 * before any control-state fetch has resolved). Always exactly one instance,
 * placed after the last source column so it reads as "alongside", not
 * "instead of", the per-source project grid. */
export function odpSystemGraphNode(column: number): TopologyGraphNode {
  return {
    id: ODP_NODE_ID,
    column,
    row: 0,
    data: {
      kind: 'odp-system',
      title: 'ODP 数据平面',
      subtitle: 'shared plane',
      health: 'unknown',
      badges: [],
      skills: [],
      actions: [],
      ports: { inputs: [], outputs: [] },
      detail: { kind: 'odp-system' },
    },
  }
}
