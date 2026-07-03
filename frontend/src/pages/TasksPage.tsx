import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatInTimeZone } from 'date-fns-tz'
import ReactGridLayout, { useContainerWidth, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock3,
  Eye,
  FileJson,
  ListChecks,
  Radio,
  RotateCcw,
  Search,
  Server,
  SplitSquareHorizontal,
  Workflow,
} from 'lucide-react'
import { listTasks, listTaskRuns, listRunEvents } from '../api/endpoints'
import type { CollectionTask, TaskRun, TaskRunEvent } from '../api/types'
import ErrorAlert from '../components/ErrorAlert'
import { PageLoader } from '../components/LoadingSpinner'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import TruncatedText from '../components/TruncatedText'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  deriveRunInboxState,
  runInboxStateLabel,
  runInboxStateOrder,
  type LocalHandlingState,
  type RunInboxState,
} from '../lib/runInbox'
import { cn } from '../lib/utils'

type RunInboxFilter = 'active' | RunInboxState | 'all'

const HANDLED_STORAGE_KEY = 'opencli.runInbox.handled.v1'
const RUN_SURFACE_LAYOUT_STORAGE_KEY = 'opencli.liveCollection.surfaceLayout.v1'

const DEFAULT_RUN_SURFACE_LAYOUT: Layout = [
  { i: 'events', x: 0, y: 0, w: 7, h: 12, minW: 5, minH: 8 },
  { i: 'render', x: 7, y: 0, w: 5, h: 4, minW: 3, minH: 3 },
  { i: 'records', x: 7, y: 4, w: 5, h: 4, minW: 3, minH: 3 },
  { i: 'diagnosis', x: 7, y: 8, w: 5, h: 4, minW: 3, minH: 3 },
  { i: 'metrics', x: 0, y: 12, w: 12, h: 3, minW: 6, minH: 3 },
]

const FILTERS: Array<{ value: RunInboxFilter; label: string; hint: string }> = [
  { value: 'active', label: '处理中', hint: '运行、异常、待复核' },
  { value: 'needs_attention', label: '需要处理', hint: '失败或异常' },
  { value: 'running', label: '运行中', hint: '实时采集' },
  { value: 'ready_to_review', label: '待复核', hint: '完成后验收' },
  { value: 'resolved', label: '已解决', hint: '本地处理态' },
  { value: 'ignored', label: '已忽略', hint: '本地处理态' },
  { value: 'all', label: '全部', hint: '包含归档' },
]

const STEP_LABELS: Record<string, string> = {
  trigger: '触发',
  collect: '采集',
  normalize: '归一化',
  store: '入库',
  ai_process: 'AI 处理',
  notify: '通知',
  complete: '完成',
  failed: '失败',
}

function formatDate(iso?: string | null, pattern = 'MM-dd HH:mm') {
  if (!iso) return 'N/A'
  try {
    return formatInTimeZone(new Date(iso), 'Asia/Shanghai', pattern)
  } catch {
    return iso
  }
}

function formatDuration(ms?: number | null) {
  if (ms == null) return 'N/A'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function levelTone(level: TaskRunEvent['level']) {
  if (level === 'error') return 'border-red-500/35 bg-red-500/10 text-red-200'
  if (level === 'warning') return 'border-amber-400/35 bg-amber-400/10 text-amber-100'
  return 'border-sky-400/30 bg-sky-400/10 text-sky-100'
}

function stateTone(state: RunInboxState) {
  const tones: Record<RunInboxState, string> = {
    needs_attention: 'border-red-500/45 bg-red-500/10 text-red-100',
    running: 'border-sky-400/45 bg-sky-400/10 text-sky-100',
    ready_to_review: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100',
    resolved: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-200',
    ignored: 'border-zinc-600/40 bg-zinc-800/60 text-zinc-400',
  }
  return tones[state]
}

function stateIcon(state: RunInboxState) {
  const icons: Record<RunInboxState, typeof AlertTriangle> = {
    needs_attention: AlertTriangle,
    running: Radio,
    ready_to_review: ListChecks,
    resolved: CheckCircle2,
    ignored: Archive,
  }
  return icons[state]
}

function isFilterMatch(state: RunInboxState, filter: RunInboxFilter) {
  if (filter === 'all') return true
  if (filter === 'active') return state !== 'resolved' && state !== 'ignored'
  return state === filter
}

function loadHandledStates(): Record<string, LocalHandlingState> {
  try {
    const raw = window.localStorage.getItem(HANDLED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, LocalHandlingState>
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === 'resolved' || value === 'ignored'),
    )
  } catch {
    return {}
  }
}

