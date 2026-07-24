import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidates = []
    if (specifier.startsWith('@/')) candidates.push(path.join(frontendRoot, specifier.slice(2)))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      candidates.push(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier))
    }
    for (const candidate of candidates) {
      for (const resolvedPath of [candidate, `${candidate}.ts`, `${candidate}.tsx`]) {
        if (existsSync(resolvedPath)) return { url: pathToFileURL(resolvedPath).href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.ts') || url.endsWith('.tsx')) {
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
          mode: 'strip',
          sourceUrl: url,
        }),
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})

const readFrontendSource = (relativePath) => readFile(path.join(frontendRoot, relativePath), 'utf8')
const importTypeScript = (relativePath) => import(pathToFileURL(path.join(frontendRoot, relativePath)).href)

const backendCatalog = {
  version: 'opencli.node-capabilities.v1',
  authority: 'backend',
  nodes: [{
    id: 'workflow.native.template',
    label: 'Template Transform',
    description: 'Render a template with upstream data.',
    category: 'transform',
    origin: 'native',
    provider: 'opencli-core',
    source: 'backend.workflow.node_capability_catalog',
    readiness: 'runnable',
    runtimeBinding: 'workflow.native.template.v1',
    kind: 'agent',
    capability: 'normalize',
    icon: 'Braces',
    inputPorts: [{ name: 'input', type: 'object', required: true }],
    outputPorts: [{ name: 'output', type: 'string', required: true }],
    parameters: [{ name: 'template', label: 'Template', type: 'string', required: true, default: '{{ input }}', options: [] }],
    difyNodeTypes: ['template-transform'],
    missing: [],
  }],
  categories: [{ id: 'transform', label: '转换', count: 1 }],
  summary: { total: 1, byReadiness: { runnable: 1 }, byOrigin: { native: 1 } },
}

const composedNode = {
  ...backendCatalog.nodes[0],
  id: 'primitive.ai.question-classifier',
  label: 'Question Classifier',
  origin: 'composite',
  readiness: 'composed',
  runtimeBinding: null,
  missing: ['llm_classifier_composition'],
}

test('backend node catalog becomes the authoritative workflow catalog projection', async () => {
  const [{ mergeBackendNodeCapabilityCatalog }, nodeCatalog] = await Promise.all([
    importTypeScript('lib/workflow/backend-node-capability-adapter.ts'),
    importTypeScript('lib/workflow/node-catalog.ts'),
  ])
  const merged = mergeBackendNodeCapabilityCatalog(null, backendCatalog)
  const item = nodeCatalog.getWorkflowNodeCatalog('intelligence', merged)
    .find((candidate) => candidate.id === 'workflow.native.template')

  assert.ok(item)
  assert.equal(item.params.template, '{{ input }}')
  assert.equal(item.runtimeCapability.status, 'runnable')
  assert.equal(nodeCatalog.workflowCatalogIsBackendNode(item), true)
  assert.equal(
    nodeCatalog.getWorkflowNodeCatalog('intelligence', merged)
      .some((candidate) => candidate.id === 'intelligence.source.jin10'),
    false,
  )
  const projectNode = nodeCatalog.createWorkflowNodeFromCatalog(item, 'template-1', { x: 0, y: 0 })
  assert.deepEqual(projectNode.parameterInterface?.fields.map((field) => field.id), ['template'])
  assert.equal(projectNode.parameterInterface?.fields[0]?.binding.nodeId, 'template-1')
})

test('composed nodes remain preview-only until their runtime dependencies are verified', async () => {
  const [{ mergeBackendNodeCapabilityCatalog }, nodeCatalog] = await Promise.all([
    importTypeScript('lib/workflow/backend-node-capability-adapter.ts'),
    importTypeScript('lib/workflow/node-catalog.ts'),
  ])
  const catalog = {
    ...backendCatalog,
    nodes: [backendCatalog.nodes[0], composedNode],
    summary: {
      total: 2,
      byReadiness: { runnable: 1, composed: 1 },
      byOrigin: { native: 1, composite: 1 },
    },
  }
  const merged = mergeBackendNodeCapabilityCatalog(null, catalog)
  const projected = merged.catalog.find((item) => item.id === composedNode.id)
  const item = nodeCatalog.getWorkflowNodeCatalog('intelligence', merged)
    .find((candidate) => candidate.id === composedNode.id)

  assert.ok(projected)
  assert.equal(projected.status, 'preview_only')
  assert.equal(projected.backendAvailable, false)
  assert.equal(projected.manifest.nodeCatalog.readiness, 'composed')
  assert.equal(projected.manifest.canvas.locked, true)
  assert.ok(item)
  assert.equal(nodeCatalog.workflowCatalogItemLocked(item), true)
})

test('a runnable label without a verified runtime binding is blocked defensively', async () => {
  const { projectBackendNodeCapability } = await importTypeScript(
    'lib/workflow/backend-node-capability-adapter.ts',
  )
  const projected = projectBackendNodeCapability({
    ...backendCatalog.nodes[0],
    runtimeBinding: null,
  }, backendCatalog)

  assert.equal(projected.status, 'blocked')
  assert.equal(projected.backendAvailable, false)
  assert.deepEqual(projected.missing, ['runtime_binding_unverified'])
  assert.equal(projected.manifest.canvas.locked, true)
})

test('Plugin Center and Studio consume the same backend catalog projection', async () => {
  const [client, hook, page, palette] = await Promise.all([
    readFrontendSource('lib/plugins/backend-node-capabilities.ts'),
    readFrontendSource('lib/workflow/use-workflow-capabilities.ts'),
    readFrontendSource('app/(app)/plugins/page.tsx'),
    readFrontendSource('components/flow/command-palette.tsx'),
  ])

  assert.match(client, /\/api\/v1\/plugins\/capabilities/)
  assert.match(hook, /mergeBackendNodeCapabilityCatalog/)
  assert.match(page, /nodeCatalog\.summary\.total/)
  assert.match(page, /nodeCatalogCounts\.runnable/)
  assert.match(page, /return node\.runtimeReady/)
  assert.doesNotMatch(page, /node\.readiness === 'runnable' \|\| node\.readiness === 'composed'/)
  assert.match(page, /组合方案可预览，等待依赖就绪/)
  assert.match(page, /providerNodeViews/)
  assert.match(palette, /workflowCatalogIsBackendNode/)
  assert.match(palette, /插件与后端工具/)
})
