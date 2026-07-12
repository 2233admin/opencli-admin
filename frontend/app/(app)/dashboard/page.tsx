'use client'

import { Activity, ArrowDownToLine, BellRing, BrainCircuit, CheckCircle2, CircleAlert, Radio, Send, Server, Tags } from 'lucide-react'

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
import { MatrixClock } from '@/components/monitor/matrix-clock'
import { PinList, type PinListItem } from '@/components/animate-ui/components/community/pin-list'
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
    <Card className="group overflow-hidden border-border/80 bg-card/70">
      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-primary/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</CardTitle>
        <span className="grid size-7 place-items-center rounded-sm border bg-background/50">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden />
        </span>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-3xl tracking-[-0.06em] tabular-nums">{value}</div>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function normalizedSuccessRate(value: number) {
  return Math.round(value <= 1 ? value * 100 : value)
}

function OperationsChain({
  sources,
  runs,
  records,
  aiProcessed,
  delivered,
  deliveryRecords,
  failures,
}: {
  sources: { enabled: number; total: number }
  runs: { successRate: number; total: number }
  records: number
  aiProcessed: number
  delivered: number
  deliveryRecords: number
  failures: number
}) {
  const stages = [
    { label: '来源就绪', value: `${sources.enabled}/${sources.total}`, progress: percent(sources.enabled, sources.total) },
    { label: '运行成功', value: `${runs.successRate}%`, progress: runs.total ? runs.successRate : 0 },
    { label: '数据入库', value: formatNumber(records), progress: records ? 100 : 0 },
    { label: 'AI 处理', value: `${percent(aiProcessed, records)}%`, progress: percent(aiProcessed, records) },
    { label: '近 7 日交付', value: formatNumber(delivered), progress: Math.min(100, percent(delivered, deliveryRecords)) },
  ]

  return (
    <section className="rounded-xl border bg-card/55 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="eyebrow-mono">Production chain / 当前状态</span>
          <h2 className="mt-1 text-lg">从来源到交付</h2>
          <p className="mt-1 text-sm text-muted-foreground">按真实执行顺序查看系统现在卡在哪里，而不是逐个解释指标。</p>
        </div>
        <div className={failures ? 'text-warning' : 'text-success'}>
          <div className="flex items-center justify-end gap-2 text-sm font-medium">
            {failures ? <CircleAlert className="size-4" /> : <CheckCircle2 className="size-4" />}
            {failures ? `${failures} 个运行需要关注` : '当前无需人工处理'}
          </div>
          <p className="mt-1 text-right text-xs text-muted-foreground">异常才进入 Inbox，正常状态保持安静</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stages.map((stage, index) => (
          <div key={stage.label} className="relative rounded-lg border bg-background/45 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{stage.label}</span>
              <span className="font-mono text-sm tabular-nums">{stage.value}</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-foreground/70" style={{ width: `${stage.progress}%` }} />
            </div>
            {index < stages.length - 1 ? <span className="absolute -right-2.5 top-1/2 z-10 hidden text-xs text-muted-foreground/45 lg:block">→</span> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function SystemPulse({
  demoMode,
  workers,
  queueDepth,
  failures,
}: {
  demoMode: boolean
  workers: WorkerView[]
  queueDepth: number
  failures: FailureItem[]
}) {
  const online = workers.filter((worker) => worker.online).length
  const averageLoad = workers.length
    ? Math.round(workers.reduce((sum, worker) => sum + worker.load, 0) / workers.length)
    : 0
  const pulseState = demoMode
    ? { label: '演示遥测', description: '连接后端后自动切换为真实控制面数据。', tone: 'text-white/55' }
    : failures.length
      ? { label: '系统需要关注', description: `${failures.length} 个异常运行等待处理，其余链路继续上报。`, tone: 'text-amber-300' }
      : { label: '系统运行正常', description: '数据采集、处理与发送链路持续上报。', tone: 'text-white/70' }

  return (
    <section className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0c1110] text-white">
      <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="relative grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5">
        <div className="min-w-0">
          <div className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] ${pulseState.tone}`}>
            <Radio className="size-3.5" aria-hidden />
            {pulseState.label}
          </div>
          <p className="mt-1.5 text-xs text-white/45">
            {pulseState.description}
          </p>
          <div className="mt-3 flex max-w-xl divide-x divide-white/10 border-t border-white/10 pt-3">
            <PulseMetric label="节点在线" value={`${online}/${workers.length}`} tone="text-white/90" />
            <PulseMetric label="平均负载" value={`${averageLoad}%`} tone={averageLoad >= 75 ? 'text-amber-300' : 'text-white/90'} />
            <PulseMetric label="待处理 / 异常" value={`${queueDepth} / ${failures.length}`} tone={failures.length ? 'text-amber-300' : 'text-white/90'} />
          </div>
        </div>
        <div className="min-w-[190px] justify-self-end text-right">
          <MatrixClock />
          <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/25">Local time</div>
        </div>
      </div>
    </section>
  )
}

function PulseMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0 flex-1 px-3 first:pl-0 last:pr-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">{label}</div>
      <div className={`mt-1 font-mono text-base tracking-[-0.04em] tabular-nums sm:text-lg ${tone}`}>{value}</div>
    </div>
  )
}

function WatchList({ workers, failures }: { workers: WorkerView[]; failures: FailureItem[] }) {
  const items: PinListItem[] = [
    ...failures.slice(0, 3).map((failure) => ({
      id: failure.id,
      name: failure.title,
      info: `${failure.workerName} · ${failure.error}`,
      icon: CircleAlert,
      pinned: true,
    })),
    ...workers.slice(0, 5).map((worker) => ({
      id: worker.id,
      name: worker.name,
      info: worker.online ? `在线 · 负载 ${worker.load}%` : '离线 · 等待恢复',
      icon: Server,
      pinned: !worker.online,
    })),
  ]

  if (!items.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">关注对象</CardTitle>
        <p className="text-sm text-muted-foreground">异常对象自动置顶；点击图钉可调整本次查看顺序。</p>
      </CardHeader>
      <CardContent>
        <PinList
          items={items}
          labels={{ pinned: '重点关注', unpinned: '其他运行对象' }}
          className="space-y-5"
          pinnedSectionClassName="space-y-2"
          unpinnedSectionClassName="space-y-2"
        />
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
        value: `${normalizedSuccessRate(s.runs.success_rate ?? 0)}%`,
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
      eyebrow="Operations / Live telemetry"
      title="系统监控台"
      description="从采集入口到外部发送的实时运行态势"
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
      <SystemPulse
        demoMode={demoMode}
        workers={workers}
        queueDepth={demoMode ? demo!.kpi.queueDepth : stats.data?.tasks.running ?? 0}
        failures={failures}
      />

      <OperationsChain
        sources={{ enabled: stats.data?.sources.enabled ?? 0, total: stats.data?.sources.total ?? 0 }}
        runs={{
          successRate: demoMode ? Math.round(demo!.kpi.successRate * 100) : normalizedSuccessRate(stats.data?.runs.success_rate ?? 0),
          total: demoMode ? demo!.stream.length : stats.data?.runs.total ?? 0,
        }}
        records={demoMode ? demo!.kpi.recordsToday : stats.data?.records.total ?? 0}
        aiProcessed={demoMode ? 0 : stats.data?.records.ai_processed ?? 0}
        delivered={demoMode ? demo!.kpi.dispatchedToday : opinion.data?.summary.feishu_sent ?? 0}
        deliveryRecords={demoMode ? demo!.kpi.recordsToday : opinion.data?.summary.records ?? 0}
        failures={failures.length}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.title} {...k} />
        ))}
      </div>

      <OpinionMonitorPanel data={opinion.data} isLoading={opinion.isLoading} isError={opinion.isError} />

      <WatchList workers={workers} failures={failures} />

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