function cloneDefaultRunSurfaceLayout() {
  return DEFAULT_RUN_SURFACE_LAYOUT.map((item) => ({ ...item }))
}

function isRunSurfaceLayout(value: unknown): value is Layout {
  return Array.isArray(value) && DEFAULT_RUN_SURFACE_LAYOUT.every((defaultItem) => (
    value.some((item) => (
      item &&
      typeof item === 'object' &&
      (item as { i?: unknown }).i === defaultItem.i &&
      typeof (item as { x?: unknown }).x === 'number' &&
      typeof (item as { y?: unknown }).y === 'number' &&
      typeof (item as { w?: unknown }).w === 'number' &&
      typeof (item as { h?: unknown }).h === 'number'
    ))
  ))
}

function loadRunSurfaceLayout(): Layout {
  try {
    const raw = window.localStorage.getItem(RUN_SURFACE_LAYOUT_STORAGE_KEY)
    if (!raw) return cloneDefaultRunSurfaceLayout()
    const parsed = JSON.parse(raw)
    if (!isRunSurfaceLayout(parsed)) return cloneDefaultRunSurfaceLayout()

    return DEFAULT_RUN_SURFACE_LAYOUT.map((defaultItem) => ({
      ...defaultItem,
      ...(parsed as Layout).find((item) => item.i === defaultItem.i),
    }))
  } catch {
    return cloneDefaultRunSurfaceLayout()
  }
}

function getDetailValue(detail: Record<string, unknown> | undefined, keys: string[]) {
  if (!detail) return undefined
  const wanted = keys.map((key) => key.toLowerCase())
  const queue: unknown[] = [detail]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    for (const [rawKey, value] of Object.entries(current as Record<string, unknown>)) {
      const key = rawKey.toLowerCase()
      if (wanted.some((candidate) => key === candidate || key.endsWith(`_${candidate}`))) return value
      if (value && typeof value === 'object') queue.push(value)
    }
  }
  return undefined
}

function collectLinks(events: TaskRunEvent[]) {
  const links: Array<{ label: string; href: string }> = []
  const seen = new Set<string>()
  for (const event of events) {
    const detail = event.detail
    if (!detail) continue
    for (const key of ['url', 'browser_url', 'novnc_url', 'screenshot_url', 'artifact_url']) {
      const value = getDetailValue(detail, [key])
      if (typeof value === 'string' && /^https?:\/\//i.test(value) && !seen.has(value)) {
        seen.add(value)
        links.push({ label: key.replace(/_/g, ' '), href: value })
      }
    }
  }
  return links.slice(0, 6)
}

function mergeEvents(current: TaskRunEvent[], incoming: TaskRunEvent | TaskRunEvent[]) {
  const next = new Map(current.map((event) => [event.id, event]))
  const list = Array.isArray(incoming) ? incoming : [incoming]
  for (const event of list) next.set(event.id, event)
  return Array.from(next.values()).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

function useRunEventStream(taskId: string | undefined, runId: string | undefined, enabled: boolean) {
  const [events, setEvents] = useState<TaskRunEvent[]>([])
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'live' | 'fallback' | 'closed'>('idle')

  useEffect(() => {
    if (!enabled || !taskId || !runId) {
      setEvents([])
      setConnectionState('idle')
      return
    }

    let cancelled = false
    setEvents([])
    setConnectionState('connecting')

    listRunEvents(taskId, runId)
      .then((initialEvents) => {
        if (!cancelled) setEvents((current) => mergeEvents(current, initialEvents))
      })
      .catch(() => {
        if (!cancelled) setConnectionState('fallback')
      })

    const source = new EventSource(`/api/v1/tasks/${taskId}/runs/${runId}/events/stream`)
    source.onopen = () => {
      if (!cancelled) setConnectionState('live')
    }
    source.addEventListener('run_event', (message) => {
      const event = JSON.parse((message as MessageEvent).data) as TaskRunEvent
      if (!cancelled) setEvents((current) => mergeEvents(current, event))
    })
    source.addEventListener('run_status', () => {
      if (!cancelled) setConnectionState('closed')
      source.close()
    })
    source.onerror = () => {
      if (!cancelled) setConnectionState((state) => (state === 'closed' ? state : 'fallback'))
    }

    return () => {
      cancelled = true
      source.close()
    }
  }, [enabled, runId, taskId])

  return { events, connectionState }
}

function HandlingButton({
  task,
  onSetHandled,
}: {
  task: CollectionTask
  onSetHandled: (taskId: string, state: LocalHandlingState | null) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="xs" variant="outline" onClick={() => onSetHandled(task.id, 'resolved')}>
        <CheckCircle2 size={14} />
        解决
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => onSetHandled(task.id, 'ignored')}>
        <Archive size={14} />
        忽略
      </Button>
    </div>
  )
}

