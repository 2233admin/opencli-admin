'use client'

import { cn } from '@/lib/utils'

export type ConversionStage = {
  key: string
  label: string
  detail: string
  value: number
  tone?: 'default' | 'success' | 'warning' | 'destructive'
}

const toneClass = {
  default: 'bg-primary/70',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
}

export function ConversionFunnel({
  stages,
  ariaLabel,
}: {
  stages: ConversionStage[]
  ariaLabel: string
}) {
  return (
    <ol className="space-y-4" aria-label={ariaLabel}>
      {stages.map((stage) => {
        const value = Math.max(0, Math.min(100, Math.round(stage.value)))
        return (
          <li key={stage.key}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{stage.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{stage.detail}</div>
              </div>
              <span className="font-mono text-sm tabular-nums">{value}%</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={stage.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
            >
              <div
                className={cn('h-full rounded-full transition-[width]', toneClass[stage.tone ?? 'default'])}
                style={{ width: `${value}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
