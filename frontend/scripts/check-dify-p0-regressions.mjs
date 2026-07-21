import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(frontendRoot, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidates = []
    if (specifier.startsWith('@/')) {
      candidates.push(path.join(frontendRoot, specifier.slice(2)))
    } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      candidates.push(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
    }
    for (const candidate of candidates) {
      for (const resolvedPath of [candidate, `${candidate}.ts`, `${candidate}.tsx`]) {
        if (existsSync(resolvedPath)) {
          return { url: pathToFileURL(resolvedPath).href, shortCircuit: true }
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts') || url.endsWith('.tsx')) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
        mode: 'transform',
        sourceMap: true,
        sourceUrl: url,
      })
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

const readFrontendSource = (relativePath) => readFile(path.join(frontendRoot, relativePath), 'utf8')
const readRepositorySource = (relativePath) => readFile(path.join(repositoryRoot, relativePath), 'utf8')
const importTypeScript = (relativePath) => import(pathToFileURL(path.join(frontendRoot, relativePath)).href)

test('pure Dify DSL becomes one locked expandable compatibility package', async () => {
  const [{ translateDifyWorkflowToWorkflowProject }, source] = await Promise.all([
    importTypeScript('lib/workflow/dify-translator.ts'),
    readRepositorySource('tests/fixtures/dify/pure_logic.yml'),
  ])
  const translated = translateDifyWorkflowToWorkflowProject(parseYaml(source))

  assert.equal(translated.ok, true)
  assert.equal(translated.project.nodes.length, 1)
  const packageNode = translated.project.nodes[0]
  assert.equal(packageNode.params.packageFormat, 'dify')
  assert.equal(packageNode.internals.locked, true)
  assert.equal(packageNode.internals.nodes.length, 2)
  assert.equal(packageNode.ui.package.expandable, true)
  assert.equal(translated.report.executable, false, 'browser fallback must never claim execution readiness')
})

test('Studio uses the managed backend import boundary and explains exact blockers', async () => {
  const [codec, backendImport, studio, commandStrip] = await Promise.all([
    readFrontendSource('lib/workflow/codec.ts'),
    readFrontendSource('lib/workflow/backend-dify-import.ts'),
    readFrontendSource('app/(app)/studio/page.tsx'),
    readFrontendSource('components/flow/command-strip.tsx'),
  ])

  assert.match(codec, /translateWorkflowDslManaged/)
  assert.match(codec, /await importDifyWorkflow\(source\)/)
  assert.match(backendImport, /\/api\/workflow\/import\/dify/)
  assert.match(studio, /translateWorkflowDslManaged\(await file\.text\(\)\)/)
  assert.match(studio, /Graphon/)
  assert.match(commandStrip, /difyReport\.blockers\.length/)
})

test('plugin center is registry-backed and never executes plugin-owned frontend code', async () => {
  const [catalog, page, dialog] = await Promise.all([
    readFrontendSource('lib/plugins/backend-plugin-catalog.ts'),
    readFrontendSource('app/(app)/plugins/page.tsx'),
    readFrontendSource('components/plugins/dify-package-import-dialog.tsx'),
  ])

  assert.match(catalog, /fetch\("\/api\/v1\/plugins"/)
  assert.match(catalog, /fetch\("\/api\/v1\/plugins\/import\/dify"/)
  assert.match(catalog, /Authorization/)
  assert.match(page, /useBackendPluginCatalog/)
  assert.match(page, /backendUnavailable:\s*true/)
  assert.match(page, /不会把它们标记成“已安装”/)
  assert.match(dialog, /只登记元数据，不执行包内代码/)
  for (const source of [catalog, page, dialog]) {
    assert.doesNotMatch(source, /eval\s*\(/)
    assert.doesNotMatch(source, /new\s+Function\s*\(/)
    assert.doesNotMatch(source, /import\s*\(\s*provider/)
  }
})

test('projected plugin nodes show provenance and stay locked in the palette', async () => {
  const [catalog, palette] = await Promise.all([
    readFrontendSource('lib/workflow/node-catalog.ts'),
    readFrontendSource('components/flow/command-palette.tsx'),
  ])

  assert.match(catalog, /backend\.services\.plugin_registry_service/)
  assert.match(catalog, /workflowCatalogItemLocked/)
  assert.match(catalog, /workflowCatalogPluginProvenance/)
  assert.match(palette, /disabled=\{locked\}/)
  assert.match(palette, /provenance\.providerKey/)
  assert.match(palette, /该插件能力尚未绑定运行适配器/)
})

test('backend keeps Dify execution behind the pinned Graphon binding', async () => {
  const [projection, compile, sidecar] = await Promise.all([
    readRepositorySource('backend/workflow/capability_projection.py'),
    readRepositorySource('backend/workflow/dify_compile.py'),
    readRepositorySource('compat/dify_graphon_runtime/engine.py'),
  ])

  assert.match(projection, /package\.compat\.dify-workflow/)
  assert.match(projection, /DIFY_GRAPHON_BINDING_ID/)
  assert.match(compile, /DIFY_GRAPHON_COMMIT/)
  assert.match(compile, /"allowTools": False/)
  assert.match(sidecar, /GRAPHON_COMMIT = "b187ce7927fea1a7c137b642be3f78e3abb9f7de"/)
})
