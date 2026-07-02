// Run log strip — sequential per-node execution transcript for a runGraph()
// call, rendered bottom-of-canvas. Control-room visual canon (see
// src/pages/ActionHistoryPage.tsx): border-white/8 bg-black/20,
// font-code text-[11px], zinc tiers for neutral/dim text. Purely a projection
// of runState (owned by NodeWorkbench) through the framework-free
// runtime/runLog.ts helpers — no local state here.
import { AlertCircle, CheckCircle2, CircleDashed, FlaskConical, Loader2, MinusCircle } from 'lucide-react'

import { summarizeRun, toRunLogRows, type RunLogRowView, type RunNodeState, type RunStateMap } from '../runtime/runLog'

const STATE_ICON: Record<RunNodeState, typeof CircleDashed> = {
  queued: CircleDashed,
  running: Loader2,
  success: CheckCircle2,
  error: AlertCircle,
  skipped: MinusCircle,
}

const STATE_COLOR: Record<RunNodeState, string> = {
  queued: 'text-zinc-600',
  running: 'text-amber-300',
  success: 'text-emerald-300',
  error: 'text-red-300',
  skipped: 'text-zinc-600',
}

function RunLogRow({ row }: { row: RunLogRowView }) {
  const Icon = STATE_ICON[row.state]
  return (
    <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1 last:border-b-0">
      <Icon size={11} className={`shrink-0 ${STATE_COLOR[row.state]} ${row.state === 'running' ? 'animate-spin' : ''}`} />
      <span className="w-24 shrink-0 truncate text-zinc-300" title={row.title}>
        {row.title}
      </span>
      <span className={`w-16 shrink-0 uppercase tracking-wide ${STATE_COLOR[row.state]}`}>{row.stateLabel}</span>
      <span className="w-14 shrink-0 text-zinc-500">{row.durationLabel}</span>
      {row.state === 'error' ? (
        <span className="min-w-0 flex-1 truncate text-red-300/90" title={row.errorText}>
          {row.errorText}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-zinc-600" title={row.outputPreview}>
          {row.outputPreview}
        </span>
      )}
    </div>
  )
}

export function RunLogPanel({
  runState,
  titleFor,
}: {
  runState: RunStateMap
  titleFor: (nodeId: string) => string
}) {
  const rows = toRunLogRows(runState, titleFor)
  if (rows.length === 0) return null
  const summary = summarizeRun(runState)

  return (
    <div className="absolute inset-x-3 bottom-3 z-10 max-h-40 overflow-hidden rounded-md border border-amber-400/25 bg-black/20 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 border-b border-amber-400/20 bg-amber-400/5 px-3 py-1.5">
        <span className="inline-flex items-center gap-1 font-telemetry text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-300">
          <FlaskConical size={11} /> 预演日志 · fixture 数据，非真实采集
        </span>
        <span className="font-code text-[11px] text-zinc-400">{summary.label}</span>
      </div>
      <div className="thin-scrollbar max-h-32 overflow-auto font-code text-[11px]">
        {rows.map((row) => (
          <RunLogRow key={row.nodeId} row={row} />
        ))}
      </div>
    </div>
  )
}
