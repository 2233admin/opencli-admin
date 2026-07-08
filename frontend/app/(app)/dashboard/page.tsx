'use client'

import { Activity, ArrowDownToLine, BellRing, BrainCircuit, CheckCircle2, Send, Server, Tags } from 'lucide-react'

import { useDashboardActivity, useDashboardStats, useOpinionMonitor, useWorkers } from '@/lib/api/hooks'
import type { OpinionMonitor, WorkerNode } from '@/lib/api/types'
import {
  useMonitorFeed,
  type FailureItem,
  type StreamTask,
  type ThroughputPoint,
  type WorkerView,
} from '@/lib/demo/monitor'
import { formatNumber, formatRelative } from '@/lib/format'
import { FailureFeed, TaskStream } from '@/components/monitor/task-stream'
import { ThroughputChart } from '@/components/monitor/throughput-chart'
import { WorkerAllocation } from '@/components/monitor/worker-allocation'
import { LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string
  value: string
  sub?: string
  icon: typeof Activity
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent>
        <div className="font-mono text-2xl tabular-nums">{value}</div>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

function OpinionMonitorPanel({
  data,
  isLoading,
  isError,
}: {
  data?: OpinionMonitor
  isLoading: boolean
  isError: boolean
}) {
  const topTags = data?.tags.slice(0, 6) ?? []
  const topSentiment = data?.sentiment.slice(0, 4) ?? []
  const recent = data?.recent ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="size-4 text-primary" aria-hidden />
            舆情监控
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">采集、AI 打标、飞书推送的最近 7 天实况</p>
        </div>
        {isError ? (
          <Badge variant="outline">未连接</Badge>
        ) : isLoading ? (
          <Badge variant="outline">同步中</Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            真实数据
          </Badge>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowDownToLine className="size-3.5" aria-hidden />
              记录 / AI
            </div>
            <div className="mt-2 font-mono text-xl">
              {formatNumber(data?.summary.records ?? 0)} / {formatNumber(data?.summary.ai_processed ?? 0)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BellRing className="size-3.5" aria-hidden />
              飞书发送
            </div>
            <div className="mt-2 font-mono text-xl">
              {formatNumber(data?.summary.feishu_sent ?? 0)}
              <span className="ml-2 text-xs text-muted-foreground">失败 {data?.summary.feishu_failed ?? 0}</span>
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Tags className="size-3.5" aria-hidden />
              标签 / 情绪
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[...topTags, ...topSentiment].slice(0, 7).map((item) => (
                <Badge key={`${item.label}-${item.count}`} variant="secondary">
                  {item.label} · {item.count}
                </Badge>
              ))}
              {!topTags.length && !topSentiment.length ? <span className="text-sm text-muted-foreground">暂无</span> : null}
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-md border">
          {recent.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">暂无已采集舆情记录</div>
          ) : (
            <div className="divide-y">
              {recent.map((item) => (
                <div key={item.id} className="grid gap-2 p-3 md:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{item.title}</span>
                      <Badge variant={item.notification_status === 'sent' ? 'secondary' : 'outline'}>
                        飞书 {item.notification_status === 'sent' ? '已发' : item.notification_status === 'failed' ? '失败' : '待发'}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.summary || item.source_name}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                      <Badge variant="outline">{item.sentiment}</Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    <div>{item.source_name}</div>
                    <div className="mt-1">{formatRelative(item.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Map backend recent runs into the shared stream shape. */
function runsToStream(
  runs: Array<{
    id: string
    source_name: string
    task_trigger_type: string
    status: string
    records_collected: number
    duration_ms?: number | null
    created_at?: string
  }>,
): StreamTask[] {
  return runs.map((r) => ({
    id: r.id,
    lane: 'collect' as const,
    title: `${r.source_name} 采集`,
    endpoint: r.source_name,
    workerId: '',
    workerName: r.task_trigger_type,
    phase:
      r.status === 'success' || r.status === 'completed'
        ? ('success' as const)
        : r.status === 'failed'
          ? ('failed' as const)
          : r.status === 'running'
            ? ('running' as const)
            : ('queued' as const),
    records: r.records_collected,
    retries: 0,
    startedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    durationMs: r.duration_ms ?? null,
  }))
}

export default function DashboardPage() {
  const stats = useDashboardStats()
  const activity = useDashboardActivity()
  const opinion = useOpinionMonitor()
  const workersQuery = useWorkers()

  const demoMode = stats.isError
  const demo = useMonitorFeed(demoMode)

  if (stats.isLoading || (demoMode && !demo)) {
    return (
      <PageContainer eyebrow="Monitor" title="监控台" description="采集 → 发送全链路任务分配态势">
        <LoadingState rows={3} />
      </PageContainer>
    )
  }

  // ── Resolve view models: real backend data first, demo feed as fallback ──
  let kpis: Array<{ title: string; value: string; sub?: string; icon: typeof Activity }>
  let throughput: ThroughputPoint[]
  let workers: WorkerView[]
  let stream: StreamTask[]
  let failures: FailureItem[]
  let daily = false

  if (!demoMode && stats.data) {
    const s = stats.data
    kpis = [
      {
        title: '采集记录',
        value: formatNumber(s.records.total),
        sub: `AI 处理 ${formatNumber(s.records.ai_processed)}`,
        icon: ArrowDownToLine,
      },
      {
        title: '任务',
        value: formatNumber(s.tasks.total),
        sub: `运行中 ${s.tasks.running} · 失败 ${s.tasks.failed}`,
        icon: Send,
      },
      {
        title: '运行成功率',
        value: `${Math.round((s.runs.success_rate ?? 0) * 100)}%`,
        sub: `成功 ${s.runs.success} · 失败 ${s.runs.failed}`,
        icon: CheckCircle2,
      },
      {
        title: '数据源',
        value: formatNumber(s.sources.total),
        sub: `启用 ${s.sources.enabled} · 停用 ${s.sources.disabled}`,
        icon: Server,
      },
    ]
    daily = true
    throughput = (activity.data?.daily ?? []).map((d) => ({
      time: d.date.slice(5),
      collected: d.success_runs,
      dispatched: d.new_records,
      failed: d.failed_runs,
    }))
    workers = (workersQuery.data?.data ?? []).map((w: WorkerNode) => ({
      id: w.id,
      name: w.hostname,
      lane: 'collect' as const,
      region: w.worker_id.slice(0, 8),
      online: w.status === 'online',
      load: Math.min(96, w.active_tasks * 18),
      queue: w.active_tasks,
      current: w.active_tasks > 0 ? `${w.active_tasks} 个任务执行中` : null,
      doneToday: 0,
      failedToday: 0,
    }))
    stream = runsToStream(s.recent_runs ?? [])
    failures = stream
      .filter((t) => t.phase === 'failed')
      .map((t) => ({
        id: `f-${t.id}`,
        lane: t.lane,
        title: t.title,
        workerName: t.workerName,
        error: '查看任务详情获取错误信息',
        retries: t.retries,
        at: t.startedAt,
      }))
  } else {
    const d = demo!
    kpis = [
      {
        title: '采集吞吐',
        value: `${d.kpi.collectPerMin}/min`,
        sub: `今日记录 ${formatNumber(d.kpi.recordsToday)}`,
        icon: ArrowDownToLine,
      },
      {
        title: '发送吞吐',
        value: `${d.kpi.dispatchPerMin}/min`,
        sub: `今日已发送 ${formatNumber(d.kpi.dispatchedToday)}`,
        icon: Send,
      },
      {
        title: '成功率',
        value: `${(d.kpi.successRate * 100).toFixed(1)}%`,
        sub: '近 30 分钟滚动窗口',
        icon: CheckCircle2,
      },
      {
        title: '队列 / Worker',
        value: `${d.kpi.queueDepth}`,
        sub: `在线 Worker ${d.kpi.onlineWorkers}/${d.kpi.totalWorkers}`,
        icon: Server,
      },
    ]
    throughput = d.throughput
    workers = d.workers
    stream = d.stream
    failures = d.failures
  }

  return (
    <PageContainer
      eyebrow="Monitor"
      title="监控台"
      description="采集 → 发送全链路任务分配态势"
      actions={
        demoMode ? (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-warning" aria-hidden />
            演示数据 · 未连接后端
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
            实时
          </Badge>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.title} {...k} />
        ))}
      </div>

      <OpinionMonitorPanel data={opinion.data} isLoading={opinion.isLoading} isError={opinion.isError} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ThroughputChart data={throughput} daily={daily} />
        </div>
        <FailureFeed failures={failures} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TaskStream tasks={stream} />
        </div>
        <WorkerAllocation workers={workers} />
      </div>
    </PageContainer>
  )
}
