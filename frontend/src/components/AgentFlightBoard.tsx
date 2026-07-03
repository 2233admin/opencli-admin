import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatInTimeZone } from 'date-fns-tz'
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle,
  CircleDollarSign,
  CircleDot,
  Cpu,
  Database,
  MessageSquare,
  Timer,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { listRunEvents } from '../api/endpoints'
import type { DashboardStats, TaskRunEvent } from '../api/types'
import Card from './Card'
import StatusBadge from './StatusBadge'
import { MetricTile, PanelHeader, PlaybackControls } from './opencli'

type RecentRun = DashboardStats['recent_runs'][number]
type FlightKind = 'user' | 'agent' | 'model' | 'tool' | 'store' | 'notify' | 'output'
type FlightStatus = 'done' | 'running' | 'failed' | 'queued'

interface FlightStep {
  id: string
  role: string
  title: string
  message: string
  kind: FlightKind
  status: FlightStatus
  elapsedMs?: number
  tokens?: number
  costUsd?: number
  detail?: Record<string, unknown>
}

const KIND_META: Record<FlightKind, {
  icon: LucideIcon
  accent: string
  chip: string
  rail: string
}> = {
  user: {
    icon: MessageSquare,
    accent: 'text-zinc-100',
    chip: 'border-zinc-300/35 bg-zinc-300/10 text-zinc-100',
    rail: 'from-zinc-300/60 to-white/10',
  },
  agent: {
    icon: Bot,
    accent: 'text-emerald-200',
    chip: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
    rail: 'from-emerald-400/60 to-white/10',
  },
  model: {
    icon: Cpu,
    accent: 'text-primary-100',
    chip: 'border-primary-500/45 bg-primary-500/12 text-primary-100',
    rail: 'from-primary-500/70 to-white/10',
  },
  tool: {
    icon: Wrench,
    accent: 'text-amber-200',
    chip: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
    rail: 'from-amber-400/65 to-white/10',
  },
  store: {
    icon: Database,
    accent: 'text-sky-200',
    chip: 'border-sky-400/35 bg-sky-400/10 text-sky-200',
    rail: 'from-sky-400/60 to-white/10',
  },
  notify: {
    icon: Bell,
    accent: 'text-violet-200',
    chip: 'border-violet-400/35 bg-violet-400/10 text-violet-200',
    rail: 'from-violet-400/60 to-white/10',
  },
  output: {
    icon: CheckCircle,
    accent: 'text-emerald-200',
    chip: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
    rail: 'from-emerald-400/60 to-white/10',
  },
}

const STATUS_RING: Record<FlightStatus, string> = {
  done: 'border-white/14 bg-white/4.5',
  running: 'border-zinc-100/45 bg-zinc-100/7.5',
  failed: 'border-signal-red/60 bg-signal-red/12',
  queued: 'border-white/10 bg-black/20 opacity-60',
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: '手动',
  scheduled: '定时',
  webhook: 'Webhook',
}

function normalizeRunStatus(status: string) {
  if (status === 'success') return 'completed'
  return status
}

function isRunDone(status: string) {
  return ['completed', 'success'].includes(status)
}

function isRunActive(status: string) {
  return ['running', 'pending', 'ai_processing'].includes(status)
}

