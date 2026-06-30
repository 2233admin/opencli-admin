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

import type { FieldDef, PortDef } from '../spec'

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
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300">
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
      className="!h-2.5 !w-2.5 !border-2 !border-[#0a0a0c] !bg-sky-400"
    />
  )
}

export function NodeField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border border-white/[0.06] bg-white/[0.025] px-2 py-1 text-[11px]">
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
    'nodrag nopan w-full rounded-sm border border-white/10 bg-black/50 px-1.5 py-1 text-[11px] text-zinc-100 outline-none transition focus:border-sky-500/60'

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
    <div className="rounded-md bg-white/[0.03] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="text-base font-semibold text-zinc-100">{value}</div>
    </div>
  )
}

export function NodeBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger' }) {
  const cls =
    tone === 'accent'
      ? 'border-sky-500/40 bg-sky-500/[0.12] text-sky-100'
      : tone === 'danger'
        ? 'border-red-400/35 bg-red-400/10 text-red-100'
        : 'border-white/10 bg-white/[0.04] text-zinc-300'
  return <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${cls}`}>{children}</span>
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
          : 'border-white/[0.12] bg-white/[0.04] text-zinc-200 hover:border-white/25 hover:bg-white/[0.08]'
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
