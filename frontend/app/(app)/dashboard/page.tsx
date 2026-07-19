'use client'

import Link from 'next/link'
import {
  Activity,
  Bot,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  GitBranch,
  Play,
  Radio,
  Send,
  Server,
  Tags,
} from 'lucide-react'

import { useAgents, useDashboardActivity, useDashboardStats, useNotificationLogs, useOpinionMonitor, useWorkers } from '@/lib/api/hooks'
import type { OpinionMonitor, WorkerNode } from '@/lib/api/types'
import type { FailureItem, StreamTask, ThroughputPoint, WorkerView } from '@/lib/demo/monitor'
import { formatNumber, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FailureFeed, TaskStream } from '@/components/monitor/task-stream'
import { ThroughputChart } from '@/components/monitor/throughput-chart'
import { OperationalAnalytics } from '@/components/monitor/operational-analytics'
import { WorkerAllocation } from '@/components/monitor/worker-allocation'
import { BACKEND_HINT, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function KpiCard({ title, value, sub, icon: Icon }: { title: string; value: string; sub?: string; icon: typeof Activity }) {
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

function ActionLink({ href, title, description, icon: Icon }: { href: string; title: string; description: string; icon: typeof Activity }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-border/70 bg-background/60 p-3 transition-colors hover:border-primary/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
    </Link>
  )
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function normalizedSuccessRate(value: number) {
  return Math.round(value <= 1 ? value * 100 : value)
}

function SignalFlow({
  sources,
  runs,
  records,
  aiProcessed,
  delivered,
  failures,
}: {
  sources: { enabled: number; total: number }
  runs: { successRate: number; total: number }
  records: number
  aiProcessed: number
  delivered: number
  failures: number
}) {
  const stages = [
    { label: '来源', detail: '已启用', value: `${sources.enabled}/${sources.total}`, progress: percent(sources.enabled, sources.total), icon: Database },
    { label: '运行', detail: '成功率', value: `${runs.successRate}%`, progress: runs.total ? runs.successRate : 0, icon: Play },
    { label: '数据', detail: '已采集', value: formatNumber(records), progress: records ? 100 : 0, icon: ArrowDownToLine },
    { label: 'Agent', detail: 'AI 已处理', value: `${percent(aiProcessed, records)}%`, progress: percent(aiProcessed, records), icon: Bot },
    { label: '交付', detail: '已连接渠道', value: formatNumber(delivered), progress: delivered ? 100 : 0, icon: Send },
  ]

  return (
    <section className="relative overflow-hidden rounded-xl border bg-card/55 p-4 md:p-5" aria-labelledby="signal-flow-title">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(90deg,transparent,rgba(127,127,127,0.08),transparent)]" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow-mono">Signal flow / 实时链路</p>
          <h2 id="signal-flow-title" className="mt-1 text-lg font-semibold">
            从来源到 Agent，再到交付
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">沿真实业务顺序定位停滞点；邮箱是本期 P0，专属投递统计等待后端接入。</p>
        </div>
        <Badge variant={failures ? 'destructive' : 'outline'}>{failures ? `${failures} 个运行异常` : '链路无阻塞'}</Badge>
      </div>
      <ol className="relative mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stages.map((stage, index) => {
          const Icon = stage.icon
          return (
            <li key={stage.label} className="group relative rounded-lg border border-border/70 bg-background/65 p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="font-mono text-lg tabular-nums">{stage.value}</span>
              </div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <span className="text-sm font-medium">{stage.label}</span>
                <span className="text-[10px] text-muted-foreground">{stage.detail}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/75 transition-[width]" style={{ width: `${stage.progress}%` }} />
              </div>
              {index < stages.length - 1 ? (
                <span className="absolute -right-2.5 top-1/2 z-10 hidden text-xs text-muted-foreground/50 xl:block" aria-hidden>
                  →
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function AgentDeliveryPanel({
  agents,
  notificationLogs,
  agentsLoading,
  logsLoading,
}: {
  agents: Array<{ id: string; name: string; processor_type: string; model?: string; enabled: boolean }>
  notificationLogs: Array<{ id: string; status: string; ack_status: string; created_at: string }>
  agentsLoading: boolean
  logsLoading: boolean
}) {
  const enabledAgents = agents.filter((agent) => agent.enabled)
  const delivered = notificationLogs.filter((log) => ['sent', 'success', 'completed'].includes(log.status.toLowerCase())).length
  const failed = notificationLogs.filter((log) => log.status.toLowerCase().includes('fail') || log.status.toLowerCase().includes('error')).length

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4 text-primary" aria-hidden />
            Agent 与交付
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">谁在处理信号，以及结果是否抵达外部渠道。</p>
        </div>
        <Badge variant="outline">邮箱 P0</Badge>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-2">
          {agentsLoading ? (
            <p className="text-sm text-muted-foreground">正在同步 Agent…</p>
          ) : enabledAgents.length ? (
            enabledAgents.slice(0, 4).map((agent) => (
              <Link key={agent.id} href="/agents" className="flex items-center gap-3 rounded-lg border border-border/70 p-3 transition-colors hover:bg-muted/50">
                <span className="relative grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Bot className="size-4" />
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-background bg-success" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{agent.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {agent.processor_type}
                    {agent.model ? ` · ${agent.model}` : ''}
                  </span>
                </span>
                <span className="font-mono text-[9px] text-success">READY</span>
              </Link>
            ))
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">还没有启用 Agent。先到 Agent 团队配置处理能力。</div>
          )}
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">通知日志</span>
            <Radio className="size-3.5 text-success" aria-hidden />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="font-mono text-2xl tabular-nums">{logsLoading ? '—' : delivered}</div>
              <div className="text-[10px] text-muted-foreground">已送达</div>
            </div>
            <div>
              <div className="font-mono text-2xl tabular-nums text-destructive">{logsLoading ? '—' : failed}</div>
              <div className="text-[10px] text-muted-foreground">失败</div>
            </div>
          </div>
          <div className="mt-4 border-t pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">邮箱专属统计</span>
              <span>待后端接入</span>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">当前只展示通用通知日志，不把其他渠道计数冒充邮件发送结果。</p>
          </div>
          <Link href="/notifications" className="mt-4 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            查看通知与邮箱配置
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function OpinionMonitorPanel({ data, isLoading, isError }: { data?: OpinionMonitor; isLoading: boolean; isError: boolean }) {
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
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary || item.source_name}</p>
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
  const agentsQuery = useAgents({ enabled: true })
  const notificationLogsQuery = useNotificationLogs()

  if (stats.isLoading) {
    return (
      <PageContainer eyebrow="Control plane" title="运营工作台" description="先处理异常，再推进正在运行的工作。">
        <LoadingState rows={3} />
      </PageContainer>
    )
  }

  if (stats.isError || !stats.data) {
    return (
      <PageContainer eyebrow="Control plane" title="运营工作台" description="先处理异常，再推进正在运行的工作。">
        <ErrorState message={(stats.error as Error)?.message} hint={BACKEND_HINT} action={<Button onClick={() => stats.refetch()}>重新连接</Button>} />
      </PageContainer>
    )
  }

  const s = stats.data
  const kpis: Array<{ title: string; value: string; sub?: string; icon: typeof Activity }> = [
    {
      title: '采集记录',
      value: formatNumber(s.records.total),
      sub: `AI 处理 ${formatNumber(s.records.ai_processed)}`,
      icon: ArrowDownToLine,
    },
    {
      title: '任务总量',
      value: formatNumber(s.tasks.total),
      sub: `运行中 ${s.tasks.running} · 失败 ${s.tasks.failed}`,
      icon: Send,
    },
    {
      title: '运行成功率',
      value: `${Math.round(s.runs.success_rate ?? 0)}%`,
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
  const throughput: ThroughputPoint[] = (activity.data?.daily ?? []).map((d) => ({
    time: d.date.slice(5),
    collected: d.success_runs,
    dispatched: d.new_records,
    failed: d.failed_runs,
  }))
  const workers: WorkerView[] = (workersQuery.data?.data ?? []).map((w: WorkerNode) => {
    const concurrency = typeof w.concurrency === 'number' && w.concurrency > 0 ? w.concurrency : null
    return {
      id: w.id,
      name: w.hostname,
      lane: 'collect' as const,
      region: w.worker_id.slice(0, 8),
      online: w.status === 'online',
      load: concurrency === null ? null : Math.min(100, Math.round((w.active_tasks / concurrency) * 100)),
      queue: concurrency === null ? 0 : Math.max(0, w.active_tasks - concurrency),
      current:
        w.active_tasks > 0
          ? `${concurrency === null ? w.active_tasks : Math.min(w.active_tasks, concurrency)} 个任务运行中`
          : null,
      doneToday: null,
      failedToday: null,
    }
  })
  const stream = runsToStream(s.recent_runs ?? [])
  const failures: FailureItem[] = stream
    .filter((task) => task.phase === 'failed')
    .map((task) => ({
      id: `f-${task.id}`,
      lane: task.lane,
      title: task.title,
      workerName: task.workerName,
      error: '查看任务详情获取错误信息',
      retries: task.retries,
      at: task.startedAt,
    }))
  const latestRun = stream[0]
  const hasAttention = s.tasks.failed > 0 || failures.length > 0
  const agents = agentsQuery.data?.data ?? []
  const notificationLogs = notificationLogsQuery.data?.data ?? []

  return (
    <PageContainer
      eyebrow="Control plane"
      title="运营工作台"
      description="先处理异常，再推进正在运行的工作。"
      actions={
        <Badge variant="outline" className="gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
          实时
        </Badge>
      }
    >
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]" aria-labelledby="attention-title">
        <Card
          className={cn(
            'relative isolate min-h-72 overflow-hidden border-0 py-0 ring-1',
            hasAttention ? 'bg-destructive/[0.055] ring-destructive/25' : 'bg-primary/[0.045] ring-primary/20',
          )}
        >
          <div className={cn('absolute inset-y-0 left-0 w-1', hasAttention ? 'bg-destructive' : 'bg-success')} aria-hidden />
          <CardContent className="flex h-full flex-col justify-between gap-8 p-5 pl-6 md:p-7 md:pl-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="eyebrow-mono" id="attention-title">
                  需要你处理
                </p>
                <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight md:text-3xl">
                  {hasAttention ? `${formatNumber(s.tasks.failed)} 个失败任务需要检查` : '当前没有阻塞，可以继续推进工作'}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  {hasAttention ? '先查看失败原因和最近运行记录，再决定重试、调整来源或修改工作流。' : '运行链路没有发现失败任务。你可以创建工作流、接入来源，或检查下一次调度。'}
                </p>
              </div>
              <span className={cn('grid size-12 shrink-0 place-items-center rounded-xl', hasAttention ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}>
                {hasAttention ? <AlertTriangle className="size-6" aria-hidden /> : <CheckCircle2 className="size-6" aria-hidden />}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/tasks"
                className={buttonVariants({
                  variant: hasAttention ? 'destructive' : 'default',
                  size: 'lg',
                })}
              >
                {hasAttention ? '查看失败工作项' : '查看工作项'}
                <ArrowRight aria-hidden />
              </Link>
              <Link href="/control/actions" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                查看控制记录
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-72">
          <CardHeader>
            <p className="eyebrow-mono">现在正在发生</p>
            <CardTitle className="mt-2 text-xl">运行态势</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between rounded-lg border border-border/70 p-3">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Play className="size-4" aria-hidden />
                </span>
                <div>
                  <div className="text-sm font-medium">正在运行</div>
                  <div className="text-xs text-muted-foreground">当前活跃任务</div>
                </div>
              </div>
              <span className="font-mono text-2xl tabular-nums">{formatNumber(s.tasks.running)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/70 p-3">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Clock3 className="size-4" aria-hidden />
                </span>
                <div>
                  <div className="text-sm font-medium">最近一次运行</div>
                  <div className="text-xs text-muted-foreground">{latestRun ? formatRelative(new Date(latestRun.startedAt).toISOString()) : '暂无运行记录'}</div>
                </div>
              </div>
              {latestRun ? (
                <Badge variant="outline">
                  {latestRun.phase === 'success' ? '成功' : latestRun.phase === 'failed' ? '失败' : latestRun.phase === 'running' ? '运行中' : '排队中'}
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/70 p-3">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Server className="size-4" aria-hidden />
                </span>
                <div>
                  <div className="text-sm font-medium">在线 Worker</div>
                  <div className="text-xs text-muted-foreground">执行节点可用性</div>
                </div>
              </div>
              <span className="font-mono text-lg tabular-nums">
                {workers.filter((worker) => worker.online).length} / {workers.length}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="next-action-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow-mono">下一步</p>
            <h2 id="next-action-title" className="mt-1 text-lg font-semibold">
              从这里继续工作
            </h2>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActionLink href="/studio" title="编排工作流" description="先选择项目，再设计节点和执行链路" icon={GitBranch} />
          <ActionLink href="/sources" title="接入数据源" description="配置采集来源与凭证" icon={Database} />
          <ActionLink href="/schedules" title="设置触发调度" description="决定何时自动运行" icon={Clock3} />
          <ActionLink href="/tasks" title="检查运行结果" description="查看任务、记录与通知" icon={Activity} />
        </div>
      </section>

      <section aria-labelledby="system-overview-title">
        <div className="mb-3">
          <p className="eyebrow-mono">系统概览</p>
          <h2 id="system-overview-title" className="mt-1 text-lg font-semibold">
            关键指标
          </h2>
        </div>
        <SignalFlow
          sources={s.sources}
          runs={{ successRate: normalizedSuccessRate(s.runs.success_rate ?? 0), total: s.runs.total }}
          records={s.records.total}
          aiProcessed={s.records.ai_processed}
          delivered={opinion.data?.summary.feishu_sent ?? notificationLogs.filter((log) => ['sent', 'success', 'completed'].includes(log.status.toLowerCase())).length}
          failures={failures.length}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.title} {...k} />
          ))}
        </div>
      </section>

      <OperationalAnalytics
        stats={s}
        opinion={opinion.data}
        opinionLoading={opinion.isLoading}
        opinionError={opinion.isError}
      />

      <AgentDeliveryPanel agents={agents} notificationLogs={notificationLogs} agentsLoading={agentsQuery.isLoading} logsLoading={notificationLogsQuery.isLoading} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TaskStream tasks={stream} />
        </div>
        <FailureFeed failures={failures} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ThroughputChart data={throughput} daily />
        </div>
        <WorkerAllocation workers={workers} />
      </div>

      <OpinionMonitorPanel data={opinion.data} isLoading={opinion.isLoading} isError={opinion.isError} />
    </PageContainer>
  )
}
