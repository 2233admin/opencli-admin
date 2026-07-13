import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const readSource = (relativePath) => readFile(path.join(frontendRoot, relativePath), 'utf8')

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source section: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source section terminator: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('workflow IA is nested under studio and legacy canvas preserves its query', async () => {
  const [navigation, canvasPage, workflowPage, studioPage, rootPage] = await Promise.all([
    readSource('lib/navigation.ts'),
    readSource('app/(app)/canvas/page.tsx'),
    readSource('app/(app)/studio/workflow/page.tsx'),
    readSource('app/(app)/studio/page.tsx'),
    readSource('app/page.tsx'),
  ])

  assert.match(navigation, /href:\s*['"]\/studio['"][\s\S]{0,80}label:\s*['"]节点工作室['"]/) 
  assert.doesNotMatch(navigation, /href:\s*['"]\/canvas['"][\s\S]{0,80}label:\s*['"]节点工作流['"]/) 
  assert.match(navigation, /['"]\/studio\/workflow['"]:\s*['"]节点工作流['"]/) 
  assert.match(workflowPage, /<WorkflowEditorSession\s*\/>/)
  assert.match(studioPage, /router\.push\(`\/studio\/workflow\?workspace=/)
  assert.match(studioPage, /href=\{`\/studio\/workflow\?workspace=/)

  assert.match(canvasPage, /Object\.entries\(await searchParams\)/)
  assert.match(canvasPage, /query\.append\(key, item\)/)
  assert.match(canvasPage, /query\.set\(key, value\)/)
  assert.match(canvasPage, /redirect\(`\/studio\/workflow\$\{suffix \? `\?\$\{suffix\}` : ['"]['"]\}`\)/)

  assert.match(rootPage, /redirect\(['"]\/dashboard['"]\)/)
  assert.doesNotMatch(rootPage, /redirect\(['"]\/studio['"]\)/)
})

test('top-level package and inner primitive menus keep the right-click anchor contract', async () => {
  const [editor, surface, palette] = await Promise.all([
    readSource('components/flow/workflow-editor.tsx'),
    readSource('components/flow/workflow-canvas-surface.tsx'),
    readSource('components/flow/command-palette.tsx'),
  ])

  assert.match(editor, /const onPaneContextMenu/)
  assert.match(editor, /setPaletteAnchor\(\{ x: event\.clientX, y: event\.clientY \}\)/)
  assert.match(surface, /onPaneContextMenu=\{props\.onPaneContextMenu\}/)

  assert.match(palette, /getWorkflowNodeCatalog\(workflowProfile, capabilities\)\.filter\(\(item\) => item\.category === ['"]package['"]\)/)
  assert.match(palette, /inNodeNetwork \? getWorkflowPrimitives\(\) : \[\]/)
  assert.match(palette, /item\.category === ['"]annotation['"] \|\| item\.category === ['"]shape['"]/) 
  assert.match(palette, /groupPrimitivesForNodeMenu\(primitiveOperators\)/)
  assert.match(palette, /封包节点/)
  assert.match(palette, /内部节点 · 当前封包/)
})

test('default graph has four packages, recursive scoped lookup, and explicit hierarchy copy', async () => {
  const [pipeline, store, commandStrip] = await Promise.all([
    readSource('lib/workflow/collection-pipeline.ts'),
    readSource('lib/flow/store.ts'),
    readSource('components/flow/command-strip.tsx'),
  ])
  const packaged = sourceSection(
    pipeline,
    'export function buildPackagedWorkflowProject()',
    'export const PACKAGED_WORKFLOW_PROJECT',
  )

  for (const packageId of [
    'package.opencli.multi-source-hda',
    'package.intelligence.pipeline',
    'package.review.human-review',
    'package.dispatch.fanout',
  ]) {
    assert.match(packaged, new RegExp(packageId.replaceAll('.', '\\.')))
  }
  assert.match(packaged, /networkRole:\s*['"]package['"]/) 
  assert.match(store, /const initialWorkflowProject = PACKAGED_WORKFLOW_PROJECT/)
  assert.match(store, /function findProjectNodeByCanvasId[\s\S]*visit\(child, scopedInternalId\(scopedId, child\.id\)\)/)
  assert.match(store, /materializeProjectInternals\(projectNode, node, nodeId, ['"]network['"]\)/)

  for (const label of [
    '顶层封包网络',
    '封包内部网络',
    '双击封包进入内部',
    '添加和连接内部节点',
  ]) {
    assert.match(commandStrip, new RegExp(label))
  }
})

test('inner network edits are synchronized back into the workflow project before exit', async () => {
  const store = await readSource('lib/flow/store.ts')

  assert.match(store, /function persistNetworkInProject/)
  assert.match(store, /replaceProjectNodeByCanvasId\(project\.nodes, parentCanvasId/)
  assert.match(store, /nodes:\s*internalNodes,[\s\S]{0,80}edges:\s*internalEdges/)
  assert.match(store, /exitNodeNetwork:\s*\(\)\s*=>\s*\{\s*get\(\)\.persistActiveNetwork\(\)/)
  assert.match(store, /useFlowStore\.subscribe\(\(state, previousState\)/)
  assert.match(store, /state\.nodes === previousState\.nodes && state\.edges === previousState\.edges/)
  assert.match(store, /state\.persistActiveNetwork\(\)/)
})

test('package breadcrumb keeps full scoped GSAP Flip transitions', async () => {
  const overlays = await readSource('components/flow/workflow-editor-overlays.tsx')

  assert.match(overlays, /import \{ Flip \} from ["']gsap\/Flip["']/)
  assert.match(overlays, /gsap\.registerPlugin\(Flip\)/)
  assert.match(overlays, /Flip\.getState\(targets\)/)
  assert.match(overlays, /Flip\.from\(previousState\.current/)
  assert.match(overlays, /gsap\.context\([\s\S]*context\.revert\(\)/)
  assert.doesNotMatch(overlays, /prefers-reduced-motion: reduce/)
  assert.match(overlays, /data-network-flip-key=\{entry\.nodeId\}/)
})
