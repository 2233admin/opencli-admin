import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'

import { getSource, getSourceControlState, listSourceMeasurements, setSourceObjective } from '../api/endpoints'
import Card from '../components/Card'
import ErrorAlert from '../components/ErrorAlert'
import { PageLoader } from '../components/LoadingSpinner'
import PageHeader from '../components/PageHeader'
import StatTile from '../components/StatTile'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ControlBadge, SensorCoverageBadge, SuggestedActionsRow } from '../node-kit/render/atoms'
import {
  EMPTY_OBJECTIVE_FORM,
  OBJECTIVE_FIELDS,
  formatErrorRate,
  formatFreshnessLag,
  formatMetricCount,
  formatSourceTsQuality,
  formStateToObjectiveOverride,
  measurementsEmptyMessage,
  objectiveToFormState,
  toMeasurementChartPoints,
  toTrendSummaryView,
  type ObjectiveField,
  type ObjectiveFormState,
} from '../labs/topology/sourceControlRoom'

const POLL_MS = 15_000

const OBJECTIVE_FIELD_LABELS: Record<ObjectiveField, string> = {
  max_error_rate: 'Max error rate (0-1)',
  max_duplicate_rate: 'Max duplicate rate (0-1)',
  max_freshness_lag_seconds: 'Max freshness lag (s)',
  max_run_latency_ms: 'Max run latency (ms)',
  max_pending: 'Max ODP pending',
  min_accepted_per_run: 'Min accepted / run',
}

/** The operator's drill-in view for one source's control loop (Control Room
 * package A, tracer bullet 1): header identity + control badges, latest
 * measurement metric cards, a trend chart over the raw measurement history,
 * the control-state trend summary + advisory suggestions, and the resolved
 * objective with an override editor. Read-only except the objective PATCH —
 * no execute buttons anywhere (mirrors SourceControlStrip's advisory-only
 * contract). */
