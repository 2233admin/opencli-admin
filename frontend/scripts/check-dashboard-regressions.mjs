import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('dashboard is an action-first control plane backed by real hooks', async () => {
  const dashboard = await read('app/(app)/dashboard/page.tsx')

  assert.match(dashboard, /useDashboardStats\(\)/)
  assert.match(dashboard, /useDashboardActivity\(\)/)
  assert.match(dashboard, /useOpinionMonitor\(\)/)
  assert.match(dashboard, /useWorkers\(\)/)
  assert.doesNotMatch(dashboard, /useMonitorFeed/)
  assert.doesNotMatch(dashboard, /演示数据/)
})

test('dashboard answers attention, live state, and next action before analytics', async () => {
  const dashboard = await read('app/(app)/dashboard/page.tsx')
  const attention = dashboard.indexOf('需要你处理')
  const liveState = dashboard.indexOf('现在正在发生')
  const nextAction = dashboard.indexOf('下一步')
  const overview = dashboard.indexOf('系统概览')

  assert.ok(attention >= 0, 'attention summary should be present')
  assert.ok(liveState > attention, 'live state should follow the attention summary')
  assert.ok(nextAction > liveState, 'next actions should follow live state')
  assert.ok(overview > nextAction, 'analytics should be secondary to actions')

  for (const href of ['/studio/workflow', '/sources', '/schedules', '/tasks']) {
    assert.match(dashboard, new RegExp(`href="${href.replace('/', '\\/')}"`))
  }
})

test('dashboard keeps existing real operational views after the action layer', async () => {
  const dashboard = await read('app/(app)/dashboard/page.tsx')

  assert.match(dashboard, /<TaskStream tasks=\{stream\}/)
  assert.match(dashboard, /<FailureFeed failures=\{failures\}/)
  assert.match(dashboard, /<ThroughputChart data=\{throughput\} daily/)
  assert.match(dashboard, /<WorkerAllocation workers=\{workers\}/)
  assert.match(dashboard, /<OpinionMonitorPanel/)
})
