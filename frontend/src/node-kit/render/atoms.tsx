// L3 atoms — the smallest reusable node-body building blocks. Every node (in any
// system) composes from these, so they own the node look-and-feel once. Pure,
// presentational, dark-themed. No app/data coupling.
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
  Box,
  type LucideIcon,
} from 'lucide-react'
import * as Icons from 'lucide-react'

import { useState } from 'react'

import type { FieldDef, PortDef } from '../spec'
import type {
  SensorConfidence,
  SensorCoverage,
  SourceControlStateValue,
  SourceControlTrend,
  SourceSystemContext,
  SuggestedControlAction,
  ControlMode,
} from '../../api/types'

/** Resolve a lucide icon by name ('database' -> Database). Falls back to Box. */
export function iconByName(name?: string): LucideIcon {
  if (!name) return Box
  const pascal = name
    .split(/[-_ ]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  return ((Icons as unknown as Record<string, LucideIcon>)[pascal] as LucideIcon) ?? Box
}

export function NodeHeader({ icon, title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  const Icon = iconByName(icon)
  return (
    <div className="flex items-start gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/4 text-zinc-300">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white" title={title}>
          {title}
        </div>
        {subtitle && <div className="truncate text-[11px] text-zinc-500">{subtitle}</div>}
      </div>
    </div>
  )
}

/** A typed connection port rendered as an xyflow Handle. */
export function NodePort({ port, side }: { port: PortDef; side: 'input' | 'output' }) {
  return (
    <Handle
      id={port.id}
      type={side === 'input' ? 'target' : 'source'}
      position={side === 'input' ? Position.Left : Position.Right}
      className="h-2.5! w-2.5! border-2! border-[#0a0a0c]! bg-sky-400!"
    />
  )
}

export function NodeField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border border-white/6 bg-white/2.5 px-2 py-1 text-[11px]">
      <span className="shrink-0 text-zinc-600">{label}</span>
      <span className="truncate font-medium text-zinc-300">{value}</span>
    </div>
  )
}

/** Editable config field — the inline form control for one FieldDef. Writes via
 *  onChange to the host (KitNode → updateNodeData). `nodrag nopan` + a pointer
 *  guard stop xyflow from dragging the node / panning while you edit. */
export function NodeFieldEdit({
  field,
  value,
  onChange,
}: {
  field: FieldDef
  value: unknown
  onChange: (value: unknown) => void
}) {
  const label = field.label ?? field.key
  const stop = (e: ReactPointerEvent) => e.stopPropagation()
  const base =
    'nodrag nopan w-full rounded-xs border border-white/10 bg-black/50 px-1.5 py-1 text-[11px] text-zinc-100 outline-hidden transition focus:border-sky-500/60'

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-2 px-0.5 py-0.5">
        <span className="text-[10px] text-zinc-500">{label}</span>
        <NodeToggle on={Boolean(value)} onClick={() => onChange(!value)} />
      </div>
    )
  }

  let control: ReactNode
  if (field.type === 'select') {
    control = (
      <select className={base} value={String(value ?? '')} onPointerDown={stop} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    )
  } else if (field.type === 'json') {
    control = (
      <textarea
        className={`${base} resize-none font-code`}
        rows={2}
        value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)}
        placeholder={field.placeholder}
        onPointerDown={stop}
        onChange={(e) => onChange(tryParseJson(e.target.value))}
      />
    )
  } else if (field.type === 'number') {
    control = (
      <input
        type="number"
        className={base}
        value={value == null || value === '' ? '' : String(value)}
        placeholder={field.placeholder}
        onPointerDown={stop}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  } else {
    control = (
      <input
        type="text"
        className={base}
        value={value == null ? '' : String(value)}
        placeholder={field.placeholder}
        onPointerDown={stop}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <label className="grid gap-1">
      <span className="text-[10px] text-zinc-500">
        {label}
        {field.required && <span className="text-red-400/80"> *</span>}
      </span>
      {control}
    </label>
  )
}

/** Keep raw text if it isn't valid JSON yet, so a half-typed value isn't lost. */
function tryParseJson(s: string): unknown {
  if (s.trim() === '') return undefined
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

export function NodeStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md bg-white/3 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="text-base font-semibold text-zinc-100">{value}</div>
    </div>
  )
}