function RunInboxCard({
  task,
  filter,
  handledState,
  onOpenLiveView,
  onSetHandled,
}: {
  task: CollectionTask
  filter: RunInboxFilter
  handledState?: LocalHandlingState
  onOpenLiveView: (task: CollectionTask, run?: TaskRun) => void
  onSetHandled: (taskId: string, state: LocalHandlingState | null) => void
}) {
  const { data } = useQuery({
    queryKey: ['taskRuns', task.id, 'inbox-card'],
    queryFn: () => listTaskRuns(task.id),
    refetchInterval: 3000,
  })
  const runs = data?.data ?? []
  const latestRun = runs[0]
  const state = deriveRunInboxState(task, latestRun, handledState)
  const StateIcon = stateIcon(state)

  if (!isFilterMatch(state, filter)) return null

  return (
    <div className="group border-b border-white/10 bg-black/10 px-4 py-4 transition-colors last:border-b-0 hover:bg-white/[0.035]">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_180px] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn('gap-1', stateTone(state))} variant="outline">
              <StateIcon size={12} />
              {runInboxStateLabel(state)}
            </Badge>
            <StatusBadge status={task.status} />
            <span className="font-code text-2xs text-zinc-600">{task.trigger_type}</span>
          </div>
          <h3 className="mt-2 truncate text-base font-semibold text-zinc-100">
            {task.source_name ?? '未命名数据源'}
          </h3>
          <p className="mt-1 font-code text-xs text-zinc-600">{task.id}</p>
          {(task.error_message || latestRun?.error_message) && (
            <TruncatedText
              text={task.error_message ?? latestRun?.error_message ?? ''}
              lines={2}
              className="mt-3 text-xs leading-relaxed text-red-300"
            />
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs xl:grid-cols-1">
          <div className="border border-white/10 bg-black/20 p-2">
            <p className="telemetry-label">RECORDS</p>
            <p className="mt-1 font-code text-zinc-200">{latestRun?.records_collected ?? 'N/A'}</p>
          </div>
          <div className="border border-white/10 bg-black/20 p-2">
            <p className="telemetry-label">LAST RUN</p>
            <p className="mt-1 font-code text-zinc-300">{formatDate(latestRun?.created_at)}</p>
          </div>
          <div className="border border-white/10 bg-black/20 p-2">
            <p className="telemetry-label">LATENCY</p>
            <p className="mt-1 font-code text-zinc-300">{formatDuration(latestRun?.duration_ms)}</p>
          </div>
        </div>

        <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={!latestRun}
            onClick={() => onOpenLiveView(task, latestRun)}
          >
            <Eye size={15} />
            Live View
          </Button>
          {state === 'resolved' || state === 'ignored' ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onSetHandled(task.id, null)}>
              <RotateCcw size={14} />
              重开
            </Button>
          ) : (
            <HandlingButton task={task} onSetHandled={onSetHandled} />
          )}
        </div>
      </div>
    </div>
  )
}

