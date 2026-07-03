import { memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import {
  Bell,
  Box,
  CalendarClock,
  GitFork,
  Gauge,
  StickyNote,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/* ──────────────────────────────────────────────────────────────────────────
 * xyops workflow node taxonomy, ported verbatim to React Flow custom nodes.
 * Source: 2233admin/xyops · htdocs/css/workflow.css + docs/workflows.md
 *
 *   trigger     64² half-pill-left   orange   single output pole (right)
 *   event/job   275 card r16         blue poles   input(L)/output(R)/limit(bottom)
 *   action      64² half-pill-right  green    input pole (left)
 *   controller  128×64 pill          purple   input(L)/output(R)
 *   limit       64² diamond rot45    cyan     up pole (top)
 *   note        275 card             neutral  no poles
 *
 * React Flow owns canvas / edges / minimap / controls / handles (the wheel);
 * we only author these node bodies.
 * ────────────────────────────────────────────────────────────────────────── */

export const WF = {
  orange: '#f59e0b',
  blue: '#3b82f6',
  green: '#34d399',
  purple: '#a78bfa',
  cyan: '#22d3ee',
}

const POLE = 11

// ── shared pole (React Flow Handle styled as an xyops pole) ─────────────────
function pole(color: string): React.CSSProperties {
  return {
    width: POLE,
    height: POLE,
    background: color,
    border: '2px solid var(--oc-line)',
    borderRadius: 999,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event / Job — the main rectangular nodes (275px card, r16, title bar + pill)
// ─────────────────────────────────────────────────────────────────────────────
export interface WfEventData extends Record<string, unknown> {
  kind: 'event' | 'job'
  title: string
  subtitle?: string
  pill?: string
  pillTone?: 'cyan' | 'green' | 'orange' | 'neutral'
  icon?: LucideIcon
  rows?: Array<{ k: string; v: string }>
  state?: 'idle' | 'running' | 'success' | 'warning' | 'error'
}

const STATE_COLOR: Record<NonNullable<WfEventData['state']>, string> = {
  idle: '#64748b',
  running: '#38bdf8',
  success: '#34d399',
  warning: '#fbbf24',
  error: '#f87171',
}

function CardNode({ data, selected }: NodeProps<Node<WfEventData>>) {
  const Icon = data.icon ?? (data.kind === 'job' ? Box : CalendarClock)
  const state = data.state ?? 'idle'
  const pillTone = data.pillTone ?? 'neutral'
  const pillBg =
    pillTone === 'cyan' ? WF.cyan : pillTone === 'green' ? WF.green : pillTone === 'orange' ? WF.orange : 'rgba(255,255,255,0.12)'
  const pillFg = pillTone === 'neutral' ? '#cbd5e1' : '#08080b'

  return (
    <div
      style={{ width: 244, borderRadius: 16, borderColor: selected ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.18)' }}
      className="overflow-hidden border-2 bg-ops-panel shadow-panel"
    >
      <Handle id="in" type="target" position={Position.Left} style={pole(WF.blue)} />
      <Handle id="out" type="source" position={Position.Right} style={pole(WF.blue)} />
      <Handle id="limit" type="source" position={Position.Bottom} style={pole(WF.cyan)} />

      <div className="flex items-center gap-2 border-b border-white/10 bg-white/4 px-3" style={{ height: 32 }}>
        <span className="grid h-5 w-5 shrink-0 place-items-center" style={{ color: STATE_COLOR[state] }}>
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-zinc-100" title={data.title}>
          {data.title}
        </span>
        {data.pill && (
          <span
            className="shrink-0 rounded-full px-2 text-3xs font-bold leading-[18px]"
            style={{ background: pillBg, color: pillFg }}
          >
            {data.pill}
          </span>
        )}
      </div>

      <div className="px-3 py-2">
        {data.subtitle && <p className="mb-1.5 text-2xs text-zinc-500">{data.subtitle}</p>}
        {data.rows && (
          <div className="grid gap-1">
            {data.rows.map((r) => (
              <div key={r.k} className="flex items-center justify-between gap-2 text-[10.5px]">
                <span className="text-zinc-600">{r.k}</span>
                <span className="truncate font-mono text-zinc-300" title={r.v}>{r.v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Glyph nodes — trigger / action / controller / limit (64-ish, colored, polar)
// ─────────────────────────────────────────────────────────────────────────────
function Glyph({
  icon: Icon,
  color,
  label,
  shape,
  selected,
  handles,
}: {
  icon: LucideIcon
  color: string
  label?: string
  shape: 'pill-left' | 'pill-right' | 'pill' | 'diamond'
  selected?: boolean
  handles: ReactNode
}) {
  const radius =
    shape === 'pill-left' ? '999px 0 0 999px' : shape === 'pill-right' ? '0 999px 999px 0' : shape === 'pill' ? '999px' : '6px'
  const w = shape === 'pill' ? 112 : 60
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          width: w,
          height: 60,
          borderRadius: radius,
          color,
          borderColor: selected ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
          transform: shape === 'diamond' ? 'rotate(45deg) scale(0.72)' : undefined,
        }}
        className="grid place-items-center border-2 bg-ops-panel shadow-panel"
      >
        <span style={{ transform: shape === 'diamond' ? 'rotate(-45deg)' : undefined }}>
          <Icon size={26} />
        </span>
      </div>
      {label && (
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      )}
      {handles}
    </div>
  )
}

function TriggerNode({ data, selected }: NodeProps<Node<{ label?: string; icon?: LucideIcon }>>) {
  return (
    <Glyph
      icon={data.icon ?? Zap}
      color={WF.orange}
      label={data.label ?? 'trigger'}
      shape="pill-left"
      selected={selected}
      handles={<Handle id="out" type="source" position={Position.Right} style={pole(WF.orange)} />}
    />
  )
}

function ActionNode({ data, selected }: NodeProps<Node<{ label?: string; icon?: LucideIcon }>>) {
  return (
    <Glyph
      icon={data.icon ?? Bell}
      color={WF.green}
      label={data.label ?? 'action'}
      shape="pill-right"
      selected={selected}
      handles={<Handle id="in" type="target" position={Position.Left} style={pole(WF.green)} />}
    />
  )
}

function ControllerNode({ data, selected }: NodeProps<Node<{ label?: string; icon?: LucideIcon }>>) {
  return (
    <Glyph
      icon={data.icon ?? GitFork}
      color={WF.purple}
      label={data.label ?? 'controller'}
      shape="pill"
      selected={selected}
      handles={
        <>
          <Handle id="in" type="target" position={Position.Left} style={pole(WF.purple)} />
          <Handle id="out" type="source" position={Position.Right} style={pole(WF.purple)} />
        </>
      }
    />
  )
}

function LimitNode({ data, selected }: NodeProps<Node<{ label?: string; icon?: LucideIcon }>>) {
  return (
    <Glyph
      icon={data.icon ?? Gauge}
      color={WF.cyan}
      label={data.label ?? 'limit'}
      shape="diamond"
      selected={selected}
      handles={<Handle id="up" type="target" position={Position.Top} style={pole(WF.cyan)} />}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Note — annotation card, no poles
// ─────────────────────────────────────────────────────────────────────────────
function NoteNode({ data, selected }: NodeProps<Node<{ text: string }>>) {
  return (
    <div
      style={{ width: 244, borderRadius: 16, borderColor: selected ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)' }}
      className="border-2 border-dashed bg-amber-300/6 px-4 py-3 text-[13px] leading-relaxed text-amber-100/80"
    >
      <span className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-amber-200/50">
        <StickyNote size={11} /> note
      </span>
      {data.text}
    </div>
  )
}

export const workflowNodeTypes = {
  wfTrigger: memo(TriggerNode),
  wfEvent: memo(CardNode),
  wfJob: memo(CardNode),
  wfAction: memo(ActionNode),
  wfLimit: memo(LimitNode),
  wfController: memo(ControllerNode),
  wfNote: memo(NoteNode),
}