export function NodeBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger' }) {
  const cls =
    tone === 'accent'
      ? 'border-sky-500/40 bg-sky-500/12 text-sky-100'
      : tone === 'danger'
        ? 'border-red-400/35 bg-red-400/10 text-red-100'
        : 'border-white/10 bg-white/4 text-zinc-300'
  return <span className={`rounded-xs border px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>
}

// ── C0 Control Room v0 (docs/CONTROL_THEORY_ARCHITECTURE.md §0) ─────────────
// "先让系统诚实" — these two atoms are the one place a node renders its control
// state + sensor honesty, so every node type (source or otherwise) that wires
// up control-state facts gets the same "never a fake healthy" visual for free.
//
// PR-Control-3 vocabulary: each control_state gets its OWN color, not just a
// 3-way neutral/accent/danger bucket — DEGRADED (amber) reads differently from
// AUTH_FAILED (red) even though both are "not healthy", and BLOCKED_BY_ODP
// (purple) must read as "system-wide, not this source's fault" at a glance.
// HARD RULE carried over from C0: UNKNOWN / low-confidence must never look
// like a confident healthy — see the `effective` override in ControlBadge.

const CONTROL_STATE_LABEL: Record<SourceControlStateValue, string> = {
  healthy: 'HEALTHY',
  degraded: 'DEGRADED',
  backpressured: 'BACKPRESSURED',
  rate_limited: 'RATE LIMITED',
  auth_failed: 'AUTH FAILED',
  schema_drift: 'SCHEMA DRIFT',
  blocked_by_odp: 'BLOCKED BY ODP',
  paused: 'PAUSED',
  dead: 'DEAD',
  unknown: 'UNKNOWN',
}

// One visual identity per state: dot color + chip border/bg/text. Kept local
// to ControlBadge (not routed through NodeBadge's 3-tone system) because the
// whole point of PR-Control-3's vocabulary is that these must NOT collapse
// into a handful of shared buckets.
const CONTROL_STATE_STYLE: Record<SourceControlStateValue, { dot: string; chip: string }> = {
  healthy: { dot: 'bg-emerald-400', chip: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100' },
  degraded: { dot: 'bg-amber-400', chip: 'border-amber-400/35 bg-amber-400/10 text-amber-100' },
  backpressured: { dot: 'bg-blue-400', chip: 'border-blue-400/35 bg-blue-400/10 text-blue-100' },
  rate_limited: { dot: 'bg-orange-400', chip: 'border-orange-400/35 bg-orange-400/10 text-orange-100' },
  auth_failed: { dot: 'bg-red-400', chip: 'border-red-400/35 bg-red-400/10 text-red-100' },
  schema_drift: { dot: 'bg-red-400', chip: 'border-red-400/35 bg-red-400/10 text-red-100' },
  blocked_by_odp: { dot: 'bg-purple-400', chip: 'border-purple-400/35 bg-purple-400/10 text-purple-100' },
  paused: { dot: 'bg-slate-400', chip: 'border-slate-400/30 bg-slate-400/10 text-slate-200' },
  dead: { dot: 'bg-zinc-600', chip: 'border-zinc-600/50 bg-zinc-700/20 text-zinc-400' },
  unknown: { dot: 'bg-zinc-500', chip: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300' },
}

/** control_state + confidence, in one glance. HARD RULE: `healthy` only ever
 *  renders green when confidence is not "low" — the backend evaluator already
 *  refuses to emit a low-confidence HEALTHY (see backend.control.evaluator),
 *  but this component enforces the same rule defensively on the render side,
 *  so a stale/mocked/hand-built facts blob can never paint a fake-healthy dot
 *  either. `control_state`/`confidence` null (source never ran) renders as a
 *  neutral "no data" chip, not a green dot. */
export function ControlBadge({
  controlState,
  confidence,
}: {
  controlState: SourceControlStateValue | null | undefined
  confidence: SensorConfidence | null | undefined
}) {
  if (!controlState) {
    return <NodeBadge tone="neutral">NO DATA</NodeBadge>
  }
  // Defensive: even if something upstream claims "healthy" with low confidence,
  // never paint it as a trustworthy green — render it as UNKNOWN instead.
  const effective: SourceControlStateValue =
    controlState === 'healthy' && confidence === 'low' ? 'unknown' : controlState
  const label = CONTROL_STATE_LABEL[effective]
  const { dot, chip } = CONTROL_STATE_STYLE[effective]
  return (
    <span className={`rounded-xs border px-1.5 py-0.5 text-[10px] ${chip}`}>
      <span className="inline-flex items-center gap-1">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
        {confidence && confidence !== 'high' && (
          <span className="text-[9px] opacity-70">· {confidence}</span>
        )}
      </span>
    </span>
  )
}

/** Which sensor signals are real vs. placeholder, spelled out — the whole
 *  point of C0 is that this can't be buried in a tooltip. Renders nothing when
 *  coverage is null (source never ran: no measurement, nothing to show) and a
 *  reassuring "full coverage" chip when nothing is missing, so the absence of
 *  a warning is a deliberate state, not silence. */
export function SensorCoverageBadge({
  coverage,
  missingSignals,
}: {
  coverage: SensorCoverage | null | undefined
  missingSignals: string[] | null | undefined
}) {
  if (!coverage) return null
  const missing = missingSignals ?? []
  if (missing.length === 0) {
    return <NodeBadge tone="accent">sensors: full coverage</NodeBadge>
  }
  return (
    <NodeBadge tone="danger">
      partial sensors · missing {missing.join(', ')}
    </NodeBadge>
  )
}

// ── PR-Control-3 (docs/CONTROL_THEORY_ARCHITECTURE.md §4) ───────────────────
// Trend summary, ODP system-context, and ADVISORY suggested actions. This
// phase (CONTROL_MODE=advisory) only ever SUGGESTS — there is deliberately no
// execute/apply button anywhere below. If that ever changes, it's a different
// PR (PR-Control-4, actuators + CONTROL_MODE=automatic), not a prop on these.

/** Compact rolling-window summary — "0-accepted x3", "avg err 12%", etc. Only
 *  renders the facts that are actually interesting (non-zero streak / error
 *  rate / rate-limited count); renders nothing when trend is null (no window
 *  to summarize yet) rather than an empty chip. */
export function TrendSummary({ trend }: { trend: SourceControlTrend | null | undefined }) {
  if (!trend) return null
  const parts: string[] = []
  if (trend.zero_accepted_streak > 0) parts.push(`0-accepted ×${trend.zero_accepted_streak}`)
  if (trend.avg_error_rate > 0) parts.push(`avg err ${(trend.avg_error_rate * 100).toFixed(0)}%`)
  if (trend.rate_limited_runs > 0) parts.push(`rate-limited ×${trend.rate_limited_runs}`)
  if (parts.length === 0) return null
  return (
    <NodeBadge>
      trend({trend.window}): {parts.join(' · ')}
    </NodeBadge>
  )
}

/** Compact ODP system-context indicator — only shows up when there's actually
 *  something to say: backpressured, or the collector itself is unavailable
 *  (degrade honestly rather than silently omitting the fact we can't see it).
 *  A calm system_context (available, not backpressured) renders nothing, same
 *  "silence is a deliberate state" rule as SensorCoverageBadge. */
export function SystemContextBadge({ systemContext }: { systemContext: SourceSystemContext | null | undefined }) {
  if (!systemContext) return null
  if (!systemContext.available) {
    return <NodeBadge tone="neutral">ODP: unavailable</NodeBadge>
  }
  if (!systemContext.odp_backpressured) return null
  const bits: string[] = []
  if (systemContext.stream_lag != null) bits.push(`lag ${systemContext.stream_lag}`)
  if (systemContext.pending != null) bits.push(`pending ${systemContext.pending}`)
  return (
    <span className="rounded-xs border border-purple-400/35 bg-purple-400/10 px-1.5 py-0.5 text-[10px] text-purple-100">
      ODP backpressured{bits.length > 0 ? ` · ${bits.join(', ')}` : ''}
    </span>
  )
}

/** One suggested action, ADVISORY ONLY: shows action_type as the label and
 *  the evaluator's reason on hover (title) or expand-on-click — NEVER a button
 *  that executes anything. There is no onClick-that-mutates anywhere in this
 *  component; clicking only toggles local expand/collapse of the reason text. */
function SuggestedActionChip({ action }: { action: SuggestedControlAction }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <button
      type="button"
      title={action.reason}
      onClick={(e) => {
        e.stopPropagation()
        setExpanded((v) => !v)
      }}
      className="nodrag nopan flex max-w-full flex-col items-start gap-0.5 rounded-xs border border-dashed border-sky-400/30 bg-sky-400/6 px-1.5 py-0.5 text-left text-[10px] text-sky-100 transition hover:border-sky-400/50"
    >
      <span className="inline-flex items-center gap-1">
        <span className="rounded-[2px] bg-sky-400/20 px-1 text-[8px] font-semibold uppercase tracking-wide text-sky-200">
          suggested (advisory)
        </span>
        <span className="font-medium">{action.action_type}</span>
      </span>
      {expanded && <span className="whitespace-normal text-[9px] text-sky-200/80">{action.reason}</span>}
    </button>
  )
}

/** The advisory suggested-actions row for a node. Renders nothing when there
 *  are no suggestions. When `controlMode` is 'advisory' (the only mode this
 *  phase supports), an explicit "not being applied" note is shown so nobody
 *  mistakes a suggestion list for an action log — display only, no execute
 *  path exists anywhere in node-kit. */
export function SuggestedActionsRow({
  actions,
  controlMode,
}: {
  actions: SuggestedControlAction[] | null | undefined
  controlMode?: ControlMode | null
}) {
  const list = actions ?? []
  if (list.length === 0) return null
  return (
    <div className="mt-1 grid gap-1">
      {controlMode !== 'automatic' && (
        <div className="text-[9px] italic text-zinc-600">
          advisory only — suggestions are not being applied
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {list.map((action, i) => (
          <SuggestedActionChip key={`${action.action_type}-${i}`} action={action} />
        ))}
      </div>
    </div>
  )
}

export function NodeOpButton({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string
  icon?: string
  danger?: boolean
  onClick: () => void
}) {
  const Icon = iconByName(icon)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`nodrag nopan flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition active:scale-[0.98] ${
        danger
          ? 'border-red-400/35 bg-red-400/10 text-red-100 hover:bg-red-400/20'
          : 'border-white/12 bg-white/4 text-zinc-200 hover:border-white/25 hover:bg-white/8'
      }`}
    >
      {icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

export function NodeToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`nodrag nopan relative inline-block h-4 w-7 rounded-full transition ${on ? 'bg-emerald-500' : 'bg-zinc-600'}`}
    >
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  )
}
