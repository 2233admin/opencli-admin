import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { getDashboardStats, getDashboardActivity } from '../api/endpoints'
import { PageLoader } from '../components/LoadingSpinner'
import ErrorAlert from '../components/ErrorAlert'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import PageHeader from '../components/PageHeader'
import AgentFlightBoard from '../components/AgentFlightBoard'
import { formatInTimeZone } from 'date-fns-tz'
import {
  Database, Activity, FileText, Zap,
  CheckCircle, XCircle, TrendingUp, TrendingDown, Minus,
} from 'lucide-react'

// ── Time range ────────────────────────────────────────────────────────────────

type RangeKey = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'custom'

const RANGE_LABELS: Record<RangeKey, string> = {
  all: 'dashboard.range.all',
  today: 'dashboard.range.today',
  yesterday: 'dashboard.range.yesterday',
  '7d': 'dashboard.range.7d',
  '30d': 'dashboard.range.30d',
  custom: 'dashboard.range.custom',
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'tasks.steps.manual',
  scheduled: 'tasks.steps.scheduled',
  webhook: 'Webhook',
}

const CHART_GRID = 'rgba(255, 255, 255, 0.1)'
const CHART_AXIS = '#71717a'
const CHART_TOTAL = '#fafafa'
const CHART_SUCCESS = '#34d399'
const CHART_FAILED = '#ff3b30'
const CHART_RECORDS = '#d4d4d8'

type ToneKey = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

const TONE_STYLES: Record<ToneKey, { rail: string; icon: string; dot: string }> = {
  neutral: {
    rail: 'bg-zinc-300',
    icon: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-200',
    dot: 'bg-zinc-300',
  },
  accent: {
    rail: 'bg-primary-500',
    icon: 'border-primary-500/40 bg-primary-500/10 text-primary-100',
    dot: 'bg-primary-500',
  },
  success: {
    rail: 'bg-emerald-400',
    icon: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
    dot: 'bg-emerald-400',
  },
  danger: {
    rail: 'bg-primary-500',
    icon: 'border-primary-500/50 bg-primary-500/15 text-primary-100',
    dot: 'bg-primary-500',
  },
  warning: {
    rail: 'bg-amber-400',
    icon: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
    dot: 'bg-amber-400',
  },
}

function TimeRangeBar({
  range, customStart, customEnd, onChange, onCustomChange, translateRangeLabel,
}: {
  range: RangeKey
  customStart: string
  customEnd: string
  onChange: (r: RangeKey) => void
  onCustomChange: (start: string, end: string) => void
  translateRangeLabel: (key: string) => string
}) {
  const keys: RangeKey[] = ['all', 'today', 'yesterday', '7d', '30d', 'custom']
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 border border-white/10 bg-black/20 p-1">
        {keys.map((k) => (
          <button
            key={k}
            data-active={range === k}
            onClick={() => onChange(k)}
            className="telemetry-button px-3 py-1.5 font-telemetry text-[11px] font-semibold uppercase tracking-[0.12em]"
          >
            {translateRangeLabel(RANGE_LABELS[k])}
          </button>
        ))}
      </div>
      {range === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={customStart}
            onChange={(e) => onCustomChange(e.target.value, customEnd)}
            className="telemetry-input px-2 py-1"
          />
          <span className="text-xs text-zinc-600">-</span>
          <input
            type="datetime-local"
            value={customEnd}
            onChange={(e) => onCustomChange(customStart, e.target.value)}
            className="telemetry-input px-2 py-1"
          />
        </div>
      )}
    </div>
  )
}

// ── Trend badge ───────────────────────────────────────────────────────────────