function formatDuration(ms?: number) {
  if (ms == null) return 'N/A'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(value?: number) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(5)}`
  return `$${value.toFixed(3)}`
}

function formatTokens(value?: number) {
  if (value == null || Number.isNaN(value)) return 'N/A'
  return new Intl.NumberFormat('en-US').format(value)
}

function metricFromDetail(detail: Record<string, unknown> | undefined, keys: string[]) {
  if (!detail) return undefined
  const queue: unknown[] = [detail]
  const wanted = keys.map((key) => key.toLowerCase())

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    for (const [rawKey, value] of Object.entries(current as Record<string, unknown>)) {
      const key = rawKey.toLowerCase()
      if (wanted.some((item) => key === item || key.endsWith(`_${item}`))) {
        const numeric = typeof value === 'number' ? value : Number(value)
        if (Number.isFinite(numeric)) return numeric
      }
      if (value && typeof value === 'object') queue.push(value)
    }
  }

  return undefined
}

function stepKind(step: string, message: string): { kind: FlightKind; role: string; title: string } {
  const text = `${step} ${message}`.toLowerCase()
  if (text.includes('model') || text.includes('ai') || text.includes('llm') || text.includes('processor')) {
    return { kind: 'model', role: 'Model Call', title: step || 'AI 处理' }
  }
  if (text.includes('tool') || text.includes('collect') || text.includes('fetch') || text.includes('scrape')) {
    return { kind: 'tool', role: 'Tool', title: step || '工具执行' }
  }
  if (text.includes('store') || text.includes('record') || text.includes('save') || text.includes('normalize')) {
    return { kind: 'store', role: 'Data', title: step || '数据入库' }
  }
  if (text.includes('notify') || text.includes('webhook') || text.includes('message')) {
    return { kind: 'notify', role: 'Notify', title: step || '通知分发' }
  }
  if (text.includes('finish') || text.includes('complete') || text.includes('done')) {
    return { kind: 'output', role: 'Output', title: step || '结果' }
  }
  return { kind: 'agent', role: 'Agent', title: step || '运行阶段' }
}

function statusFromEvent(event: TaskRunEvent, index: number, total: number, runStatus: string): FlightStatus {
  if (event.level === 'error') return 'failed'
  if (isRunActive(runStatus) && index === total - 1) return 'running'
  return 'done'
}

function stepsFromEvents(events: TaskRunEvent[], run: RecentRun): FlightStep[] {
  const sorted = [...events].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))

  return sorted.map((event, index) => {
    const meta = stepKind(event.step, event.message)
    const tokens = metricFromDetail(event.detail, [
      'total_tokens',
      'tokens',
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
    ])
    const costUsd = metricFromDetail(event.detail, ['cost_usd', 'total_cost_usd', 'usd', 'cost'])

    return {
      id: event.id,
      role: meta.role,
      title: meta.title,
      message: event.message,
      kind: meta.kind,
      status: statusFromEvent(event, index, sorted.length, run.status),
      elapsedMs: event.elapsed_ms,
      tokens,
      costUsd,
      detail: event.detail,
    }
  })
}

function fallbackSteps(run: RecentRun): FlightStep[] {
  const finalStatus: FlightStatus = run.status === 'failed'
    ? 'failed'
    : isRunActive(run.status)
      ? 'running'
      : 'done'

  return [
    {
      id: `${run.id}-source`,
      role: 'User',
      title: '触发任务',
      message: TRIGGER_LABELS[run.task_trigger_type] ?? run.task_trigger_type,
      kind: 'user',
      status: 'done',
    },
    {
      id: `${run.id}-collect`,
      role: 'Tool',
      title: '采集源',
      message: run.source_name,
      kind: 'tool',
      status: finalStatus === 'failed' ? 'done' : finalStatus,
    },
    {
      id: `${run.id}-agent`,
      role: 'Agent',
      title: '处理数据',
      message: `${run.records_collected} 条记录`,
      kind: 'agent',
      status: finalStatus === 'failed' ? 'done' : finalStatus,
      elapsedMs: run.duration_ms,
    },
    {
      id: `${run.id}-output`,
      role: 'Output',
      title: run.status === 'failed' ? '运行失败' : '生成结果',
      message: run.status === 'failed' ? '等待事件详情' : '记录已进入控制台',
      kind: 'output',
      status: finalStatus,
      elapsedMs: run.duration_ms,
    },
  ]
}

function safeJson(detail?: Record<string, unknown>) {
  if (!detail || Object.keys(detail).length === 0) return 'N/A'
  return JSON.stringify(detail, null, 2)
}

function RunSelector({
  runs,
  selectedId,
  onSelect,
}: {
  runs: RecentRun[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex min-w-0 gap-1 overflow-x-auto">
      {runs.slice(0, 8).map((run) => (
        <button
          key={run.id}
          data-active={selectedId === run.id}
          onClick={() => onSelect(run.id)}
          className="telemetry-button shrink-0 px-2.5 py-1.5 text-left text-2xs data-[active=true]:border-primary-500/80 data-[active=true]:bg-primary-500/15"
        >
          <span className="block max-w-[128px] truncate text-zinc-200">{run.source_name}</span>
          <span className="block font-code text-3xs text-zinc-600">{run.id.slice(0, 8)}</span>
        </button>
      ))}
    </div>
  )
}

function FlightNode({
  step,
  active,
  nodeRef,
  onSelect,
}: {
  step: FlightStep
  active: boolean
  nodeRef?: (node: HTMLButtonElement | null) => void
  onSelect: () => void
}) {
  const meta = KIND_META[step.kind]
  const Icon = meta.icon
  const StatusIcon = step.status === 'failed' ? AlertTriangle : step.status === 'done' ? CheckCircle : CircleDot

  return (
    <button
      ref={nodeRef}
      onClick={onSelect}
      data-active={active}
      data-flight-step={step.id}
      className={`group relative flex min-h-[154px] w-[216px] shrink-0 flex-col border p-3 text-left transition-colors ${STATUS_RING[step.status]} data-[active=true]:border-primary-500/70 data-[active=true]:bg-primary-500/8`}
    >
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-linear-to-r ${meta.rail}`} />
      <div className="flex items-start gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center border ${meta.chip}`}>
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`font-telemetry text-3xs font-semibold uppercase tracking-[0.14em] ${meta.accent}`}>
              {step.role}
            </p>
            <StatusIcon
              size={13}
              className={step.status === 'failed' ? 'text-red-300' : step.status === 'done' ? 'text-emerald-300' : 'text-zinc-200'}
            />
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold text-zinc-100">{step.title}</h3>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 min-h-[3.9em] text-xs leading-relaxed text-zinc-500">
        {step.message || 'N/A'}
      </p>
      <div className="mt-auto grid grid-cols-3 gap-1.5 pt-3">
        <div className="border border-white/10 bg-black/20 px-2 py-1">
          <p className="font-telemetry text-[9px] uppercase tracking-[0.14em] text-zinc-600">TIME</p>
          <p className="mt-0.5 truncate font-code text-2xs text-zinc-300">{formatDuration(step.elapsedMs)}</p>
        </div>
        <div className="border border-white/10 bg-black/20 px-2 py-1">
          <p className="font-telemetry text-[9px] uppercase tracking-[0.14em] text-zinc-600">TOK</p>
          <p className="mt-0.5 truncate font-code text-2xs text-zinc-300">{formatTokens(step.tokens)}</p>
        </div>
        <div className="border border-white/10 bg-black/20 px-2 py-1">
          <p className="font-telemetry text-[9px] uppercase tracking-[0.14em] text-zinc-600">USD</p>
          <p className="mt-0.5 truncate font-code text-2xs text-zinc-300">{formatCost(step.costUsd)}</p>
        </div>
      </div>
    </button>
  )
}

