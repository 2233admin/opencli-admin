import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('home breadcrumb navigates to the dashboard', async () => {
  const header = await read('components/shell/app-header.tsx')

  assert.match(header, /BreadcrumbLink/)
  assert.match(header, /href="\/dashboard"/)
})

test('model routing stays behind the advanced entry instead of a primary tab', async () => {
  const [tabs, primaryModel] = await Promise.all([
    read('components/shell/route-tabs.tsx'),
    read('components/providers/primary-model-card.tsx'),
  ])

  const modelTabs = tabs.slice(tabs.indexOf('export const MODEL_SETTINGS_TABS'))
  assert.doesNotMatch(modelTabs, /href: '\/providers\/routing'/)
  assert.match(primaryModel, /href="\/providers\/routing"/)
  assert.match(primaryModel, /高级路由/)
})

test('provider dialog closes with a scoped center-anchored collapse animation', async () => {
  const [dialog, dialogPrimitive, styles] = await Promise.all([
    read('components/providers/provider-form-dialog.tsx'),
    read('components/ui/dialog.tsx'),
    read('components/providers/provider-form-dialog.module.css'),
  ])

  assert.match(dialog, /provider-form-dialog\.module\.css/)
  assert.match(dialog, /styles\.motion/)
  assert.match(styles, /\.motion\[data-closed\]/)
  assert.match(styles, /transform-origin:\s*50% 50%/)
  assert.match(styles, /provider-dialog-collapse 200ms cubic-bezier/)
  assert.match(styles, /scaleY\(0\.025\)/)
  assert.doesNotMatch(styles, /transform:\s*translate\(-50%,\s*-50%\)/)
  assert.match(dialogPrimitive, /overlayClassName/)
  assert.match(dialog, /overlayClassName=\{styles\.overlay\}/)
  assert.match(styles, /\.overlay\[data-closed\]/)
  assert.match(styles, /provider-overlay-blur-collapse/)
  assert.match(styles, /backdrop-filter:\s*blur\(0\)/)
  assert.ok([...styles.matchAll(/backdrop-filter:\s*blur\(/g)].length >= 5)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('provider catalog exposes first-class RSSHub and RSS-Bridge connections', async () => {
  const [catalogPage, panel, endpoints, contracts] = await Promise.all([
    read('app/(app)/providers/catalog/page.tsx'),
    read('components/providers/rss-generator-provider-panel.tsx'),
    read('lib/api/endpoints.ts'),
    read('lib/workflow/node-contracts.ts'),
  ])

  assert.match(catalogPage, /RssGeneratorProviderPanel/)
  assert.match(panel, /RSSHub/)
  assert.match(panel, /RSS-Bridge/)
  assert.match(panel, /useFeedProviderCatalog/)
  assert.match(panel, /useBuildFeedProviderWorkflowNode/)
  assert.match(panel, /allow_private_network/)
  assert.match(endpoints, /\/providers\/feed-generators/)
  assert.match(contracts, /providerId/)
  assert.match(contracts, /generatorSelection/)
  assert.match(contracts, /provider token must remain backend-only/)
})
