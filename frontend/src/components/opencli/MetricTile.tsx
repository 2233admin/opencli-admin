import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type MetricTone = 'neutral' | 'accent' | 'info' | 'gold' | 'success' | 'warning' | 'danger' | 'violet'

const TONE_STYLES: Record<MetricTone, { rail: string; icon: string; value: string }> = {
  neutral: {
    rail: 'bg-zinc-300',
    icon: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-200',
    value: 'text-zinc-50',
  },
  accent: {
    rail: 'bg-primary-500',
    icon: 'border-primary-500/40 bg-primary-500/10 text-primary-100',
    value: 'text-zinc-50',
  },
  info: {
    rail: 'bg-signal-cyan',
    icon: 'border-signal-cyan/40 bg-signal-cyan/10 text-sky-100',
    value: 'text-sky-100',
  },
  gold: {
    rail: 'bg-signal-gold',
    icon: 'border-signal-gold/40 bg-signal-gold/10 text-amber-100',
    value: 'text-amber-100',
  },
  success: {
    rail: 'bg-signal-green',
    icon: 'border-signal-green/40 bg-signal-green/10 text-emerald-100',
    value: 'text-emerald-100',
  },
  warning: {
    rail: 'bg-signal-amber',
    icon: 'border-signal-amber/40 bg-signal-amber/10 text-amber-100',
    value: 'text-amber-100',
  },
  danger: {
    rail: 'bg-signal-red',
    icon: 'border-signal-red/50 bg-signal-red/14 text-red-100',
    value: 'text-red-100',
  },
  violet: {
    rail: 'bg-signal-violet',
    icon: 'border-signal-violet/40 bg-signal-violet/10 text-violet-100',
    value: 'text-violet-100',
  },
}

interface MetricTileProps {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  icon?: LucideIcon
  tone?: MetricTone
  className?: string
}

export function MetricTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'neutral',
  className,
}: MetricTileProps) {
  const style = TONE_STYLES[tone]

  return (
    <div className={cn('operator-surface relative overflow-hidden p-3', className)}>
      <div className={cn('absolute inset-y-0 left-0 w-[2px]', style.rail)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="telemetry-label truncate">{label}</p>
          <p className={cn('telemetry-value mt-2 truncate text-2xl font-semibold', style.value)}>
            {value}
          </p>
        </div>
        {Icon && (
          <span className={cn('grid h-8 w-8 shrink-0 place-items-center border', style.icon)}>
            <Icon size={15} />
          </span>
        )}
      </div>
      {sub && <div className="mt-2 text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}
