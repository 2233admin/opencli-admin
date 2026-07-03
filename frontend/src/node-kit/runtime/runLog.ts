// Framework-free run-log projection for the workbench's execution visualizer.
// The engine (engine.ts) emits raw onNodeState(nodeId, state, detail) calls;
// this module is the one place that turns those into a state map + ordered
// log rows + a summary line, so NodeWorkbench stays a thin React shell and
// this logic gets `node --test` coverage without mounting anything.
export type RunNodeState = 'queued' | 'running' | 'success' | 'error' | 'skipped'

export interface RunNodeDetail {
  /** short preview of the node's output (already stringified by the caller) */
  outputPreview?: string
  /** error message when state === 'error' */
  errorMessage?: string
  /** wall-clock duration of this node's execution, ms */
  durationMs?: number
}

export interface RunLogEntry {
  nodeId: string
  state: RunNodeState
  detail: RunNodeDetail
  /** monotonically increasing — the order state transitions were observed in */
  seq: number
}

export type RunStateMap = Record<string, RunLogEntry>

export const EMPTY_RUN_STATE: RunStateMap = {}

/** Fold one onNodeState observation into the running state map. Later calls
 *  for the same nodeId overwrite (running -> success/error), which is exactly
 *  what the UI wants: one row per node reflecting its latest known state. */
export function applyRunEvent(
  map: RunStateMap,
  nodeId: string,
  state: RunNodeState,
  detail: RunNodeDetail = {},
  seq: number,
): RunStateMap {
  return { ...map, [nodeId]: { nodeId, state, detail, seq } }
}

/** One row per node, name-resolved, ordered by when the engine first touched
 *  it (seq) — NOT alphabetically or by graph id, so the panel reads as a
 *  chronological transcript of the run. */
export interface RunLogRowView {
  nodeId: string
  title: string
  state: RunNodeState
  stateLabel: string
  durationLabel: string
  outputPreview: string
  errorText: string
}

const STATE_LABEL: Record<RunNodeState, string> = {
  queued: 'QUEUED',
  running: 'RUNNING',
  success: 'OK',
  error: 'ERROR',
  skipped: 'SKIPPED',
}

const MAX_PREVIEW = 80

/** Truncate a preview string to a fixed length with an ellipsis marker — the
 *  log panel is a fixed-width strip, not a JSON viewer. */
export function truncatePreview(s: string, max: number = MAX_PREVIEW): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

export function toRunLogRows(map: RunStateMap, titleFor: (nodeId: string) => string): RunLogRowView[] {
  return Object.values(map)
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({
      nodeId: entry.nodeId,
      title: titleFor(entry.nodeId),
      state: entry.state,
      stateLabel: STATE_LABEL[entry.state],
      durationLabel: entry.detail.durationMs == null ? '—' : `${entry.detail.durationMs}ms`,
      outputPreview: entry.detail.outputPreview ? truncatePreview(entry.detail.outputPreview) : '',
      errorText: entry.detail.errorMessage ?? '',
    }))
}

export interface RunSummaryView {
  successCount: number
  errorCount: number
  totalCount: number
  totalMs: number
  label: string
}

/** Summary line: "n success / n error / total Nms" — n/n counted from the
 *  terminal states only (queued/running nodes mid-flight don't count toward
 *  either bucket yet). totalMs sums every entry's durationMs that's known. */
export function summarizeRun(map: RunStateMap): RunSummaryView {
  const entries = Object.values(map)
  const successCount = entries.filter((e) => e.state === 'success').length
  const errorCount = entries.filter((e) => e.state === 'error').length
  const totalMs = entries.reduce((sum, e) => sum + (e.detail.durationMs ?? 0), 0)
  const totalCount = entries.length
  return {
    successCount,
    errorCount,
    totalCount,
    totalMs,
    label: `${successCount} success / ${errorCount} error / ${totalMs}ms total`,
  }
}
