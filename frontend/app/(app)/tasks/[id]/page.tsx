'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, Database, Radio, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { use, useEffect, useState } from 'react'

import { BACKEND_HINT, EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { StatusBadge } from '@/components/shell/status-badge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSource, getTask, listRunEvents, listTaskRuns } from '@/lib/api/endpoints'
import { formatDateTime, formatDuration, formatNumber, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled'])

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const task = useQuery({ queryKey: ['tasks', id], queryFn: () => getTask(id), refetchInterval: 10_000 })
  const source = useQuery({
    queryKey: ['sources', task.data?.source_id],
    queryFn: () => getSource(task.data!.source_id),
    enabled: Boolean(task.data?.source_id),
  })
  const runs = useQuery({
    queryKey: ['tasks', id, 'runs'],
    queryFn: () => listTaskRuns(id),
    refetchInterval: (query) => {
      const active = query.state.data?.data.some((run) => !TERMINAL_STATES.has(run.status))
      return active ? 5_000 : false
    },
  })

  useEffect(() => {
    if (!selectedRunId && runs.data?.data[0]) setSelectedRunId(runs.data.data[0].id)
  }, [runs.data?.data, selectedRunId])

  const selectedRun = runs.data?.data.find((run) => run.id === selectedRunId) ?? runs.data?.data[0]
  const events = useQuery({
    queryKey: ['tasks', id, 'runs', selectedRun?.id, 'events'],
    queryFn: () => listRunEvents(id, selectedRun!.id),
    enabled: Boolean(selectedRun?.id),
    refetchInterval: selectedRun && !TERMINAL_STATES.has(selectedRun.status) ? 3_000 : false,
  })

  const item = task.data
  const eventItems = events.data ?? []

  return (
    <PageContainer
      eyebrow="Work item"
      title={source.data?.name ?? item?.source_name ?? `工作项 ${id.slice(0, 8)}`}
      description={item ? `${item.trigger_type} 触发 · 创建于 ${formatRelative(item.created_at)}` : '查看工作上下文、运行记录、事件与成果。'}
      actions={
        <Link href="/tasks" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          <ArrowLeft className="size-4" />
          返回工作项
        </Link>
      }
    >
      {task.isLoading ? (
        <LoadingState rows={4} />
      ) : task.isError ? (
        <ErrorState message={(task.error as Error)?.message} hint={BACKEND_HINT} />
      ) : item ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">执行摘要</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">当前状态与最近一次运行结果。</p>
                </div>
                <StatusBadge status={item.status} />
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryMetric icon={Radio} label="运行状态" value={selectedRun?.status ?? '尚未运行'} />
                <SummaryMetric icon={Database} label="采集记录" value={formatNumber(selectedRun?.records_collected)} />
                <SummaryMetric icon={Clock3} label="执行耗时" value={formatDuration(selectedRun?.duration_ms)} />
                <SummaryMetric icon={RotateCcw} label="运行次数" value={formatNumber(runs.data?.meta?.total ?? runs.data?.data.length)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">运行记录</CardTitle>
              </CardHeader>
              <CardContent>
                {runs.isLoading ? (
                  <LoadingState rows={2} />
                ) : runs.isError ? (
                  <ErrorState message={(runs.error as Error)?.message} />
                ) : runs.data?.data.length ? (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {runs.data.data.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setSelectedRunId(run.id)}
                        className={cn(
                          'flex items-center justify-between gap-4 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
                          selectedRun?.id === run.id && 'border-primary/40 bg-primary/5',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-muted-foreground">{run.id}</div>
                          <div className="mt-1 text-sm">{formatRelative(run.created_at)} · {formatDuration(run.duration_ms)}</div>
                        </div>
                        <StatusBadge status={run.status} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="尚未产生运行" description="工作项被执行后，运行记录会显示在这里。" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">执行时间线</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">先看结果摘要，需要时再展开底层事件。</p>
                </div>
                {selectedRun ? <Badge variant="outline">{selectedRun.id.slice(0, 8)}</Badge> : null}
              </CardHeader>
              <CardContent>
                {events.isLoading ? (
                  <LoadingState rows={3} />
                ) : events.isError ? (
                  <ErrorState message={(events.error as Error)?.message} />
                ) : eventItems.length ? (
                  <ol className="relative ml-2 space-y-5 border-l pl-5">
                    {eventItems.map((event) => (
                      <li key={event.id} className="relative">
                        <span className={cn(
                          'absolute -left-[1.62rem] top-1.5 size-2.5 rounded-full border-2 border-background',
                          event.level === 'error' ? 'bg-destructive' : event.level === 'warning' ? 'bg-warning' : 'bg-primary',
                        )} />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{event.step}</span>
                          <Badge variant="outline">{event.level}</Badge>
                          <span className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyState title="暂无执行事件" description="选中的运行还没有上报事件。" />
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">工作上下文</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <ContextRow label="来源" value={source.data?.name ?? item.source_name ?? item.source_id} mono={!source.data?.name && !item.source_name} />
                <ContextRow label="触发方式" value={item.trigger_type} />
                <ContextRow label="优先级" value={String(item.priority)} mono />
                <ContextRow label="创建时间" value={formatDateTime(item.created_at)} />
                {item.error_message ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-destructive"><AlertTriangle className="size-4" />需要处理</div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.error_message}</p>
                  </div>
                ) : item.status === 'completed' ? (
                  <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
                    <div className="flex items-center gap-2"><CheckCircle2 className="size-4" />执行已完成，可以检查数据成果。</div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">下一步</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                <Link href={`/sources/${item.source_id}`} className={cn(buttonVariants({ variant: 'outline' }), 'justify-between')}>
                  查看数据源 <ArrowUpRight className="size-4" />
                </Link>
                <Link href="/records" className={cn(buttonVariants({ variant: 'outline' }), 'justify-between')}>
                  检查数据成果 <ArrowUpRight className="size-4" />
                </Link>
                <Link href="/control/actions" className={cn(buttonVariants({ variant: 'ghost' }), 'justify-between')}>
                  查看控制与审计 <ArrowUpRight className="size-4" />
                </Link>
              </CardContent>
            </Card>
          </aside>
        </div>
      ) : null}
    </PageContainer>
  )
}

function SummaryMetric({ icon: Icon, label, value }: { icon: typeof Radio; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/45 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <div className="mt-2 truncate font-mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function ContextRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('max-w-44 text-right', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  )
}
