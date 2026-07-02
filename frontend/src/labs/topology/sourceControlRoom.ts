// Pure data-mapping seam for the Source Control Room page (per-source
// control-loop drill-in view). Framework-free so `node --test` can cover
// chart-point projection / freshness formatting / objective-form diffing
// without mounting anything — mirrors actionHistory.ts's convention.
import type { SourceControlTrend, SourceMeasurementRecord, SourceObjective } from '../../api/types'

// ── Metric cards (latest measurement) ───────────────────────────────────────

/** Render an integer metric as its string, or an em-dash when there is no
 * measurement yet — never fabricate a "0" for a source that has never run
 * (project-wide "never fake a signal" contract). */
export function formatMetricCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return String(value)
}

/** error_rate is a 0..1 fraction; render as a rounded percentage, em-dash
 * when absent. */
export function formatErrorRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value * 100)}%`
}

/** Freshness lag in seconds -> a compact human string. Null means the signal
 * simply hasn't been captured (see source_ts_quality) — render an em-dash,
 * not "0s" or "unknown" prose that could be mistaken for a real reading. */
export function formatFreshnessLag(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h`
}

/** source_ts_quality is always a string on a real measurement row
 * ('source' | 'observed_fallback' | 'missing' | 'invalid' | 'synthetic'),
 * but the metric card has no measurement at all pre-first-run. */
export function formatSourceTsQuality(quality: string | null | undefined): string {
  if (!quality) return '—'
  return quality
}

// ── Trend chart (measurement history) ───────────────────────────────────────

export interface MeasurementChartPoint {
  id: string
  timestamp: number
  timeLabel: string
  accepted: number
  errorRatePercent: number
}

/** Project the newest-first API listing into ascending-by-time chart points
 * (recharts reads left-to-right as oldest-to-newest). `error_rate` is
 * rescaled to 0..100 here so the chart's y-axis reads as a percentage
 * without per-tick math in the render layer. */
export function toMeasurementChartPoints(rows: SourceMeasurementRecord[]): MeasurementChartPoint[] {
  return [...rows]
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime())
    .map((row) => {
      const date = new Date(row.measured_at)
      return {
        id: row.id,
        timestamp: date.getTime(),
        timeLabel: Number.isNaN(date.getTime())
          ? '—'
          : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        accepted: row.accepted,
        errorRatePercent: Math.round(row.error_rate * 1000) / 10,
      }
    })
}

/** A source with zero measurement rows is "pre-measurement", not unhealthy —
 * distinct empty-state copy from "no data matched this filter". */
export function measurementsEmptyMessage(total: number): string {
  if (total === 0) return 'pre-measurement source — no sensor rows yet'
  return 'no measurements in range'
}

// ── Trend summary (control-state's rolling window, possibly run-history-derived) ─

export interface TrendSummaryView {
  windowLabel: string
  zeroAcceptedStreak: number
  avgErrorRatePercent: number
  rateLimitedRuns: number
  isRunHistoryDerived: boolean
}

/** Project SourceControlState.trend for display. `isRunHistoryDerived` must
 * be checked by the caller to render the "run-history-derived, not
 * measurement-backed" label — see SourceControlTrend.provenance. */
export function toTrendSummaryView(trend: SourceControlTrend): TrendSummaryView {
  return {
    windowLabel: `last ${trend.window} runs`,
    zeroAcceptedStreak: trend.zero_accepted_streak,
    avgErrorRatePercent: Math.round(trend.avg_error_rate * 1000) / 10,
    rateLimitedRuns: trend.rate_limited_runs,
    isRunHistoryDerived: trend.provenance === 'run_history',
  }
}

// ── Objective override form ─────────────────────────────────────────────────

/** Field keys the Source Control Room's objective form edits — mirrors
 * backend.control.objectives.SourceObjectiveOverride's field set (every
 * field optional; unset = "use default for this field"). */
export const OBJECTIVE_FIELDS = [
  'max_error_rate',
  'max_duplicate_rate',
  'max_freshness_lag_seconds',
  'max_run_latency_ms',
  'max_pending',
  'min_accepted_per_run',
] as const

export type ObjectiveField = (typeof OBJECTIVE_FIELDS)[number]

/** String-valued form state — numeric inputs hold strings while being typed
 * (so "" and "-" are representable), converted to numbers only on submit. */
export type ObjectiveFormState = Record<ObjectiveField, string>

export const EMPTY_OBJECTIVE_FORM: ObjectiveFormState = {
  max_error_rate: '',
  max_duplicate_rate: '',
  max_freshness_lag_seconds: '',
  max_run_latency_ms: '',
  max_pending: '',
  min_accepted_per_run: '',
}

/** Seed the form from the RESOLVED objective (defaults merged with any
 * override) so every field always shows a concrete number to start from. */
export function objectiveToFormState(objective: SourceObjective): ObjectiveFormState {
  return {
    max_error_rate: String(objective.max_error_rate),
    max_duplicate_rate: String(objective.max_duplicate_rate),
    max_freshness_lag_seconds:
      objective.max_freshness_lag_seconds === null || objective.max_freshness_lag_seconds === undefined
        ? ''
        : String(objective.max_freshness_lag_seconds),
    max_run_latency_ms: String(objective.max_run_latency_ms),
    max_pending: String(objective.max_pending),
    min_accepted_per_run:
      objective.min_accepted_per_run === null || objective.min_accepted_per_run === undefined
        ? ''
        : String(objective.min_accepted_per_run),
  }
}

/** Build the PATCH body from form state: blank fields are omitted (not sent
 * as 0/null), so an operator who clears one field doesn't accidentally reset
 * every other field to its default. Returns null values only get sent via
 * `clearObjectiveOverride`, never through this path. */
export function formStateToObjectiveOverride(form: ObjectiveFormState): Record<string, number> {
  const override: Record<string, number> = {}
  for (const field of OBJECTIVE_FIELDS) {
    const raw = form[field].trim()
    if (raw === '') continue
    const num = Number(raw)
    if (Number.isNaN(num)) continue
    override[field] = num
  }
  return override
}
