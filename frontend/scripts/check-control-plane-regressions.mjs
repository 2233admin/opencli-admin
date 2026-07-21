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

test('plugin hub keeps provider management without hiding provider capabilities', async () => {
  const plugins = await read('app/(app)/plugins/page.tsx')
  const opencli = await read('app/(app)/plugins/opencli/page.tsx')
  const rssImport = await read('components/plugins/rss-catalog-import-dialog.tsx')
  const providerCatalog = await read('lib/plugins/provider-catalog.ts')

  assert.match(plugins, /已安装/)
  assert.match(plugins, /探索市场/)
  assert.match(plugins, /PLUGIN_PROVIDER_CATEGORIES/)
  for (const label of ['模型', '工具', '数据源', 'Agent 策略', '触发器', '扩展', '工具包']) {
    assert.match(providerCatalog, new RegExp(label))
  }
  assert.match(plugins, /useWorkflowCapabilities\(true\)/)
  assert.match(plugins, /PLUGIN_PROVIDERS/)
  assert.match(plugins, /安装插件包/)
  assert.match(plugins, /router\.push\('\/plugins\/opencli'\)/)
  assert.match(plugins, /RssCatalogImportDialog/)
  assert.match(plugins, /DifyPackageImportDialog/)
  assert.match(plugins, /useBackendPluginCatalog\(true\)/)
  assert.match(plugins, /导入 OPML 订阅清单/)
  assert.match(providerCatalog, /category: 'datasource'/)
  assert.match(providerCatalog, /category: 'tool'/)
  assert.match(providerCatalog, /category: 'bundle'/)
  assert.doesNotMatch(plugins, /NodeCapabilityTab|节点能力目录|全部节点|待完善|加入管线|创建自定义节点/)
  assert.doesNotMatch(plugins, /数据源连接器|内置来源包|数据源工作台|公共来源目录|选择并导入/)
  assert.match(opencli, /useOpenCLIAdapterRegistry\(true\)/)
  assert.match(opencli, /OPENCLI_SITE_CATEGORIES/)
  assert.match(opencli, /搜索网站、域名或能力/)
  assert.match(opencli, /plugin\.commands/)
  assert.match(opencli, /refresh\(\)/)
  assert.match(rssImport, /api\.importRssCatalog/)
  assert.match(rssImport, /所有(?:源|条目)默认停用/)
})