function EventTimeline({ events }: { events: TaskRunEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="grid min-h-[260px] place-items-center border border-white/10 bg-black/20 text-sm text-zinc-500">
        等待采集事件进入流
      </div>
    )
  }

  return (
    <div className="max-h-[500px] overflow-y-auto border border-white/10 bg-black/20">
      {events.map((event) => (
        <div key={event.id} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-b border-white/10 p-3 last:border-b-0">
          <div className="font-code text-2xs text-zinc-600">{formatDate(event.created_at, 'HH:mm:ss')}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn('gap-1', levelTone(event.level))}>
                {event.level}
              </Badge>
              <span className="font-telemetry text-2xs font-semibold uppercase tracking-[0.08em] text-zinc-400">
                {STEP_LABELS[event.step] ?? event.step}
              </span>
              {event.elapsed_ms != null && (
                <span className="font-code text-2xs text-zinc-600">{formatDuration(event.elapsed_ms)}</span>
              )}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">{event.message}</p>
            {event.detail && (
              <pre className="mt-2 max-h-32 overflow-auto border border-white/10 bg-black/30 p-2 font-code text-2xs leading-relaxed text-zinc-500">
                {JSON.stringify(event.detail, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function SurfacePanel({
  title,
  label,
  icon: Icon,
  children,
  action,
}: {
  title: string
  label: string
  icon: typeof Activity
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-white/10 bg-black/20">
      <header className="run-surface-handle flex cursor-move items-center justify-between gap-3 border-b border-white/10 bg-white/2.5 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center border border-white/10 bg-black/25 text-zinc-400">
            <Icon size={14} />
          </span>
          <div className="min-w-0">
            <p className="telemetry-label">{label}</p>
            <h3 className="truncate text-sm font-semibold text-zinc-100">{title}</h3>
          </div>
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
    </section>
  )
}

function MetricsSurface({ selectedRun, events, errors, warnings }: {
  selectedRun?: TaskRun
  events: TaskRunEvent[]
  errors: TaskRunEvent[]
  warnings: TaskRunEvent[]
}) {
  const items = [
    { label: 'EVENTS', value: events.length, tone: 'text-zinc-100' },
    { label: 'ERRORS', value: errors.length, tone: 'text-red-200' },
    { label: 'WARNINGS', value: warnings.length, tone: 'text-amber-100' },
    { label: 'RECORDS', value: selectedRun?.records_collected ?? 'N/A', tone: 'text-emerald-100' },
    { label: 'DURATION', value: formatDuration(selectedRun?.duration_ms), tone: 'text-zinc-100' },
  ]

  return (
    <div className="grid h-full grid-cols-2 gap-2 md:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 border border-white/10 bg-black/20 p-3">
          <p className="telemetry-label">{item.label}</p>
          <p className={cn('mt-1 truncate font-code text-lg', item.tone)}>{item.value}</p>
        </div>
      ))}
    </div>
  )
}

function RenderSurface({ links }: { links: Array<{ label: string; href: string }> }) {
  if (links.length === 0) {
    return (
      <div className="grid h-full min-h-32 place-items-center border border-white/10 bg-black/20 p-4 text-center">
        <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
          当前事件还没有浏览器、noVNC、截图或 artifact 链接；采集管线写入这些字段后会自动出现。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 border border-white/10 bg-black/25 px-3 py-2 text-xs text-sky-200 hover:border-sky-400/30 hover:text-sky-100"
        >
          <Server size={13} />
          <span className="truncate">{link.label}</span>
        </a>
      ))}
    </div>
  )
}

function RecordPreviewSurface({ recordPreview }: { recordPreview: unknown }) {
  return (
    <pre className="h-full min-h-32 overflow-auto border border-white/10 bg-black/30 p-3 font-code text-2xs leading-relaxed text-zinc-500">
      {recordPreview ? JSON.stringify(recordPreview, null, 2) : 'N/A'}
    </pre>
  )
}

function DiagnosisSurface({ errors, warnings }: { errors: TaskRunEvent[]; warnings: TaskRunEvent[] }) {
  const items = [...errors, ...warnings].slice(-5)
  if (items.length === 0) {
    return (
      <div className="grid h-full min-h-32 place-items-center border border-emerald-400/25 bg-emerald-400/10 p-4 text-xs text-emerald-100">
        暂无错误事件
      </div>
    )
  }

  return (
    <div className="h-full space-y-2 overflow-y-auto">
      {items.map((event) => (
        <div key={event.id} className={cn('border p-3 text-xs leading-relaxed', levelTone(event.level))}>
          <p className="font-semibold">{STEP_LABELS[event.step] ?? event.step}</p>
          <p className="mt-1">{event.message}</p>
        </div>
      ))}
    </div>
  )
}

function AdaptiveRunSurface({
  selectedRun,
  events,
  links,
  recordPreview,
  errors,
  warnings,
}: {
  selectedRun?: TaskRun
  events: TaskRunEvent[]
  links: Array<{ label: string; href: string }>
  recordPreview: unknown
  errors: TaskRunEvent[]
  warnings: TaskRunEvent[]
}) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 960 })
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      const mutableContainerRef = containerRef as { current: HTMLDivElement | null }
      mutableContainerRef.current = node
    },
    [containerRef],
  )
  const [layout, setLayout] = useState<Layout>(() => loadRunSurfaceLayout())

  const handleLayoutChange = (nextLayout: Layout) => {
    setLayout(nextLayout)
    window.localStorage.setItem(RUN_SURFACE_LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout))
  }

  const resetLayout = () => {
    const nextLayout = cloneDefaultRunSurfaceLayout()
    setLayout(nextLayout)
    window.localStorage.setItem(RUN_SURFACE_LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout))
  }

  const panels = (
    <>
      <div key="events" className="overflow-hidden">
        <SurfacePanel title="采集事件流" label="EVENT STREAM" icon={Radio}>
          <EventTimeline events={events} />
        </SurfacePanel>
      </div>
      <div key="render" className="overflow-hidden">
        <SurfacePanel title="渲染面" label="RENDER" icon={Server}>
          <RenderSurface links={links} />
        </SurfacePanel>
      </div>
      <div key="records" className="overflow-hidden">
        <SurfacePanel title="记录预览" label="RECORDS" icon={FileJson}>
          <RecordPreviewSurface recordPreview={recordPreview} />
        </SurfacePanel>
      </div>
      <div key="diagnosis" className="overflow-hidden">
        <SurfacePanel title="诊断" label="DIAGNOSIS" icon={AlertTriangle}>
          <DiagnosisSurface errors={errors} warnings={warnings} />
        </SurfacePanel>
      </div>
      <div key="metrics" className="overflow-hidden">
        <SurfacePanel
          title="运行指标"
          label="METRICS"
          icon={Activity}
          action={(
            <Button type="button" size="xs" variant="ghost" onClick={resetLayout}>
              <RotateCcw size={13} />
              重置
            </Button>
          )}
        >
          <MetricsSurface selectedRun={selectedRun} events={events} errors={errors} warnings={warnings} />
        </SurfacePanel>
      </div>
    </>
  )

  return (
    <>
      <div ref={setContainerRef} className="hidden min-h-[680px] lg:block">
        {mounted && width > 0 && (
          <ReactGridLayout
            className="live-run-surface-grid"
            layout={layout}
            width={width}
            gridConfig={{ cols: 12, rowHeight: 42, margin: [12, 12], containerPadding: [0, 0] }}
            dragConfig={{ enabled: true, handle: '.run-surface-handle', bounded: true }}
            resizeConfig={{ enabled: true, handles: ['se'] }}
            onLayoutChange={handleLayoutChange}
          >
            {panels}
          </ReactGridLayout>
        )}
      </div>
      <div className="space-y-4 lg:hidden">
        <MetricsSurface selectedRun={selectedRun} events={events} errors={errors} warnings={warnings} />
        <SurfacePanel title="采集事件流" label="EVENT STREAM" icon={Radio}>
          <EventTimeline events={events} />
        </SurfacePanel>
        <SurfacePanel title="渲染面" label="RENDER" icon={Server}>
          <RenderSurface links={links} />
        </SurfacePanel>
        <SurfacePanel title="记录预览" label="RECORDS" icon={FileJson}>
          <RecordPreviewSurface recordPreview={recordPreview} />
        </SurfacePanel>
        <SurfacePanel title="诊断" label="DIAGNOSIS" icon={AlertTriangle}>
          <DiagnosisSurface errors={errors} warnings={warnings} />
        </SurfacePanel>
      </div>
    </>
  )
}