function TrendBadge({
  current,
  previous,
  noTrendLabel,
}: {
  current: number
  previous: number
  noTrendLabel: string
}) {
  if (previous === 0 && current === 0) return null
  const diff = current - previous
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null

  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-1 font-telemetry text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-300">
        <TrendingUp size={12} />
        {pct !== null ? `+${pct}%` : `+${diff}`}
      </span>
    )
  }
  if (diff < 0) {
    return (
      <span className="inline-flex items-center gap-1 font-telemetry text-[11px] font-semibold uppercase tracking-[0.1em] text-primary-300">
        <TrendingDown size={12} />
        {pct !== null ? `${pct}%` : `${diff}`}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 font-telemetry text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
      <Minus size={12} />
      {noTrendLabel}
    </span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, tone = 'neutral', trend,
}: {
  label: string
  value: number | string
  sub?: string
  icon: React.ElementType
  tone?: ToneKey
  trend?: { current: number; previous: number }
}) {
  const { t } = useTranslation()
  const toneStyle = TONE_STYLES[tone]
  return (
    <Card className="min-h-[138px] p-4">
      <div className={`absolute left-0 top-0 h-full w-[3px] ${toneStyle.rail}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 ${toneStyle.dot}`} />
            <p className="telemetry-label truncate">{label}</p>
          </div>
          <p className="telemetry-value mt-4 truncate text-3xl font-semibold sm:text-4xl">
            {value}
          </p>
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center border ${toneStyle.icon}`}>
          <Icon size={19} />
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sub && <p className="text-xs text-zinc-500">{sub}</p>}
        {trend && <TrendBadge current={trend.current} previous={trend.previous} noTrendLabel={t('dashboard.noChange')} />}
      </div>
    </Card>
  )
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-white/15 bg-black/90 p-2.5 text-xs shadow-2xl">
      <p className="mb-1 font-semibold uppercase tracking-[0.12em] text-zinc-300">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation()
  const [range, setRange] = useState<RangeKey>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const tzOffset = -new Date().getTimezoneOffset() / 60

  const queryParams = (() => {
    if (range === 'custom') {
      return {
        range,
        start: customStart ? new Date(customStart).toISOString() : undefined,
        end: customEnd ? new Date(customEnd).toISOString() : undefined,
      }
    }
    return { range }
  })()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-stats', range, customStart, customEnd],
    queryFn: () => getDashboardStats(queryParams),
    refetchInterval: 15_000,
  })

  const { data: activity } = useQuery({
    queryKey: ['dashboard-activity', tzOffset],
    queryFn: () => getDashboardActivity({ days: 7, tz_offset: tzOffset }),
    refetchInterval: 60_000,
  })

  if (isLoading) return <PageLoader />
  if (error) return <ErrorAlert error={error as Error} onRetry={refetch} />
  if (!data) return null

  const runs = data.runs ?? { total: 0, success: 0, failed: 0, success_rate: 0 }
  const daily = activity?.daily ?? []
  const todayData = daily[daily.length - 1]
  const yesterdayData = daily[daily.length - 2]
  const chartData = daily.map((d) => ({ ...d, label: d.date.slice(5).replace('-', '/') }))

  return (
    <div className="space-y-5">
      <PageHeader title={t('dashboard.title')} description={t('dashboard.description')} />

      <TimeRangeBar
        range={range}
        customStart={customStart}
        customEnd={customEnd}
        onChange={setRange}
        onCustomChange={(s, e) => { setCustomStart(s); setCustomEnd(e) }}
        translateRangeLabel={(key) => t(key)}
      />

      {/* Stat cards — row 1 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dashboard.totalSources')}
          value={data.sources.total}
          sub={t('dashboard.enabledSources', { count: data.sources.enabled })}
          icon={Database}
          tone="neutral"
        />
        <StatCard
          label={t('dashboard.recordsCollected')}
          value={data.records.total}
          sub={t('dashboard.aiProcessed', { count: data.records.ai_processed })}
          icon={FileText}
          tone="accent"
          trend={todayData && yesterdayData
            ? { current: todayData.new_records, previous: yesterdayData.new_records }
            : undefined}
        />
        <StatCard
          label={t('dashboard.runsToday')}
          value={todayData?.total_runs ?? 0}
          sub={t('dashboard.todayOutcomeSummary', {
            success: todayData?.success_runs ?? 0,
            failed: todayData?.failed_runs ?? 0,
          })}
          icon={Activity}
          tone="success"
          trend={todayData && yesterdayData
            ? { current: todayData.total_runs, previous: yesterdayData.total_runs }
            : undefined}
        />
        <StatCard
          label={t('dashboard.failedTasks')}
          value={data.tasks.failed}
          sub={t('dashboard.needsAttention')}
          icon={Zap}
          tone={data.tasks.failed > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {/* Stat cards — row 2: run stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label={t('dashboard.successRuns')}
          value={runs.success}
          sub={t('dashboard.totalExecutions', { count: runs.total })}
          icon={CheckCircle}
          tone="success"
        />
        <StatCard
          label={t('dashboard.failedRuns')}
          value={runs.failed}
          sub={t('dashboard.totalExecutions', { count: runs.total })}
          icon={XCircle}
          tone={runs.failed > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          label={t('dashboard.successRate')}
          value={`${runs.success_rate}%`}
          sub={runs.total > 0
            ? t('dashboard.ratio', { numerator: runs.success, denominator: runs.total })
            : t('dashboard.noData')}
          icon={Activity}
          tone={runs.success_rate >= 90 ? 'success' : runs.success_rate >= 70 ? 'warning' : 'danger'}
        />
      </div>

      <AgentFlightBoard runs={data.recent_runs} />

      {/* Charts */}
      {daily.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card padding={false}>
            <div className="border-b border-white/10 px-5 py-4">
              <p className="telemetry-label">RUNS / 7D</p>
      <h3 className="mt-1 text-sm font-semibold text-zinc-100">{t('dashboard.chart.title7d')}</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="1 8" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={{ stroke: CHART_GRID }}
                    tick={{ fill: CHART_AXIS, fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tick={{ fill: CHART_AXIS, fontSize: 11 }}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ color: CHART_AXIS, fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="total_runs" name={t('dashboard.chart.total.total')} stroke={CHART_TOTAL} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="success_runs" name={t('dashboard.chart.total.success')} stroke={CHART_SUCCESS} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="failed_runs" name={t('dashboard.chart.total.failed')} stroke={CHART_FAILED} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card padding={false}>
            <div className="border-b border-white/10 px-5 py-4">
              <p className="telemetry-label">RECORD INTAKE</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">{t('dashboard.newRecords7d')}</h3>
            </div>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="1 8" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={{ stroke: CHART_GRID }}
                    tick={{ fill: CHART_AXIS, fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tick={{ fill: CHART_AXIS, fontSize: 11 }}
                    tickLine={false}
                  />
                <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="new_records" name={t('dashboard.chart.newRecords')} fill={CHART_RECORDS} radius={[0, 0, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {/* Recent runs */}
      <Card padding={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <p className="telemetry-label">EVENT LOG</p>
            <h2 className="mt-1 font-semibold text-zinc-100">{t('dashboard.recentRuns')}</h2>
          </div>
          <span className="border border-white/10 bg-white/[0.03] px-2 py-1 font-telemetry text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            POLL 15S
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.025]">
                <th className="px-5 py-2.5 text-left font-telemetry text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500" style={{ width: '100px' }}>{t('common.status')}</th>
                <th className="px-5 py-2.5 text-left font-telemetry text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500" style={{ width: '220px' }}>{t('sources.title')}</th>
                <th className="px-5 py-2.5 text-left font-telemetry text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500" style={{ width: '90px' }}>{t('tasks.trigger')}</th>
                <th className="px-5 py-2.5 text-right font-telemetry text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500" style={{ width: '80px' }}>{t('dashboard.records')}</th>
                <th className="px-5 py-2.5 text-right font-telemetry text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500" style={{ width: '70px' }}>{t('dashboard.duration')}</th>
                <th className="px-5 py-2.5 text-right font-telemetry text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500" style={{ width: '140px' }}>{t('common.createdAt')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {data.recent_runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-zinc-500">{t('dashboard.noRuns')}</td>
                </tr>
              ) : (
                data.recent_runs.map((run) => (
                  <tr key={run.id} className="transition-colors hover:bg-white/[0.035]">
                    <td className="overflow-hidden px-5 py-3"><StatusBadge status={run.status} /></td>
                    <td className="overflow-hidden px-5 py-3">
                      <p className="truncate font-medium text-zinc-100">{run.source_name}</p>
                      <p className="truncate text-xs text-zinc-600">{run.task_id.slice(0, 8)}</p>
                    </td>
                    <td className="overflow-hidden px-5 py-3">
                      <span className="text-xs text-zinc-500">
                        {TRIGGER_LABELS[run.task_trigger_type] ? t(TRIGGER_LABELS[run.task_trigger_type]) : run.task_trigger_type}
                      </span>
                    </td>
                    <td className="overflow-hidden px-5 py-3 text-right text-zinc-400">{run.records_collected}</td>
                    <td className="overflow-hidden px-5 py-3 text-right text-zinc-400">
                      {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '-'}
                    </td>
                    <td className="overflow-hidden px-5 py-3 text-right text-zinc-500">
                      {formatInTimeZone(new Date(run.created_at), 'Asia/Shanghai', 'MM-dd HH:mm:ss')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
