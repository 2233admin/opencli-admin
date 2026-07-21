import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import ts from 'typescript'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

async function loadProviderCatalog() {
  const source = await read('lib/plugins/provider-catalog.ts')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
}

test('installed plugin view keeps bundled providers beside registry installations', async () => {
  const catalog = await loadProviderCatalog()
  const bundledOpenCLI = catalog.PLUGIN_PROVIDERS.find((provider) => provider.id === 'opencli')
  const registryOpenCLI = {
    ...bundledOpenCLI,
    name: 'Registry OpenCLI',
    runtimeStatus: 'READY',
  }
  const thirdParty = {
    id: 'third-party',
    name: 'Third Party',
    author: 'Example',
    category: 'tool',
    description: 'External provider.',
    icon: 'wrench',
    nodeIds: [],
    tags: [],
  }

  const merged = catalog.mergeBundledPluginProviders([registryOpenCLI, thirdParty])

  assert.equal(merged.find((provider) => provider.id === 'opencli')?.name, 'Registry OpenCLI')
  assert.equal(merged.find((provider) => provider.id === 'opencli')?.runtimeStatus, 'READY')
  assert.ok(merged.some((provider) => provider.id === 'workflow-bundles'))
  assert.ok(merged.some((provider) => provider.id === 'model-runtime'))
  assert.ok(merged.some((provider) => provider.id === 'third-party'))
})

test('plugin hub exposes category counts and category-specific context', async () => {
  const plugins = await read('app/(app)/plugins/page.tsx')
  const providerCatalog = await read('lib/plugins/provider-catalog.ts')

  assert.match(plugins, /mergeBundledPluginProviders/)
  assert.match(plugins, /categoryCounts\.get\(item\.key\)/)
  assert.match(plugins, /activeCategory === 'bundle'/)
  assert.match(plugins, /具体节点在 Studio 中选择/)
  assert.match(providerCatalog, /name: '预制工作流工具包'/)
})