function LiveCollectionView({
  open,
  task,
  initialRun,
  onOpenChange,
}: {
  open: boolean
  task: CollectionTask | null
  initialRun?: TaskRun
  onOpenChange: (open: boolean) => void
}) {
  const { data: runsData } = useQuery({
    queryKey: ['taskRuns', task?.id, 'live-view'],
    queryFn: () => listTaskRuns(task?.id ?? ''),
    enabled: open && Boolean(task),
    refetchInterval: 2500,
  })
  const runs = runsData?.data ?? []
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const fallbackRun = initialRun ?? runs[0]
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? fallbackRun
  const { events, connectionState } = useRunEventStream(task?.id, selectedRun?.id, open && Boolean(task && selectedRun))

  useEffect(() => {
    if (!open) {
      setSelectedRunId(null)
      return
    }
    setSelectedRunId((current) => {
      if (current && runs.some((run) => run.id === current)) return current
      return initialRun?.id ?? runs[0]?.id ?? null
    })
  }, [initialRun?.id, open, runs])

  const latestDetail = [...events].reverse().find((event) => event.detail)?.detail
  const links = collectLinks(events)
  const recordPreview = getDetailValue(latestDetail, ['records', 'record', 'raw_data', 'normalized_data'])
  const errors = events.filter((event) => event.level === 'error')
  const warnings = events.filter((event) => event.level === 'warning')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(780px,calc(100vh-2rem))] max-w-[min(1180px,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4 pr-9">
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl">{task?.source_name ?? 'Live Collection View'}</DialogTitle>
              <DialogDescription>
                绑定到一次采集运行，流式查看事件、渲染线索、记录预览和错误诊断。
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={connectionState === 'live' ? 'border-sky-400/40 bg-sky-400/10 text-sky-100' : 'border-white/14 bg-white/4 text-zinc-300'}>
                {connectionState === 'live' ? 'SSE LIVE' : connectionState.toUpperCase()}
              </Badge>
              {selectedRun && <StatusBadge status={selectedRun.status} />}
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
            <p className="telemetry-label">RUN INBOX</p>
            <div className="mt-3 space-y-2">
              {runs.length === 0 && (
                <div className="border border-white/10 bg-black/20 p-3 text-xs text-zinc-500">暂无运行实例</div>
              )}
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  data-active={run.id === selectedRun?.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className="telemetry-button w-full p-3 text-left data-[active=true]:border-primary-500/55 data-[active=true]:bg-primary-500/12"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-zinc-200">{formatDate(run.created_at)}</span>
                    <span className="font-code text-3xs text-zinc-600">{run.records_collected}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusBadge status={run.status} />
                    <span className="font-code text-3xs text-zinc-600">{run.id.slice(0, 8)}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4">
            <AdaptiveRunSurface
              selectedRun={selectedRun}
              events={events}
              links={links}
              recordPreview={recordPreview}
              errors={errors}
              warnings={warnings}
            />
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function TasksPage() {
  const [filter, setFilter] = useState<RunInboxFilter>('active')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [handled, setHandled] = useState<Record<string, LocalHandlingState>>(() => loadHandledStates())
  const [selectedTask, setSelectedTask] = useState<CollectionTask | null>(null)
  const [selectedRun, setSelectedRun] = useState<TaskRun | undefined>(undefined)

  useEffect(() => {
    window.localStorage.setItem(HANDLED_STORAGE_KEY, JSON.stringify(handled))
  }, [handled])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tasks', 'run-inbox', page],
    queryFn: () => listTasks({ page, limit: 50 }),
    refetchInterval: 5000,
  })

  const tasks = data?.data ?? []
  const meta = data?.meta

  const counts = useMemo(() => {
    const next: Record<RunInboxState | 'active' | 'all', number> = {
      active: 0,
      all: tasks.length,
      running: 0,
      needs_attention: 0,
      ready_to_review: 0,
      resolved: 0,
      ignored: 0,
    }
    for (const task of tasks) {
      const state = deriveRunInboxState(task, undefined, handled[task.id])
      next[state] += 1
      if (state !== 'resolved' && state !== 'ignored') next.active += 1
    }
    return next
  }, [handled, tasks])

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tasks
      .filter((task) => {
        const state = deriveRunInboxState(task, undefined, handled[task.id])
        if (!isFilterMatch(state, filter)) return false
        if (!query) return true
        return [task.source_name, task.id, task.source_id, task.error_message, task.trigger_type]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      })
      .sort((a, b) => {
        const aState = deriveRunInboxState(a, undefined, handled[a.id])
        const bState = deriveRunInboxState(b, undefined, handled[b.id])
        const byState = runInboxStateOrder(aState) - runInboxStateOrder(bState)
        if (byState !== 0) return byState
        return b.updated_at.localeCompare(a.updated_at)
      })
  }, [filter, handled, search, tasks])

  const setHandledState = (taskId: string, state: LocalHandlingState | null) => {
    setHandled((current) => {
      const next = { ...current }
      if (state) next[taskId] = state
      else delete next[taskId]
      return next
    })
  }

  const openLiveView = (task: CollectionTask, run?: TaskRun) => {
    setSelectedTask(task)
    setSelectedRun(run)
  }

  if (isLoading) return <PageLoader />
  if (error) return <ErrorAlert error={error as Error} onRetry={refetch} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Run Inbox"
        description="把采集任务当作需要处理的工作流：先看异常和运行中，再按需打开实时采集视图。"
        action={(
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            <RotateCcw size={15} />
            刷新
          </Button>
        )}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center border border-red-500/30 bg-red-500/10 text-red-100">
              <AlertTriangle size={17} />
            </span>
            <div>
              <p className="telemetry-label">ATTENTION</p>
              <p className="telemetry-value text-xl">{counts.needs_attention}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center border border-sky-400/30 bg-sky-400/10 text-sky-100">
              <Activity size={17} />
            </span>
            <div>
              <p className="telemetry-label">RUNNING</p>
              <p className="telemetry-value text-xl">{counts.running}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center border border-emerald-400/30 bg-emerald-400/10 text-emerald-100">
              <ListChecks size={17} />
            </span>
            <div>
              <p className="telemetry-label">REVIEW</p>
              <p className="telemetry-value text-xl">{counts.ready_to_review}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center border border-white/10 bg-white/4 text-zinc-300">
              <CheckCircle2 size={17} />
            </span>
            <div>
              <p className="telemetry-label">HANDLED</p>
              <p className="telemetry-value text-xl">{counts.resolved + counts.ignored}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card padding={false} className="overflow-hidden">
        <div className="border-b border-white/10 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <SplitSquareHorizontal size={16} className="text-zinc-500" />
                <h2 className="font-semibold text-zinc-100">Collection Operations Console</h2>
              </div>
              <p className="mt-1 text-sm text-zinc-500">参考 OpenBB 的 workspace 思路，但这里按采集运行的人类处理流程组织。</p>
            </div>
            <label className="relative block w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索数据源、任务 ID、错误"
                className="h-9 w-full border border-white/10 bg-black/30 pl-9 pr-3 text-sm text-zinc-100 outline-hidden transition-colors placeholder:text-zinc-600 focus:border-primary-500/60"
              />
            </label>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((item) => {
              const active = filter === item.value
              const count = item.value === 'all' ? counts.all : counts[item.value as keyof typeof counts] ?? 0
              return (
                <button
                  key={item.value}
                  type="button"
                  data-active={active}
                  onClick={() => setFilter(item.value)}
                  className="telemetry-button min-w-[128px] px-3 py-2 text-left data-[active=true]:border-primary-500/60 data-[active=true]:bg-primary-500/12"
                >
                  <span className="block text-xs font-semibold text-zinc-200">
                    {item.label}
                    <span className="ml-2 font-code text-2xs text-zinc-500">{count}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-zinc-600">{item.hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        {filteredTasks.length === 0 ? (
          <div className="grid min-h-[260px] place-items-center px-6 py-12 text-center">
            <div>
              <Workflow className="mx-auto h-10 w-10 text-zinc-700" />
              <h3 className="mt-4 text-sm font-semibold text-zinc-200">没有匹配的运行任务</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                换一个处理状态，或者回到数据源页面触发一次采集。
              </p>
            </div>
          </div>
        ) : (
          <div>
            {filteredTasks.map((task) => (
              <RunInboxCard
                key={task.id}
                task={task}
                filter={filter}
                handledState={handled[task.id]}
                onOpenLiveView={openLiveView}
                onSetHandled={setHandledState}
              />
            ))}
          </div>
        )}

        {meta && meta.pages > 1 && (
          <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 text-sm">
            <span className="text-zinc-500">共 {meta.total} 个任务</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                上一页
              </Button>
              <span className="px-3 py-1 font-code text-xs text-zinc-500">{page} / {meta.pages}</span>
              <Button type="button" variant="outline" size="sm" disabled={page >= meta.pages} onClick={() => setPage((value) => value + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </Card>

      <LiveCollectionView
        open={Boolean(selectedTask)}
        task={selectedTask}
        initialRun={selectedRun}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedTask(null)
            setSelectedRun(undefined)
          }
        }}
      />
    </div>
  )
}
