'use client'

import type { ReactNode } from 'react'
import { AlertCircle, BarChart3 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type VisualizationCardProps = {
  title: string
  description?: string
  eyebrow?: string
  children: ReactNode
  toolbar?: ReactNode
  loading?: boolean
  error?: boolean
  empty?: boolean
  emptyMessage?: string
  className?: string
  contentClassName?: string
}

export function VisualizationCard({
  title,
  description,
  eyebrow,
  children,
  toolbar,
  loading = false,
  error = false,
  empty = false,
  emptyMessage = '暂无可用数据',
  className,
  contentClassName,
}: VisualizationCardProps) {
  return (
    <Card className={className} aria-busy={loading}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow-mono">{eyebrow}</p> : null}
          <CardTitle className={cn('text-base', eyebrow && 'mt-1')}>{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {toolbar}
      </CardHeader>
      <CardContent className={cn('min-h-48', contentClassName)}>
        {loading ? (
          <div className="grid h-48 content-end gap-3" role="status" aria-label={`正在加载${title}`}>
            <Skeleton className="h-8 w-2/5" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div className="grid h-48 place-items-center text-center" role="alert">
            <div>
              <AlertCircle className="mx-auto size-5 text-destructive" aria-hidden />
              <p className="mt-2 text-sm font-medium">数据暂时不可用</p>
              <p className="mt-1 text-xs text-muted-foreground">请稍后重试或检查数据连接。</p>
            </div>
          </div>
        ) : empty ? (
          <div className="grid h-48 place-items-center text-center">
            <div>
              <BarChart3 className="mx-auto size-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm text-muted-foreground">{emptyMessage}</p>
            </div>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}
