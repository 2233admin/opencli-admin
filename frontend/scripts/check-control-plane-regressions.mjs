import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('task list links every work item to its operational detail', async () => {
  const tasks = await read('app/(app)/tasks/page.tsx')
  assert.match(tasks, /title="任务与通知"/)
  assert.match(tasks, /ACTION_CENTER_TABS/)
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

test('plugin hub imports reviewed OPML catalogs while sources manages installed instances', async () => {
  const sources = await read('app/(app)/sources/page.tsx')
  const plugins = await read('app/(app)/plugins/page.tsx')
  const importDialog = await read('components/plugins/rss-catalog-import-dialog.tsx')
  const endpoints = await read('lib/api/endpoints.ts')

  assert.match(plugins, /RssCatalogImportDialog/)
  assert.match(importDialog, /导入开源 RSS 源库/)
  assert.match(importDialog, /plenaryapp\/awesome-rss-feeds/)
  assert.match(importDialog, /所有源默认停用/)
  assert.match(importDialog, /分类和源库出处/)
  assert.match(sources, /limit: 50/)
  assert.match(sources, /pagination\.pages/)
  assert.match(endpoints, /\/sources\/import-opml-url/)
})
