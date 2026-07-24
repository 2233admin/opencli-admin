import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
          mode: 'transform',
          sourceMap: true,
          sourceUrl: url,
        }),
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})

const importTypeScript = (relativePath) => import(pathToFileURL(path.join(frontendRoot, relativePath)).href)

test('record hygiene package keeps a locked canonical three-node cleaning pipeline', async () => {
  const catalog = await importTypeScript('lib/workflow/node-catalog.ts')
  const item = catalog.WORKFLOW_NODE_CATALOG.find((candidate) => candidate.id === catalog.RECORD_HYGIENE_PACKAGE_CATALOG_ID)

  assert.ok(item)
  assert.equal(item.category, 'package')
  assert.equal(item.internals.locked, true)
  assert.deepStrictEqual(item.internals.nodes.map((node) => node.id), ['normalize', 'dedupe', 'record-acceptance'])
  assert.deepStrictEqual(
    item.internals.edges.map((edge) => [edge.source, edge.sourcePort, edge.target, edge.targetPort]),
    [
      ['normalize', 'out', 'dedupe', 'in'],
      ['dedupe', 'out', 'record-acceptance', 'candidates'],
    ],
  )
  assert.deepStrictEqual(item.internals.nodes.map((node) => node.ui.catalogId), [
    'intelligence.processing.normalize',
    'intelligence.processing.dedupe',
    'intelligence.control.record-acceptance',
  ])
})

test('catalog creation promotes package parameters onto the exact internal nodes', async () => {
  const catalog = await importTypeScript('lib/workflow/node-catalog.ts')
  const item = catalog.WORKFLOW_NODE_CATALOG.find((candidate) => candidate.id === catalog.RECORD_HYGIENE_PACKAGE_CATALOG_ID)
  const node = catalog.createWorkflowNodeFromCatalog(item, 'hygiene', { x: 0, y: 0 })
  const fields = Object.fromEntries(node.parameterInterface.fields.map((field) => [field.id, field]))

  assert.equal(fields['normalize.language'].binding.nodeId, 'hygiene__normalize')
  assert.equal(fields['normalize.preserveSourceRefs'].value, true)
  assert.equal(fields['dedupe.key'].binding.nodeId, 'hygiene__dedupe')
  assert.equal(fields['dedupe.window'].value, '24h')
  assert.equal(fields['record-acceptance.mode'].binding.nodeId, 'hygiene__record-acceptance')
  assert.equal(fields['record-acceptance.schema'].value, 'record.v1')
  assert.equal(fields['record-acceptance.lineageRequired'].value, true)
  assert.equal(fields['record-acceptance.minQuality'].value, 0)
})

test('record hygiene descriptions state annotation and batch-only dedupe semantics', async () => {
  const [catalog, contracts, internalsModule] = await Promise.all([
    importTypeScript('lib/workflow/node-catalog.ts'),
    importTypeScript('lib/workflow/node-contracts.ts'),
    importTypeScript('lib/workflow/node-internals.ts'),
  ])
  const normalizeItem = catalog.WORKFLOW_NODE_CATALOG.find((item) => item.id === 'intelligence.processing.normalize')
  const normalizeInternals = internalsModule.getNodeInternals({
    kind: 'agent',
    capability: 'normalize',
    params: {},
  })
  const dedupeInternals = internalsModule.getNodeInternals({
    kind: 'agent',
    capability: 'dedupe',
    params: {},
  })

  assert.match(normalizeItem.description, /语言标注/)
  assert.match(normalizeItem.description, /不翻译内容/)
  assert.equal(normalizeInternals.steps.find((step) => step.id === 'language').label, 'Language annotation')
  assert.match(normalizeInternals.steps.find((step) => step.id === 'language').description, /does not translate content/)
  assert.match(contracts.getNodeContract({ ui: { catalogId: 'intelligence.processing.normalize' } }).params.find((parameter) => parameter.id === 'language').description, /not translated/)
  assert.match(contracts.getNodeContract({ ui: { catalogId: 'package.processing.record-hygiene' } }).params.find((parameter) => parameter.id === 'language').description, /not translated/)
  assert.equal(dedupeInternals.steps.find((step) => step.id === 'window').label, 'Batch window comparison')
  assert.match(dedupeInternals.steps.find((step) => step.id === 'window').description, /current input batch/)
  assert.match(dedupeInternals.steps.find((step) => step.id === 'window').description, /does not persist cross-run state/)
})

test('atomic nodes remain searchable and retain compatible typed ports', async () => {
  const [catalog, contracts] = await Promise.all([
    importTypeScript('lib/workflow/node-catalog.ts'),
    importTypeScript('lib/workflow/node-contracts.ts'),
  ])
  const atomicIds = [
    'intelligence.processing.normalize',
    'intelligence.processing.dedupe',
    'intelligence.control.record-acceptance',
  ]
  for (const id of atomicIds) {
    const item = catalog.WORKFLOW_NODE_CATALOG.find((candidate) => candidate.id === id)
    assert.ok(item)
    assert.ok(catalog.createWorkflowNodeFromCatalog(item, `atom-${item.idPrefix}`, { x: 0, y: 0 }).parameterInterface)
  }

  const packageItem = catalog.WORKFLOW_NODE_CATALOG.find((item) => item.id === catalog.RECORD_HYGIENE_PACKAGE_CATALOG_ID)
  const [normalize, dedupe, acceptance] = packageItem.internals.nodes
  assert.deepStrictEqual(contracts.getNodeContract(normalize).ports.map((port) => [port.id, port.type]), [
    ['in', 'items[]'],
    ['out', 'recordCandidate[]'],
  ])
  assert.deepStrictEqual(contracts.getNodeContract(dedupe).ports.map((port) => [port.id, port.type]), [
    ['in', 'recordCandidate[]'],
    ['out', 'recordCandidate[]'],
  ])
  assert.deepStrictEqual(contracts.getNodeContract(acceptance).ports.map((port) => [port.id, port.type]), [
    ['candidates', 'recordCandidate[]'],
    ['records', 'record[]'],
  ])
})

test('dedupe REAL state is projected only from backend runtime capability', async () => {
  const catalog = await importTypeScript('lib/workflow/node-catalog.ts')
  const staticDedupe = catalog.WORKFLOW_NODE_CATALOG.find((item) => item.id === 'intelligence.processing.dedupe')
  assert.equal(staticDedupe.runtimeCapability, undefined)

  const capabilities = {
    version: 'test',
    catalog: [{
      id: 'intelligence.processing.dedupe',
      label: 'Dedupe Items',
      kind: 'agent',
      capability: 'dedupe',
      provider: 'opencli-core',
      source: 'backend.workflow.runtime_registry',
      status: 'runnable',
      backendAvailable: true,
      runtimeBinding: 'workflow.native.dedupe.v1',
      reason: null,
      manifest: { nodeCatalog: { authority: 'backend', readiness: 'runnable' }, canvas: { node: true, locked: false } },
      requiredAdapterIds: [],
      missingAdapterIds: [],
      tags: ['node-capability'],
    }],
  }
  const projected = catalog.getWorkflowNodeCatalog('intelligence', capabilities)
    .find((item) => item.id === 'intelligence.processing.dedupe')
  assert.equal(projected.runtimeCapability.status, 'runnable')
  assert.equal(projected.runtimeCapability.backendAvailable, true)
})
