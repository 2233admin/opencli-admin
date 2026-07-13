import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const readSource = (relativePath) => readFile(path.join(frontendRoot, relativePath), 'utf8')
const importTypeScript = (relativePath) => import(pathToFileURL(path.join(frontendRoot, relativePath)).href)

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source section: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source section terminator: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('node workflow lives inside workspace while the legacy canvas route redirects', async () => {
  const [navigation, canvasPage, workspaceWorkflowPage, studioPage, rootPage] = await Promise.all([
    readSource('lib/navigation.ts'),
    readSource('app/(app)/canvas/page.tsx'),
    readSource('app/(app)/studio/workflow/page.tsx'),
    readSource('app/(app)/studio/page.tsx'),
    readSource('app/page.tsx'),
  ])

  for (const label of ['概览', '工作区', '采集来源', '运行与数据', '节点与 Worker']) {
    assert.match(navigation, new RegExp(`label:\\s*['"]${label}['"]`))
  }
  assert.doesNotMatch(navigation, /href:\s*['"]\/canvas['"][\s\S]{0,80}label:\s*['"]节点工作流['"]/) 
  assert.match(canvasPage, /redirect\(`\/studio\/workflow/)
  assert.match(workspaceWorkflowPage, /<WorkflowEditorSession\s*\/>/)
  assert.match(studioPage, /useMyWorkspaces[\s\S]*useWorkspaceProjects/)
  assert.match(studioPage, /router\.push\(`\/studio\/workflow\?workspace=/)
  assert.match(rootPage, /redirect\(['"]\/studio['"]\)/)
  assert.doesNotMatch(navigation, /BUILD_WORKFLOW_PATH|\/build\/workflow/)
})

test('workflow adopts the Dify-style add-node path while preserving package hierarchy', async () => {
  const [editor, surface, palette] = await Promise.all([
    readSource('components/flow/workflow-editor.tsx'),
    readSource('components/flow/workflow-canvas-surface.tsx'),
    readSource('components/flow/command-palette.tsx'),
  ])

  assert.match(editor, /const onPaneContextMenu/)
  assert.match(editor, /setPaletteAnchor\(\{ x: event\.clientX, y: event\.clientY \}\)/)
  assert.match(surface, /onPaneContextMenu=\{props\.onPaneContextMenu\}/)
  assert.match(palette, /item\.category === ["']package["']/)
  assert.match(palette, /inNodeNetwork \? getWorkflowPrimitives\(\) : \[\]/)
  assert.match(palette, /item\.category === ["']annotation["'] \|\| item\.category === ["']shape["']/)
  assert.match(palette, /封包节点/)
  assert.match(palette, /内部节点 · 当前封包/)
  assert.match(palette, /groupPrimitivesForNodeMenu\(primitiveOperators\)/)
  assert.match(palette, /group\.label/)
})

test('the default canvas is a package-only DOP network with recursive scoped lookup', async () => {
  const [pipeline, store, commandStrip, editor, settings] = await Promise.all([
    readSource('lib/workflow/collection-pipeline.ts'),
    readSource('lib/flow/store.ts'),
    readSource('components/flow/command-strip.tsx'),
    readSource('components/flow/workflow-editor.tsx'),
    readSource('lib/flow/settings-store.ts'),
  ])
  const packaged = sourceSection(pipeline, 'export function buildPackagedWorkflowProject()', 'export const PACKAGED_WORKFLOW_PROJECT')

  for (const packageId of ['package.opencli.multi-source-hda', 'package.intelligence.pipeline', 'package.review.human-review', 'package.dispatch.fanout']) {
    assert.match(packaged, new RegExp(packageId.replaceAll('.', '\\.')))
  }
  assert.match(packaged, /networkRole:\s*["']package["']/)
  assert.match(store, /const initialWorkflowProject = PACKAGED_WORKFLOW_PROJECT/)
  assert.match(store, /function findProjectNodeByCanvasId[\s\S]*scopedInternalId\(scopedId, child\.id\)/)
  assert.match(store, /materializeProjectInternals\(projectNode, node, nodeId, ["']network["']\)/)
  assert.match(commandStrip, /载入完整采集示例/)
  for (const hierarchyLabel of ['顶层封包网络', '封包内部网络', '双击封包进入内部', '添加和连接内部节点']) {
    assert.match(commandStrip, new RegExp(hierarchyLabel))
  }
  assert.match(editor, /useState\(false\)[\s\S]*setInspectorOpen\(true\)/)
  assert.match(settings, /showMiniMap:\s*false/)
})

test('editor selector remains shallow-stable for an unchanged store snapshot', async () => {
  const [{ selectEditorCanvasState }, editorSource] = await Promise.all([
    importTypeScript('components/flow/workflow-editor-selectors.ts'),
    readSource('components/flow/workflow-editor.tsx'),
  ])
  const values = new Map()
  const state = new Proxy({}, {
    get(_target, property) {
      if (!values.has(property)) values.set(property, typeof property === 'string' ? Symbol(property) : property)
      return values.get(property)
    },
  })

  const first = selectEditorCanvasState(state)
  const second = selectEditorCanvasState(state)
  assert.notStrictEqual(first, second, 'selector intentionally returns a projection object')
  assert.deepStrictEqual(first, second, 'projection values must retain stable identities for shallow comparison')
  assert.match(editorSource, /useFlowStore\(useShallow\(selectEditorCanvasState\)\)/)
})

test('inspector is driven only by the single selected node and never falls back to schedule', async () => {
  const inspector = await readSource('components/flow/inspector.tsx')

  assert.match(inspector, /const selected = nodes\.filter\(\(n\) => n\.selected\)/)
  assert.match(inspector, /if \(selected\.length !== 1\) return null/)
  assert.match(inspector, /const node = selected\[0\]/)
  assert.match(inspector, /workflowProject\.nodes\.find\(\(candidate\) => candidate\.id === node\.id\)/)
  assert.doesNotMatch(inspector, /fallback[\s\S]{0,80}schedule|schedule[\s\S]{0,80}fallback/i)
})

test('event and projection actions retain the node reducer contract', async () => {
  const store = await readSource('lib/flow/store.ts')
  const eventAction = sourceSection(store, 'applyWorkflowNodeRunEvent: (event) => {', 'applyWorkflowRunProjection: (projection) => {')
  const projectionAction = sourceSection(store, 'applyWorkflowRunProjection: (projection) => {', 'applyWorkflowEvidenceBatchProjection: (projection, batches) => {')
  const evidenceAction = sourceSection(store, 'applyWorkflowEvidenceBatchProjection: (projection, batches) => {', 'updateWorkflowProfile: (profile) => {')

  assert.match(eventAction, /runtimeNodeIdCandidates\(event\.nodeId, event\.packageNodeId, event\.internalNodeId\)/)
  assert.match(eventAction, /patchProjectNodeRunEvent\(node, event, runtimeRunState\)/)
  assert.match(eventAction, /nodes:\s*state\.nodes\.map/)
  assert.match(eventAction, /runtimeLatestEvent:\s*event/)

  assert.match(projectionAction, /runtimeStateByCanvasNodeId\(projection\)/)
  assert.match(projectionAction, /patchProjectNodeRunProjection\(node, stateByCanvasNodeId\)/)
  assert.match(projectionAction, /nodes:\s*state\.nodes\.map/)
  assert.match(projectionAction, /runId:\s*projection\.runId/)

  assert.match(evidenceAction, /applyEvidenceBatchRuntimePatches\(state\.nodes, state\.edges, projection, batches\)/)
})

test('EvidenceBatch projection produces stable node and edge view-models', async () => {
  const { applyEvidenceBatchRuntimePatches } = await importTypeScript('lib/workflow/runtime-bridge.ts')
  const sourceNode = { id: 'package-a', data: { label: 'Source', runtimePreview: {} } }
  const untouchedNode = { id: 'other', data: { label: 'Other' } }
  const sourceEdge = { id: 'edge-a', source: 'package-a', target: 'other', data: {} }
  const untouchedEdge = { id: 'edge-b', source: 'other', target: 'package-a', data: {} }
  const projection = {
    runId: 'run-1',
    traceId: 'trace-1',
    status: 'partial',
    nodes: [],
    clusters: [],
    missingSources: [{
      nodeId: 'package-a::source',
      sourceGroup: 'news',
      status: 'partial',
      reasons: [{ code: 'source_partial', message: 'one source pending', details: {} }],
    }],
    summaries: [],
    conflicts: [],
    artifacts: [],
  }
  const batches = [{
    runId: 'run-1',
    traceId: 'trace-1',
    nodeId: 'package-a::source',
    packageNodeId: 'package-a',
    internalNodeId: 'package-a::source',
    status: 'partial',
    batchId: 'batch-1',
    itemCount: 7,
    recordCount: 5,
    sourceGroup: 'news',
  }]

  const result = applyEvidenceBatchRuntimePatches(
    [sourceNode, untouchedNode],
    [sourceEdge, untouchedEdge],
    projection,
    batches,
  )

  assert.equal(result.nodes[0].data.status, 'running')
  assert.equal(result.nodes[0].data.runtimeEvidenceBatches[0].batchId, 'batch-1')
  assert.equal(result.nodes[0].data.runtimePreview.status, 'evidence-partial')
  assert.equal(result.nodes[0].data.runtimePreview.diagnostic, 'one source pending')
  assert.strictEqual(result.nodes[1], untouchedNode, 'unrelated nodes retain reference identity')

  assert.equal(result.edges[0].animated, true)
  assert.deepStrictEqual(result.edges[0].data.runtimeEvidenceBatch, {
    runId: 'run-1',
    status: 'partial',
    batchIds: ['batch-1'],
    itemCount: 7,
    recordCount: 5,
  })
  assert.strictEqual(result.edges[1], untouchedEdge, 'unrelated edges retain reference identity')
})

test('EvidenceBatch workbench consumes projection, list, selection, and detail state', async () => {
  const panel = await readSource('components/flow/run-trace-panel.tsx')
  const workbench = sourceSection(panel, 'function EvidenceBatchWorkbench(', 'function EvidenceBatchDetailCard(')

  assert.match(workbench, /aria-label="EvidenceBatch results"/)
  assert.match(workbench, /state\.projection/)
  assert.match(workbench, /const batches = state\.batches/)
  assert.match(workbench, /batches\.map/)
  assert.match(workbench, /onSelectBatch\(batch\.batchId\)/)
  assert.match(workbench, /state\.detail\s*\?\s*<EvidenceBatchDetailCard/)
})
