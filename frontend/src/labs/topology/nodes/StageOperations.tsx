import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ChevronRight,
  ExternalLink,
  Loader2,
  Play,
  Plug,
  Power,
  Trash2,
} from 'lucide-react'

import type {
  AIAgent,
  CollectedRecord,
  CollectionTask,
  CronSchedule,
  DataSource,
  NotificationRule,
} from '../../../api/types'
import {
  deleteRecord,
  testSourceConnectivity,
  triggerTask,
  updateAgent,
  updateNotificationRule,
  updateSchedule,
  updateSource,
} from '../../../api/endpoints'
import { cn } from '../../../lib/utils'
import type { TopologyNodeData } from '../topologyModel'

/* ──────────────────────────────────────────────────────────────────────────
 * Stage operation component library — N8N-style node detail operations.
 * Each pipeline node opens the matching panel; panels surface the CORE
 * operations of that stage (toggle / trigger / test / delete) wired to the
 * real API, reusing data already fetched by TopologyPage.
 * ────────────────────────────────────────────────────────────────────────── */

export interface StageDataBundle {
  sources: DataSource[]
  schedules: CronSchedule[]
  tasks: CollectionTask[]
  agents: AIAgent[]
  records: CollectedRecord[]
  rules: NotificationRule[]
}

interface StageOperationPanelProps {
  node: TopologyNodeData
  stageCode: string
  data: StageDataBundle
  onChanged: () => void
}

export function StageOperationPanel({ node, stageCode, data, onChanged }: StageOperationPanelProps) {
  switch (node.kind) {
    case 'source':
      return <SourcesPanel items={data.sources} onChanged={onChanged} />
    case 'schedule':
      return <SchedulesPanel items={data.schedules} onChanged={onChanged} />
    case 'task':
      return <TasksPanel items={data.tasks} sources={data.sources} onChanged={onChanged} />
    case 'agent':
      return <AgentsPanel items={data.agents} onChanged={onChanged} />
    case 'record':
      return <RecordsPanel items={data.records} onChanged={onChanged} />
    case 'notification':
      return <NotificationsPanel items={data.rules} onChanged={onChanged} />
    default:
      return <EmptyHint label={`${stageCode} 阶段暂无可嵌入操作`} />
  }
}

