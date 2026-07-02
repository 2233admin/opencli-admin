import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  EMPTY_OBJECTIVE_FORM,
  formatErrorRate,
  formatFreshnessLag,
  formatMetricCount,
  formatSourceTsQuality,
  formStateToObjectiveOverride,
  measurementsEmptyMessage,
  objectiveToFormState,
  toMeasurementChartPoints,
  toTrendSummaryView,
} from './sourceControlRoom.ts'
import type { SourceControlTrend, SourceMeasurementRecord, SourceObjective } from '../../api/types.ts'

function baseMeasurement(overrides: Partial<SourceMeasurementRecord> = {}): SourceMeasurementRecord {
  return {
    id: 'm-1',
    source_id: 'src-1',
    run_id: 'run-1',
    measured_at: '2026-07-02T00:00:00Z',
    accepted: 5,
    duplicates: 1,
    rejected: 0,
    error_rate: 0.0,
    duplicate_rate: 0.166,
    error_kinds: {},
    fetch_latency_ms: 100,
    ingest_latency_ms: null,
    store_latency_ms: null,
    cursor_advanced: true,
    newest_source_ts: null,
    newest_observed_at: null,
    freshness_lag_seconds: null,
    source_ts_quality: 'missing',
    raw: {},
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
    ...overrides,
  }
}

describe('formatMetricCount', () => {
  it('renders an em-dash when there is no measurement yet', () => {
    assert.equal(formatMetricCount(null), '—')
    assert.equal(formatMetricCount(undefined), '—')
  })

  it('renders a zero count honestly (not as missing data)', () => {
    assert.equal(formatMetricCount(0), '0')
  })

  it('renders a positive count as its string', () => {
    assert.equal(formatMetricCount(42), '42')
  })
})

describe('formatErrorRate', () => {
  it('renders an em-dash when absent', () => {
    assert.equal(formatErrorRate(null), '—')
  })

  it('renders a rounded percentage', () => {
    assert.equal(formatErrorRate(0.125), '13%')
    assert.equal(formatErrorRate(0), '0%')
    assert.equal(formatErrorRate(1), '100%')
  })
})

describe('formatFreshnessLag', () => {
  it('renders an em-dash when the signal was never captured', () => {
    assert.equal(formatFreshnessLag(null), '—')
    assert.equal(formatFreshnessLag(undefined), '—')
  })

  it('renders seconds under a minute as seconds', () => {
    assert.equal(formatFreshnessLag(45), '45s')
  })

  it('renders minutes under an hour as minutes', () => {
    assert.equal(formatFreshnessLag(150), '3m')
  })

  it('renders an hour or more as hours', () => {
    assert.equal(formatFreshnessLag(7200), '2h')
  })
})

describe('formatSourceTsQuality', () => {
  it('renders an em-dash when there is no measurement at all', () => {
    assert.equal(formatSourceTsQuality(null), '—')
    assert.equal(formatSourceTsQuality(undefined), '—')
  })

  it('passes through the quality string as-is', () => {
    assert.equal(formatSourceTsQuality('source'), 'source')
    assert.equal(formatSourceTsQuality('missing'), 'missing')
  })
})

describe('toMeasurementChartPoints', () => {
  it('sorts ascending by time regardless of input order (API returns newest-first)', () => {
    const rows = [
      baseMeasurement({ id: 'newer', measured_at: '2026-07-02T00:00:00Z' }),
      baseMeasurement({ id: 'older', measured_at: '2026-07-01T00:00:00Z' }),
    ]
    const points = toMeasurementChartPoints(rows)
    assert.deepEqual(points.map((p) => p.id), ['older', 'newer'])
  })

  it('rescales error_rate (0..1) to a percentage (0..100)', () => {
    const points = toMeasurementChartPoints([baseMeasurement({ error_rate: 0.256 })])
    assert.equal(points[0].errorRatePercent, 25.6)
  })

  it('carries accepted through unchanged', () => {
    const points = toMeasurementChartPoints([baseMeasurement({ accepted: 7 })])
    assert.equal(points[0].accepted, 7)
  })

  it('returns an empty array for an empty input (pre-measurement source)', () => {
    assert.deepEqual(toMeasurementChartPoints([]), [])
  })
})

describe('measurementsEmptyMessage', () => {
  it('labels a zero-row source as pre-measurement, not unhealthy', () => {
    assert.equal(measurementsEmptyMessage(0), 'pre-measurement source — no sensor rows yet')
  })

  it('uses a different message when rows exist but none matched the current page/range', () => {
    assert.equal(measurementsEmptyMessage(5), 'no measurements in range')
  })
})

describe('toTrendSummaryView', () => {
  function baseTrend(overrides: Partial<SourceControlTrend> = {}): SourceControlTrend {
    return {
      window: 10,
      zero_accepted_streak: 0,
      avg_error_rate: 0,
      rate_limited_runs: 0,
      ...overrides,
    }
  }

  it('marks a measurement-backed trend as not run-history-derived', () => {
    const view = toTrendSummaryView(baseTrend())
    assert.equal(view.isRunHistoryDerived, false)
    assert.equal(view.windowLabel, 'last 10 runs')
  })

  it('marks a run_history-provenance trend as run-history-derived', () => {
    const view = toTrendSummaryView(baseTrend({ provenance: 'run_history' }))
    assert.equal(view.isRunHistoryDerived, true)
  })

  it('rescales avg_error_rate to a percentage', () => {
    const view = toTrendSummaryView(baseTrend({ avg_error_rate: 0.333 }))
    assert.equal(view.avgErrorRatePercent, 33.3)
  })
})

describe('objectiveToFormState / formStateToObjectiveOverride', () => {
  function baseObjective(overrides: Partial<SourceObjective> = {}): SourceObjective {
    return {
      max_error_rate: 0.05,
      max_duplicate_rate: 0.5,
      max_freshness_lag_seconds: null,
      max_run_latency_ms: 30_000,
      max_pending: 1000,
      min_accepted_per_run: null,
      ...overrides,
    }
  }

  it('seeds every field with a concrete string from the resolved objective', () => {
    const form = objectiveToFormState(baseObjective())
    assert.equal(form.max_error_rate, '0.05')
    assert.equal(form.max_run_latency_ms, '30000')
    assert.equal(form.max_freshness_lag_seconds, '')
    assert.equal(form.min_accepted_per_run, '')
  })

  it('round-trips a non-null optional field', () => {
    const form = objectiveToFormState(baseObjective({ max_freshness_lag_seconds: 120, min_accepted_per_run: 3 }))
    assert.equal(form.max_freshness_lag_seconds, '120')
    assert.equal(form.min_accepted_per_run, '3')
  })

  it('omits blank fields from the override body rather than sending 0', () => {
    const override = formStateToObjectiveOverride(EMPTY_OBJECTIVE_FORM)
    assert.deepEqual(override, {})
  })

  it('includes only the fields the operator actually filled in', () => {
    const override = formStateToObjectiveOverride({
      ...EMPTY_OBJECTIVE_FORM,
      max_error_rate: '0.1',
      max_pending: '500',
    })
    assert.deepEqual(override, { max_error_rate: 0.1, max_pending: 500 })
  })

  it('skips a field left as non-numeric garbage rather than sending NaN', () => {
    const override = formStateToObjectiveOverride({ ...EMPTY_OBJECTIVE_FORM, max_error_rate: 'not-a-number' })
    assert.deepEqual(override, {})
  })
})