function FlightConnector({ active }: { active: boolean }) {
  return (
    <div className="flex h-[154px] w-10 shrink-0 items-center justify-center">
      <span className={`h-px w-full ${active ? 'bg-primary-500/70' : 'bg-white/14'}`} />
    </div>
  )
}

export default function AgentFlightBoard({ runs }: { runs: RecentRun[] }) {
  const stepRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const preferredRunId = useMemo(() => {
    return runs.find((run) => run.status === 'failed')?.id
      ?? runs.find((run) => isRunActive(run.status))?.id
      ?? runs[0]?.id
      ?? null
  }, [runs])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(preferredRunId)
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0]

  useEffect(() => {
    if (!runs.length) return
    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(preferredRunId)
    }
  }, [preferredRunId, runs, selectedRunId])

  const { data: events, isFetching } = useQuery({
    queryKey: ['dashboard-run-events', selectedRun?.task_id, selectedRun?.id],
    queryFn: () => listRunEvents(selectedRun.task_id, selectedRun.id),
    enabled: Boolean(selectedRun),
    refetchInterval: isRunActive(selectedRun?.status ?? '') ? 5_000 : false,
  })

  const steps = useMemo(() => {
    if (!selectedRun) return []
    if (events?.length) return stepsFromEvents(events, selectedRun)
    return fallbackSteps(selectedRun)
  }, [events, selectedRun])
  const failedStep = steps.find((step) => step.status === 'failed')
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const next = failedStep?.id ?? steps[0]?.id ?? null
    setActiveStepId((current) => current && steps.some((step) => step.id === current) ? current : next)
  }, [failedStep?.id, steps])

  const activeStep = steps.find((step) => step.id === activeStepId) ?? failedStep ?? steps[0]
  const activeStepIndex = activeStep ? steps.findIndex((step) => step.id === activeStep.id) : -1
  const tokenTotal = steps.reduce((sum, step) => sum + (step.tokens ?? 0), 0)
  const costTotal = steps.reduce((sum, step) => sum + (step.costUsd ?? 0), 0)
  const tokenKnown = steps.some((step) => step.tokens != null)
  const costKnown = steps.some((step) => step.costUsd != null)

  useEffect(() => {
    setIsPlaying(false)
  }, [selectedRun?.id])

  useEffect(() => {
    if (!activeStepId) return
    const node = stepRefs.current.get(activeStepId)
    if (!node) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [activeStepId])

  useEffect(() => {
    if (!isPlaying || steps.length <= 1) return
    const timer = window.setInterval(() => {
      setActiveStepId((current) => {
        const index = Math.max(0, steps.findIndex((step) => step.id === current))
        if (index >= steps.length - 1) {
          setIsPlaying(false)
          return current
        }
        return steps[index + 1].id
      })
    }, 1800)

    return () => window.clearInterval(timer)
  }, [isPlaying, steps])

  const selectStepAt = (index: number) => {
    if (!steps.length) return
    const bounded = Math.min(Math.max(index, 0), steps.length - 1)
    setActiveStepId(steps[bounded].id)
  }

  const handleReset = () => {
    setIsPlaying(false)
    selectStepAt(0)
  }

  const handlePrevious = () => {
    setIsPlaying(false)
    selectStepAt((activeStepIndex >= 0 ? activeStepIndex : 0) - 1)
  }

  const handleNext = () => {
    setIsPlaying(false)
    selectStepAt((activeStepIndex >= 0 ? activeStepIndex : 0) + 1)
  }

  if (!runs.length) {
    return (
      <Card padding={false}>
        <PanelHeader label="AGENT FLIGHT" title={<h2 className="font-semibold text-zinc-100">运行故事板</h2>} />
        <div className="p-8 text-sm text-zinc-500">暂无运行记录</div>
      </Card>
    )
  }

  return (
    <Card padding={false} className="overflow-hidden">
      <PanelHeader
        label="AGENT FLIGHT"
        title={(
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold text-zinc-100">运行故事板</h2>
            {selectedRun && <StatusBadge status={normalizeRunStatus(selectedRun.status)} />}
            <span className="font-code text-xs text-zinc-600">
              {selectedRun ? formatInTimeZone(new Date(selectedRun.created_at), 'Asia/Shanghai', 'MM-dd HH:mm:ss') : ''}
            </span>
          </div>
        )}
        actions={<RunSelector runs={runs} selectedId={selectedRun?.id ?? null} onSelect={setSelectedRunId} />}
      />

      <div className="grid gap-0 xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside className="border-b border-white/10 p-5 xl:border-b-0 xl:border-r">
          <p className="telemetry-label">SELECTED RUN</p>
          <h3 className="mt-2 truncate text-lg font-semibold text-zinc-100">{selectedRun.source_name}</h3>
          <p className="mt-1 truncate font-code text-xs text-zinc-600">{selectedRun.task_id}</p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <MetricTile label="RECORDS" value={selectedRun.records_collected} icon={Database} />
            <MetricTile label="LATENCY" value={formatDuration(selectedRun.duration_ms)} icon={Timer} tone={selectedRun.status === 'failed' ? 'danger' : 'neutral'} />
            <MetricTile label="TOKENS" value={tokenKnown ? formatTokens(tokenTotal) : 'N/A'} icon={Cpu} tone={tokenKnown ? 'accent' : 'neutral'} />
            <MetricTile label="COST" value={costKnown ? formatCost(costTotal) : 'N/A'} icon={CircleDollarSign} tone={costKnown ? 'accent' : 'neutral'} />
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
            <Timer size={13} />
            <span>{isFetching ? '同步事件中' : `${steps.length} 个阶段`}</span>
          </div>
        </aside>

        <section className="min-w-0 border-b border-white/10 p-5 xl:border-b-0 xl:border-r">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div>
              <p className="telemetry-label">FLOW STRIP</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">运行链路</h3>
            </div>
            <PlaybackControls
              playing={isPlaying}
              disabled={steps.length === 0}
              progressLabel={steps.length > 0 ? `${Math.max(activeStepIndex + 1, 1)} / ${steps.length}` : '0 / 0'}
              onToggle={() => setIsPlaying((value) => !value)}
              onPrevious={handlePrevious}
              onNext={handleNext}
              onReset={handleReset}
            />
          </div>

          <div className="mt-4 overflow-x-auto pb-1">
            <div className="flex min-w-max items-start">
              {steps.map((step, index) => (
                <div key={step.id} className="flex items-start">
                  <FlightNode
                    step={step}
                    active={activeStep?.id === step.id}
                    nodeRef={(node) => {
                      if (node) stepRefs.current.set(step.id, node)
                      else stepRefs.current.delete(step.id)
                    }}
                    onSelect={() => {
                      setIsPlaying(false)
                      setActiveStepId(step.id)
                    }}
                  />
                  {index < steps.length - 1 && (
                    <FlightConnector active={step.status === 'done' && steps[index + 1]?.status !== 'queued'} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="p-5">
          <p className="telemetry-label">INSPECTOR</p>
          {activeStep ? (
            <div className="mt-3">
              <div className="flex items-start gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center border ${KIND_META[activeStep.kind].chip}`}>
                  {(() => {
                    const Icon = KIND_META[activeStep.kind].icon
                    return <Icon size={17} />
                  })()}
                </span>
                <div className="min-w-0">
                  <p className="font-telemetry text-2xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{activeStep.role}</p>
                  <h3 className="mt-1 truncate text-base font-semibold text-zinc-100">{activeStep.title}</h3>
                </div>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-zinc-400">{activeStep.message}</p>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="telemetry-label">TIME</p>
                  <p className="mt-1 font-code text-xs text-zinc-300">{formatDuration(activeStep.elapsedMs)}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="telemetry-label">TOK</p>
                  <p className="mt-1 font-code text-xs text-zinc-300">{formatTokens(activeStep.tokens)}</p>
                </div>
                <div className="border border-white/10 bg-black/20 p-2">
                  <p className="telemetry-label">USD</p>
                  <p className="mt-1 font-code text-xs text-zinc-300">{formatCost(activeStep.costUsd)}</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="telemetry-label">DETAIL</p>
                <pre className="mt-2 max-h-[180px] overflow-auto border border-white/10 bg-black/30 p-3 font-code text-2xs leading-relaxed text-zinc-500">
                  {safeJson(activeStep.detail)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="mt-8 text-sm text-zinc-500">选择一次运行查看详情</div>
          )}
        </aside>
      </div>
    </Card>
  )
}