/* ── IN · 数据源 ──────────────────────────────────────────────────────────── */
function SourcesPanel({ items, onChanged }: { items: DataSource[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = (source: DataSource) =>
    run(`source:enable:${source.id}`, setBusy, onChanged, () =>
      updateSource(source.id, { enabled: !source.enabled }),
      source.enabled ? `已停用 ${source.name}` : `已启用 ${source.name}`,
    )

  const test = (source: DataSource) =>
    run(`source:test:${source.id}`, setBusy, onChanged, () => testSourceConnectivity(source.id), `连通性检测已触发 · ${source.name}`)

  const collect = (source: DataSource) =>
    run(`source:run:${source.id}`, setBusy, onChanged, () => triggerTask(source.id), `采集任务已下发 · ${source.name}`)

  return (
    <OpsSection title="数据入口操作" count={items.length} fullPage="/sources">
      {items.length === 0 ? (
        <EmptyHint label="暂无数据源，去数据源页新增。" to="/sources" />
      ) : (
        items.slice(0, 8).map((source) => (
          <OpsRow
            key={source.id}
            title={source.name}
            subtitle={source.channel_type}
            health={source.enabled ? 'healthy' : 'disabled'}
            badge={source.enabled ? 'enabled' : 'disabled'}
          >
            <IconAction icon={Power} label="启停" busy={busy === `source:enable:${source.id}`} onClick={() => toggle(source)} active={source.enabled} />
            <IconAction icon={Plug} label="测连通" busy={busy === `source:test:${source.id}`} onClick={() => test(source)} />
            <IconAction icon={Play} label="采集" busy={busy === `source:run:${source.id}`} onClick={() => collect(source)} tone="action" />
          </OpsRow>
        ))
      )}
    </OpsSection>
  )
}

/* ── TR · 定时计划 ────────────────────────────────────────────────────────── */
function SchedulesPanel({ items, onChanged }: { items: CronSchedule[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = (schedule: CronSchedule) =>
    run(`sched:enable:${schedule.id}`, setBusy, onChanged, () =>
      updateSchedule(schedule.id, { enabled: !schedule.enabled }),
      schedule.enabled ? `已暂停 ${schedule.name}` : `已启用 ${schedule.name}`,
    )

  return (
    <OpsSection title="调度/触发操作" count={items.length} fullPage="/schedules">
      {items.length === 0 ? (
        <EmptyHint label="暂无定时计划，去定时计划页新增。" to="/schedules" />
      ) : (
        items.slice(0, 8).map((schedule) => (
          <OpsRow
            key={schedule.id}
            title={schedule.name}
            subtitle={schedule.cron_expression}
            health={schedule.enabled ? (schedule.next_run_at ? 'healthy' : 'warning') : 'disabled'}
            badge={schedule.next_run_at ? `next ${shortTime(schedule.next_run_at)}` : schedule.enabled ? 'no next' : 'paused'}
          >
            <IconAction icon={Power} label="启停" busy={busy === `sched:enable:${schedule.id}`} onClick={() => toggle(schedule)} active={schedule.enabled} />
          </OpsRow>
        ))
      )}
    </OpsSection>
  )
}

/* ── EX · 采集执行 ────────────────────────────────────────────────────────── */
function TasksPanel({
  items,
  sources,
  onChanged,
}: {
  items: CollectionTask[]
  sources: DataSource[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const recent = [...items].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 8)

  const rerun = (task: CollectionTask) =>
    run(`task:run:${task.id}`, setBusy, onChanged, () => triggerTask(task.source_id, undefined, task.agent_id ?? undefined), `已重新下发采集 · ${task.source_name ?? task.source_id}`)

  return (
    <OpsSection title="采集执行操作" count={items.length} fullPage="/tasks" hint={`${sources.length} 个来源可触发`}>
      {recent.length === 0 ? (
        <EmptyHint label="暂无采集任务，可从数据源触发。" to="/tasks" />
      ) : (
        recent.map((task) => (
          <OpsRow
            key={task.id}
            title={task.source_name || `Task ${task.id.slice(0, 8)}`}
            subtitle={`${task.trigger_type} · P${task.priority}`}
            health={taskHealth(task.status)}
            badge={task.status}
          >
            <IconAction icon={Play} label="重跑" busy={busy === `task:run:${task.id}`} onClick={() => rerun(task)} tone="action" />
          </OpsRow>
        ))
      )}
    </OpsSection>
  )
}

/* ── PR · 智能体 ──────────────────────────────────────────────────────────── */
function AgentsPanel({ items, onChanged }: { items: AIAgent[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = (agent: AIAgent) =>
    run(`agent:enable:${agent.id}`, setBusy, onChanged, () =>
      updateAgent(agent.id, { enabled: !agent.enabled }),
      agent.enabled ? `已停用 ${agent.name}` : `已启用 ${agent.name}`,
    )

  return (
    <OpsSection title="解析/归一化操作" count={items.length} fullPage="/agents">
      {items.length === 0 ? (
        <EmptyHint label="暂无智能体，去智能体页新增。" to="/agents" />
      ) : (
        items.slice(0, 8).map((agent) => (
          <OpsRow
            key={agent.id}
            title={agent.name}
            subtitle={agent.model || agent.processor_type}
            health={agent.enabled ? 'healthy' : 'disabled'}
            badge={agent.processor_type}
          >
            <IconAction icon={Power} label="启停" busy={busy === `agent:enable:${agent.id}`} onClick={() => toggle(agent)} active={agent.enabled} />
          </OpsRow>
        ))
      )}
    </OpsSection>
  )
}

/* ── DB · 采集记录 ────────────────────────────────────────────────────────── */
function RecordsPanel({ items, onChanged }: { items: CollectedRecord[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const recent = [...items].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 8)

  const remove = (record: CollectedRecord) =>
    run(`record:del:${record.id}`, setBusy, onChanged, () => deleteRecord(record.id), '记录已删除')

  return (
    <OpsSection title="存储记录操作" count={items.length} fullPage="/records">
      {recent.length === 0 ? (
        <EmptyHint label="暂无采集记录。" to="/records" />
      ) : (
        recent.map((record) => {
          const title = recordTitle(record)
          const open = openId === record.id
          return (
            <div key={record.id} className="border border-white/8 bg-white/2">
              <OpsRow
                title={title}
                subtitle={record.status}
                health={recordHealth(record.status)}
                badge={record.content_hash ? record.content_hash.slice(0, 8) : record.status}
                onTitleClick={() => setOpenId(open ? null : record.id)}
                flat
              >
                <IconAction
                  icon={ChevronRight}
                  label="预览"
                  onClick={() => setOpenId(open ? null : record.id)}
                  active={open}
                />
                <IconAction icon={Trash2} label="删除" busy={busy === `record:del:${record.id}`} onClick={() => remove(record)} tone="danger" />
              </OpsRow>
              {open && (
                <pre className="max-h-44 overflow-auto border-t border-white/8 bg-black/50 p-2 font-code text-3xs leading-4 text-zinc-400">
                  {JSON.stringify(record.normalized_data ?? record.raw_data ?? {}, null, 2)}
                </pre>
              )}
            </div>
          )
        })
      )}
    </OpsSection>
  )
}

/* ── OUT · 通知/交付 ──────────────────────────────────────────────────────── */
function NotificationsPanel({ items, onChanged }: { items: NotificationRule[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = (rule: NotificationRule) =>
    run(`rule:enable:${rule.id}`, setBusy, onChanged, () =>
      updateNotificationRule(rule.id, { enabled: !rule.enabled }),
      rule.enabled ? `已停用 ${rule.name}` : `已启用 ${rule.name}`,
    )

  return (
    <OpsSection title="通知/交付操作" count={items.length} fullPage="/notifications">
      {items.length === 0 ? (
        <EmptyHint label="暂无通知规则，去通知页新增。" to="/notifications" />
      ) : (
        items.slice(0, 8).map((rule) => (
          <OpsRow
            key={rule.id}
            title={rule.name}
            subtitle={`${rule.notifier_type} · ${rule.trigger_event}`}
            health={rule.enabled ? 'healthy' : 'disabled'}
            badge={rule.enabled ? 'enabled' : 'disabled'}
          >
            <IconAction icon={Power} label="启停" busy={busy === `rule:enable:${rule.id}`} onClick={() => toggle(rule)} active={rule.enabled} />
          </OpsRow>
        ))
      )}
    </OpsSection>
  )
}

/* ── Shared building blocks ───────────────────────────────────────────────── */
function OpsSection({
  title,
  count,
  fullPage,
  hint,
  children,
}: {
  title: string
  count: number
  fullPage: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="telemetry-label">{title}</p>
          <span className="border border-white/10 bg-white/4 px-1.5 py-0.5 font-code text-3xs text-zinc-500">{count}</span>
        </div>
        <Link
          to={fullPage}
          className="inline-flex items-center gap-1 text-2xs text-zinc-500 transition hover:text-zinc-200"
        >
          完整页 <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      {hint && <p className="text-2xs text-zinc-600">{hint}</p>}
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function OpsRow({
  title,
  subtitle,
  health,
  badge,
  children,
  onTitleClick,
  flat,
}: {
  title: string
  subtitle: string
  health: HealthTone
  badge?: string
  children?: ReactNode
  onTitleClick?: () => void
  flat?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-2',
        !flat && 'border border-white/8 bg-white/2',
      )}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass(health))} />
      <button
        type="button"
        onClick={onTitleClick}
        disabled={!onTitleClick}
        className={cn('min-w-0 flex-1 text-left', onTitleClick && 'cursor-pointer')}
      >
        <span className="block truncate text-xs font-semibold text-zinc-100" title={title}>
          {title}
        </span>
        <span className="block truncate text-3xs text-zinc-500" title={subtitle}>
          {subtitle}
        </span>
      </button>
      {badge && (
        <span className="hidden shrink-0 border border-white/10 bg-black/30 px-1.5 py-0.5 font-code text-[9px] text-zinc-500 sm:inline-flex">
          {badge}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  )
}

function IconAction({
  icon: Icon,
  label,
  onClick,
  busy,
  active,
  tone = 'neutral',
}: {
  icon: typeof Power
  label: string
  onClick: () => void
  busy?: boolean
  active?: boolean
  tone?: 'neutral' | 'action' | 'danger'
}) {
  const toneClass =
    tone === 'danger'
      ? 'hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-200'
      : tone === 'action'
        ? 'hover:border-sky-400/40 hover:bg-sky-400/10 hover:text-sky-200'
        : 'hover:border-white/25 hover:bg-white/6 hover:text-zinc-100'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={label}
      className={cn(
        'grid h-7 w-7 place-items-center border text-zinc-400 transition disabled:opacity-50',
        active ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/2',
        toneClass,
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
    </button>
  )
}

function EmptyHint({ label, to }: { label: string; to?: string }) {
  return (
    <div className="border border-dashed border-white/10 bg-black/20 px-3 py-4 text-center text-2xs text-zinc-600">
      {label}
      {to && (
        <Link to={to} className="ml-1 text-zinc-400 underline-offset-2 hover:underline">
          前往
        </Link>
      )}
    </div>
  )
}

/* ── helpers ──────────────────────────────────────────────────────────────── */
type HealthTone = 'healthy' | 'active' | 'warning' | 'failed' | 'disabled' | 'unknown'

async function run(
  key: string,
  setBusy: (key: string | null) => void,
  onChanged: () => void,
  fn: () => Promise<unknown>,
  okMessage: string,
) {
  setBusy(key)
  try {
    await fn()
    toast.success(okMessage)
    onChanged()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    setBusy(null)
  }
}

function dotClass(health: HealthTone) {
  const classes: Record<HealthTone, string> = {
    healthy: 'bg-emerald-400',
    active: 'bg-sky-400',
    warning: 'bg-amber-400',
    failed: 'bg-red-400',
    disabled: 'bg-zinc-500',
    unknown: 'bg-zinc-500',
  }
  return classes[health]
}

function taskHealth(status: string): HealthTone {
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (status === 'running') return 'active'
  if (status === 'pending') return 'warning'
  return 'healthy'
}

function recordHealth(status: string): HealthTone {
  if (status === 'error' || status === 'failed') return 'failed'
  if (status === 'raw' || status === 'normalized') return 'warning'
  if (status === 'ai_processed' || status === 'stored') return 'healthy'
  return 'unknown'
}

function recordTitle(record: CollectedRecord) {
  const candidates = [
    record.normalized_data?.title,
    record.raw_data?.title,
    record.normalized_data?.url,
    record.raw_data?.url,
  ]
  const found = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return found?.trim() || `Record ${record.id.slice(0, 8)}`
}

function shortTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
