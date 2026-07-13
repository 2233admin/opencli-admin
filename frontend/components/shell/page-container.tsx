'use client'

import { cn } from '@/lib/utils'

export function PageContainer({
  title,
  eyebrow,
  description,
  actions,
  tabs,
  children,
  className,
}: {
  title: string
  /** Uppercase tracked mono label above the headline (brand signature). */
  eyebrow?: string
  description?: string
  actions?: React.ReactNode
  /** Optional route tabs rendered under the header (sibling views). */
  tabs?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6', className)}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            {eyebrow ? <span className="eyebrow-mono">{eyebrow}</span> : null}
            <h1 className="type-headline-medium text-balance">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground text-pretty">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        {tabs}
      </div>
      <div className="flex flex-col gap-6">
        {children}
      </div>
    </div>
  )
}
