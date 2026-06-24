import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type OperatorTone =
  | 'neutral'
  | 'accent'
  | 'info'
  | 'gold'
  | 'success'
  | 'warning'
  | 'danger'
  | 'violet'

const TONE_STYLES: Record<OperatorTone, string> = {
  neutral: 'border-white/10 bg-white/[0.035] text-zinc-300',
  accent: 'border-primary-500/45 bg-primary-500/12 text-primary-100',
  info: 'border-signal-cyan/45 bg-signal-cyan/12 text-sky-100',
  gold: 'border-signal-gold/45 bg-signal-gold/12 text-yellow-100',
  success: 'border-signal-green/45 bg-signal-green/12 text-emerald-100',
  warning: 'border-signal-amber/45 bg-signal-amber/12 text-amber-100',
  danger: 'border-signal-red/50 bg-signal-red/14 text-red-100',
  violet: 'border-signal-violet/45 bg-signal-violet/12 text-violet-100',
}

export interface OperatorCardProps {
  label: string
  value: ReactNode
  hint?: string
  icon: LucideIcon
  tone?: OperatorTone
  active?: boolean
  onClick?: () => void
}

export function OperatorCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  active = false,
  onClick,
}: OperatorCardProps) {
  const toneClassName = TONE_STYLES[tone]
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('operator-card__glyph', toneClassName)}>
          <Icon size={16} />
        </span>
        <span className="font-code text-2xl text-zinc-50">{value}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-zinc-100">{label}</p>
      {hint && <p className="mt-1 text-xs leading-5 text-zinc-500">{hint}</p>}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        data-active={active}
        onClick={onClick}
        className="operator-card group text-left"
      >
        {body}
      </button>
    )
  }

  return (
    <div
      data-active={active}
      className="operator-card"
    >
      {body}
    </div>
  )
}
