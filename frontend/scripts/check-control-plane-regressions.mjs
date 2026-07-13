import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('task list links every work item to its operational detail', async () => {
  const tasks = await read('app/(app)/tasks/page.tsx')
  assert.match(tasks, /title="工作项"/)
  assert.match(tasks, /href=\{`\/tasks\/\$\{t\.id\}`\}/)
})

test('work item detail keeps runs, events, results, and audit in one context', async () => {
  const detail = await read('app/(app)/tasks/[id]/page.tsx')
  assert.match(detail, /listTaskRuns\(id\)/)
  assert.match(detail, /listRunEvents\(id, selectedRun!\.id\)/)
  assert.match(detail, /执行摘要/)
  assert.match(detail, /执行时间线/)
  assert.match(detail, /检查数据成果/)
  assert.match(detail, /查看控制与审计/)
})
