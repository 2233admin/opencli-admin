import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('visualization library exposes shared operational chart primitives', async () => {
  const [frame, timeSeries, distribution, funnel] = await Promise.all([
    read('components/visualization/visualization-card.tsx'),
    read('components/visualization/time-series-chart.tsx'),
    read('components/visualization/distribution-chart.tsx'),
    read('components/visualization/conversion-funnel.tsx'),
  ])

  assert.match(frame, /VisualizationCard/)
  assert.match(frame, /aria-busy/)
  assert.match(frame, /暂无可用数据/)
  assert.match(timeSeries, /TimeSeriesChart/)
  assert.match(timeSeries, /ChartTooltipContent/)
  assert.match(distribution, /DonutChart/)
  assert.match(distribution, /HorizontalBarChart/)
  assert.match(funnel, /ConversionFunnel/)
})

test('dashboard composes real data through the visualization library', async () => {
  const [dashboard, analytics, throughput] = await Promise.all([
    read('app/(app)/dashboard/page.tsx'),
    read('components/monitor/operational-analytics.tsx'),
    read('components/monitor/throughput-chart.tsx'),
  ])

  assert.match(dashboard, /<OperationalAnalytics/)
  assert.match(analytics, /Run outcome/)
  assert.match(analytics, /Processing funnel/)
  assert.ok(analytics.includes('opinion.summary.records'))
  assert.ok(!analytics.includes('opinion.summary.feishu_sent'))
  assert.ok(analytics.includes("['unknown', '未知']"))
  assert.ok(!analytics.includes('stats.sources.enabled'))
  assert.match(analytics, /Opinion distribution/)
  assert.match(throughput, /yAxisId="runs"/)
  assert.match(throughput, /yAxisId="records"/)
  assert.match(throughput, /accessibilityLayer/)
})

test('dashboard keeps percentage and worker capacity contracts honest', async () => {
  const dashboard = await read('app/(app)/dashboard/page.tsx')

  assert.ok(dashboard.includes('Math.round(s.runs.success_rate ?? 0)'))
  assert.ok(!dashboard.includes('(s.runs.success_rate ?? 0) * 100'))
  assert.ok(dashboard.includes('w.active_tasks / concurrency'))
  assert.ok(dashboard.includes('w.active_tasks - concurrency'))
  assert.ok(!dashboard.includes('w.active_tasks * 18'))
})
