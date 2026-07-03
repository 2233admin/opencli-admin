import { cn } from '@/lib/utils'

interface PanelHeaderProps {
  label: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function PanelHeader({
  label,
  title,
  description,
  actions,
  className,
}: PanelHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-white/10 px-5 py-4 xl:flex-row xl:items-center xl:justify-between', className)}>
      <div className="min-w-0">
        <p className="telemetry-label">{label}</p>
        <div className="mt-1 min-w-0">{title}</div>
        {description && <div className="mt-1 text-xs text-zinc-500">{description}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}