export default function SourceControlRoomPage() {
  const { sourceId = '' } = useParams()
  const queryClient = useQueryClient()
  const [objectiveForm, setObjectiveForm] = useState<ObjectiveFormState>(EMPTY_OBJECTIVE_FORM)
  const [formTouched, setFormTouched] = useState(false)

  const sourceQuery = useQuery({
    queryKey: ['source', sourceId],
    queryFn: () => getSource(sourceId),
    enabled: sourceId.length > 0,
    refetchInterval: POLL_MS,
  })

  const controlStateQuery = useQuery({
    queryKey: ['source-control-state', sourceId],
    queryFn: () => getSourceControlState(sourceId),
    enabled: sourceId.length > 0,
    refetchInterval: POLL_MS,
  })

  const measurementsQuery = useQuery({
    queryKey: ['source-measurements', sourceId],
    queryFn: () => listSourceMeasurements(sourceId, { page: 1, limit: 100 }),
    enabled: sourceId.length > 0,
    refetchInterval: POLL_MS,
  })

  const objective = controlStateQuery.data?.objective

  useEffect(() => {
    if (!objective || formTouched) return
    setObjectiveForm(objectiveToFormState(objective))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objective])

  const objectiveMutation = useMutation({
    mutationFn: (override: Record<string, unknown> | null) => setSourceObjective(sourceId, override),
    onSuccess: () => {
      setFormTouched(false)
      queryClient.invalidateQueries({ queryKey: ['source-control-state', sourceId] })
      queryClient.invalidateQueries({ queryKey: ['source', sourceId] })
      toast.success('objective override saved')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'failed to save objective override')
    },
  })

  if (!sourceId) {
    return <ErrorAlert error="No source id in route." />
  }

  if (sourceQuery.isLoading) return <PageLoader />
  if (sourceQuery.error) {
    return <ErrorAlert error={sourceQuery.error as Error} onRetry={() => sourceQuery.refetch()} />
  }

  const source = sourceQuery.data
  const state = controlStateQuery.data
  const measurement = state?.measurement
  const measurementRows = measurementsQuery.data?.data ?? []
  const measurementsTotal = measurementsQuery.data?.meta?.total ?? 0
  const chartPoints = toMeasurementChartPoints(measurementRows)
  const trendView = state?.trend ? toTrendSummaryView(state.trend) : null

  const updateField = (field: ObjectiveField, value: string) => {
    setFormTouched(true)
    setObjectiveForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = () => {
    objectiveMutation.mutate(formStateToObjectiveOverride(objectiveForm))
  }

  const handleClearOverride = () => {
    objectiveMutation.mutate(null)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={source ? `控制室 · ${source.name}` : '控制室'}
        description="单个数据源的控制回路详情：最新测量、趋势历史、建议动作和 objective 设定。"
        action={
          <Link
            to="/sources"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100"
          >
            <ArrowLeft size={14} /> 返回数据源
          </Link>
        }
      />

      {source && (
        <Card className="border-white/8 bg-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-zinc-50">{source.name}</h2>
                <Badge variant="outline">{source.channel_type}</Badge>
                <span className={source.enabled ? 'text-xs text-emerald-300' : 'text-xs text-zinc-500'}>
                  {source.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-zinc-500">{source.id}</p>
            </div>
            {!controlStateQuery.isLoading && !controlStateQuery.error && (
              <div className="flex flex-wrap items-center gap-1.5">
                <ControlBadge controlState={state?.control_state ?? null} confidence={state?.confidence ?? null} />
                <SensorCoverageBadge coverage={state?.sensor_coverage ?? null} missingSignals={state?.missing_signals ?? []} />
              </div>
            )}
          </div>
        </Card>
      )}

      {controlStateQuery.isLoading ? (
        <PageLoader />
      ) : controlStateQuery.error ? (
        <ErrorAlert error={controlStateQuery.error as Error} onRetry={() => controlStateQuery.refetch()} />
      ) : (
        <>
          {/* Metric cards row — latest measurement, honestly em-dashed when the
              source has never run (measurement === null). */}
          <Card padding={false} className="border-white/8 bg-black/20">
            <div className="border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-100">最新测量</h3>
              {!measurement && (
                <p className="mt-1 text-xs text-zinc-500">该数据源尚未产生任何测量 — pre-measurement。</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile label="Accepted" value={formatMetricCount(measurement?.accepted)} />
              <StatTile label="Rejected" value={formatMetricCount(measurement?.rejected)} />
              <StatTile label="Duplicates" value={formatMetricCount(measurement?.duplicates)} />
              <StatTile label="Error rate" value={formatErrorRate(measurement?.error_rate)} />
              <StatTile
                label="Freshness"
                value={
                  <span>
                    {formatFreshnessLag(measurement?.freshness_lag_seconds)}{' '}
                    <span className="text-3xs text-zinc-500">
                      ({formatSourceTsQuality(measurement?.source_ts_quality)})
                    </span>
                  </span>
                }
              />
            </div>
          </Card>

          {/* Trend chart — raw measurement history from the new endpoint. */}
          <Card className="border-white/8 bg-black/20">
            <h3 className="text-sm font-semibold text-zinc-100">趋势（accepted / error rate）</h3>
            {measurementsQuery.isLoading ? (
              <PageLoader />
            ) : measurementsQuery.error ? (
              <ErrorAlert error={measurementsQuery.error as Error} onRetry={() => measurementsQuery.refetch()} />
            ) : chartPoints.length === 0 ? (
              <p className="mt-3 border border-dashed border-white/15 bg-black/20 px-4 py-6 text-center text-xs text-zinc-500">
                {measurementsEmptyMessage(measurementsTotal)}
              </p>
            ) : (
              <div className="mt-3 h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartPoints} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="1 8" stroke="rgba(255,255,255,0.1)" vertical={false} />
                    <XAxis dataKey="timeLabel" tick={{ fontSize: 10, fill: '#71717a' }} minTickGap={24} />
                    <YAxis yAxisId="accepted" tick={{ fontSize: 10, fill: '#71717a' }} allowDecimals={false} />
                    <YAxis
                      yAxisId="errorRate"
                      orientation="right"
                      tick={{ fontSize: 10, fill: '#71717a' }}
                      unit="%"
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="accepted" dataKey="accepted" name="accepted" fill="#34d399" barSize={12} />
                    <Area
                      yAxisId="errorRate"
                      type="monotone"
                      dataKey="errorRatePercent"
                      name="error rate %"
                      stroke="#ff3b30"
                      fill="#ff3b30"
                      fillOpacity={0.12}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Trend summary + suggested actions — display-only, same semantics
              as SourceControlStrip (no execute buttons). */}
          <Card className="border-white/8 bg-black/20">
            <h3 className="text-sm font-semibold text-zinc-100">趋势摘要 &amp; 建议动作</h3>
            {trendView ? (
              <div className="mt-3 space-y-2">
                {trendView.isRunHistoryDerived && (
                  <Badge variant="secondary" className="text-3xs">
                    run-history-derived — not measurement-backed
                  </Badge>
                )}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <StatTile label="Window" value={trendView.windowLabel} />
                  <StatTile label="0-accepted streak" value={trendView.zeroAcceptedStreak} />
                  <StatTile label="Avg error rate" value={`${trendView.avgErrorRatePercent}%`} />
                  <StatTile label="Rate-limited runs" value={trendView.rateLimitedRuns} />
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">no trend available yet</p>
            )}
            <div className="mt-3">
              <SuggestedActionsRow actions={state?.suggested_actions} controlMode={state?.control_mode} />
              {(state?.suggested_actions ?? []).length === 0 && (
                <p className="text-xs text-zinc-500">no suggestions from the policy engine right now</p>
              )}
            </div>
          </Card>

          {/* Objective panel — resolved values + override editor. */}
          <Card className="border-white/8 bg-black/20">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-100">Objective</h3>
              {source?.objective_override && (
                <Badge variant="secondary" className="text-3xs">
                  override active
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              以下为解析后（默认值叠加 override）的设定值 — 测量数据据此判定 control_state。留空字段保存时不会覆盖对应字段。
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {OBJECTIVE_FIELDS.map((field) => (
                <label key={field} className="grid gap-1">
                  <span className="text-2xs text-zinc-500">{OBJECTIVE_FIELD_LABELS[field]}</span>
                  <Input
                    type="number"
                    step="any"
                    value={objectiveForm[field]}
                    onChange={(e) => updateField(field, e.target.value)}
                    placeholder="—"
                    className="h-8 text-xs"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={handleSave} disabled={objectiveMutation.isPending}>
                {objectiveMutation.isPending ? '保存中…' : '保存 override'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleClearOverride}
                disabled={objectiveMutation.isPending || !source?.objective_override}
              >
                清除 override（恢复默认）
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
