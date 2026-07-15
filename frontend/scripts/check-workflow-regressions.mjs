import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'dagre') return { url: 'dagre:test-stub', shortCircuit: true }
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
    if (url === 'dagre:test-stub') {
      return {
        format: 'module',
        source: 'export default { graphlib: { Graph: class Graph {} }, layout() {} }',
        shortCircuit: true,
      }
    }
    if (url.endsWith('.ts') || url.endsWith('.tsx')) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), {
        mode: 'transform',
        sourceMap: true,
        sourceUrl: url,
      })
      return { format: 'module', source, shortCircuit: true }
    }
    if (url.endsWith('.json')) {
      const json = readFileSync(fileURLToPath(url), 'utf8')
      return { format: 'module', source: `export default ${json}`, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

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

  for (const label of ['概览', '工作区', '自动化', '工作项', '执行资源']) {
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

test('agent-created project specs convert into the canonical persisted workflow model', async () => {
  const [{ generateWorkflowLocally }, { generatedSpecToWorkflowProject }] = await Promise.all([
    importTypeScript('lib/flow/local-generate.ts'),
    importTypeScript('lib/workflow/generated-project.ts'),
  ])
  const spec = generateWorkflowLocally('每天抓取多个网站，摘要后发送通知')
  const project = generatedSpecToWorkflowProject(spec, 'Agent 创建的项目')

  assert.equal(project.name, 'Agent 创建的项目')
  assert.equal(project.nodes.length, spec.nodes.length)
  assert.equal(project.edges.length, spec.edges.length)
  assert.equal(project.nodes[0].capability, 'trigger')
  assert.ok(project.edges.every((edge) => project.nodes.some((node) => node.id === edge.source) && project.nodes.some((node) => node.id === edge.target)))
})

test('agent-created monitoring projects persist the P0 email delivery target', async () => {
  const [{ generateWorkflowLocally }, { generatedSpecToWorkflowProject }] = await Promise.all([
    importTypeScript('lib/flow/local-generate.ts'),
    importTypeScript('lib/workflow/generated-project.ts'),
  ])
  const spec = generateWorkflowLocally('每天抓取多个网站并生成摘要')
  const project = generatedSpecToWorkflowProject(spec, '邮件监测项目', { deliveryEmail: 'brief@example.com' })
  const emailNode = project.nodes.find((node) => node.kind === 'notify')

  assert.ok(emailNode)
  assert.equal(emailNode.params.channel, 'email')
  assert.deepEqual(emailNode.params.to, ['brief@example.com'])
  assert.ok(project.edges.some((edge) => edge.target === emailNode.id))
})

test('the production studio adopts the selected project-workspace concept with real data', async () => {
  const [studio, workflowPage, projectHeader] = await Promise.all([
    readSource('app/(app)/studio/page.tsx'),
    readSource('app/(app)/studio/workflow/page.tsx'),
    readSource('components/studio/workflow-project-header.tsx'),
  ])

  assert.match(studio, /useMyWorkspaces\(\)/)
  assert.match(studio, /useWorkspaceProjects\(workspaceId\)/)
  assert.match(studio, /title="项目"/)
  assert.match(studio, /get\('create'\) === 'workflow'/)
  assert.match(studio, /setCreateTemplate\('collection-to-consumption'\)/)
  assert.match(studio, /aria-label="项目浏览工具栏"/)
  assert.match(studio, /aria-label="项目类型筛选"/)
  assert.match(studio, /\{visibleProjects\.length\} 个项目/)
  assert.match(studio, /project\.updated_at/)
  assert.match(studio, /\/studio\/workflow\?workspace=\$\{workspaceId\}&project=\$\{project\.id\}/)
  assert.doesNotMatch(studio, /ProductShellPrototype|PrototypeNotice|workspaceProjects|forceStandalone/)
  assert.match(workflowPage, /<WorkflowProjectHeader\s*\/>/)
  assert.match(workflowPage, /<WorkflowEditorSession\s*\/>/)
  assert.match(projectHeader, /useWorkspaceProjects\(workspaceId\)/)
  assert.match(projectHeader, /useProjectWorkflows\(workspaceId, projectId\)/)
  assert.match(projectHeader, /`\/studio\?workspace=\$\{workspaceId\}`/)
  assert.match(projectHeader, /aria-label="项目生命周期"/)
  assert.match(projectHeader, /aria-label="选择工作流"/)
  assert.match(projectHeader, /正式节点系统/)
  assert.doesNotMatch(projectHeader, /PrototypeNotice|forceStandalone|comparisonProfiles/)
})

test('the product-shell prototype reuses the canonical editor without project draft mutations', async () => {
  const [prototype, session] = await Promise.all([
    readSource('components/prototype/product-shell-prototype.tsx'),
    readSource('components/flow/workflow-editor-session.tsx'),
  ])

  assert.ok(prototype.includes('<WorkflowEditorSession forceStandalone />'))
  assert.ok(session.includes('forceStandalone?: boolean'))
  assert.ok(session.includes("const workspaceId = forceStandalone ? null : params.get('workspace')"))
  assert.ok(session.includes("const projectId = forceStandalone ? null : params.get('project')"))
  for (const duplicatePrototypeModel of ['bindingOptions', 'bindingSelections', 'DataDebugDock', 'NodeInspector']) {
    assert.ok(!prototype.includes(duplicatePrototypeModel), `${duplicatePrototypeModel} must not return to Direction C`)
  }
})

test('workflow validation waits for the runtime capability catalog', async () => {
  const [capabilitiesHook, session] = await Promise.all([
    readSource('lib/workflow/use-workflow-capabilities.ts'),
    readSource('components/flow/workflow-editor-session.tsx'),
  ])

  assert.match(capabilitiesHook, /return \{ capabilities, error, loading \}/)
  assert.match(session, /const \{ error: capabilityError, loading: capabilityLoading \} = useWorkflowCapabilities\(true\)/)
  assert.match(session, /if \(capabilityLoading\) \{[\s\S]*运行能力目录仍在加载/)
  assert.match(session, /disabled=\{capabilityLoading \|\| Boolean\(capabilityError\)/)
  assert.match(session, /capabilityLoading \? '正在加载运行能力目录'/)
})

test('workflow adopts the Dify-style add-node path while preserving the four-layer hierarchy', async () => {
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
  assert.match(palette, /一级业务节点 · Dify 风格/)
  assert.match(palette, /L\{nodeDepth\} · \{nodeLayer\.label\}/)
  assert.match(palette, /groupPrimitivesForNodeMenu\(primitiveOperators\)/)
  assert.match(palette, /group\.label/)
})

test('the default canvas is an operator network with recursive four-layer lookup', async () => {
  const [pipeline, store, commandStrip, editor, settings, hierarchy] = await Promise.all([
    readSource('lib/workflow/collection-pipeline.ts'),
    readSource('lib/flow/store.ts'),
    readSource('components/flow/command-strip.tsx'),
    readSource('components/flow/workflow-editor.tsx'),
    readSource('lib/flow/settings-store.ts'),
    readSource('lib/workflow/node-hierarchy.ts'),
  ])
  const packaged = sourceSection(pipeline, 'export function buildPackagedWorkflowProject()', 'export const PACKAGED_WORKFLOW_PROJECT')

  for (const packageId of ['package.opencli.multi-source-hda', 'package.intelligence.pipeline', 'package.review.human-review', 'package.dispatch.fanout']) {
    assert.match(packaged, new RegExp(packageId.replaceAll('.', '\\.')))
  }
  assert.match(packaged, /createOperatorNodeFromCatalog/)
  for (const operatorId of ['source-operator', 'intelligence-operator', 'review-operator', 'dispatch-operator']) {
    assert.match(packaged, new RegExp(operatorId))
  }
  assert.match(store, /const initialWorkflowProject = PACKAGED_WORKFLOW_PROJECT/)
  assert.match(store, /function findProjectNodeByCanvasId[\s\S]*scopedInternalId\(scopedId, child\.id\)/)
  assert.match(store, /materializeProjectInternals\(projectNode, node, nodeId, ["']network["']\)/)
  assert.match(store, /networkStack\.length >= MAX_WORKFLOW_NODE_DEPTH - 1/)
  assert.match(commandStrip, /载入完整采集示例/)
  for (const hierarchyLabel of ['业务节点', '实现节点', '组件节点', '原子节点']) {
    assert.match(hierarchy, new RegExp(hierarchyLabel))
  }
  for (const hierarchyLabel of ['workflowNodeDepthFromNetworkStack', 'workflowNodeLayerAtDepth']) {
    assert.match(commandStrip, new RegExp(hierarchyLabel))
  }
  assert.match(editor, /useState\(false\)[\s\S]*setInspectorOpen\(true\)/)
  assert.match(settings, /showMiniMap:\s*false/)
})

test('the actual packaged default project satisfies backend node and typed-port contracts', async () => {
  const { PACKAGED_WORKFLOW_PROJECT } = await importTypeScript('lib/workflow/collection-pipeline.ts')
  const repositoryRoot = path.resolve(frontendRoot, '..')
  const windowsRepositoryPython = path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe')
  const unixRepositoryPython = path.join(repositoryRoot, '.venv', 'bin', 'python')
  const pythonExecutable = existsSync(windowsRepositoryPython)
    ? windowsRepositoryPython
    : (process.env.PYTHON ?? (existsSync(unixRepositoryPython) ? unixRepositoryPython : 'python'))
  const sourceOperator = PACKAGED_WORKFLOW_PROJECT.nodes.find((node) => node.id === 'source-operator')
  const sourcePackage = sourceOperator?.internals?.nodes.find((node) => node.id === 'source-package')

  assert.ok(sourcePackage, 'the OpenCLI implementation node must remain under the source operator')
  assert.doesNotMatch(JSON.stringify(sourcePackage.params), /maxConcurrency/)
  assert.deepStrictEqual(
    sourcePackage.internals.edges.map(({ source, target, sourcePort, targetPort }) => ({
      source,
      target,
      sourcePort,
      targetPort,
    })),
    [
      { source: 'source-pool', target: 'source-bilibili', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-pool', target: 'source-xiaohongshu', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-bilibili', target: 'internal-normalize', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-xiaohongshu', target: 'internal-normalize', sourcePort: 'out', targetPort: 'in' },
      { source: 'internal-normalize', target: 'collection-output', sourcePort: 'out', targetPort: 'in' },
    ],
  )

  const backendCheck = spawnSync(pythonExecutable, ['-c', [
    'import json, sys',
    'from backend.schemas.workflow import WorkflowProject',
    'from backend.workflow.compiler import compile_workflow_project',
    'project = WorkflowProject.model_validate(json.load(sys.stdin))',
    'result = compile_workflow_project(project)',
    'print(result.model_dump_json())',
    'raise SystemExit(0 if result.valid else 1)',
  ].join('; ')], {
    cwd: repositoryRoot,
    input: JSON.stringify(PACKAGED_WORKFLOW_PROJECT),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })

  assert.equal(backendCheck.status, 0, `${backendCheck.stdout}\n${backendCheck.stderr}`)
  assert.equal(JSON.parse(backendCheck.stdout).valid, true)
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

  assert.match(eventAction, /runtimeNodeIdCandidates\(event\.nodeId, event\.packageNodeId, event\.internalNodeId, event\.nodePath\)/)
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

test('L2-L4 network edits persist in the canonical workflow graph across scope re-entry', async () => {
  const [canonical, store, slices] = await Promise.all([
    importTypeScript('lib/flow/store-canonical-actions.ts'),
    readSource('lib/flow/store.ts'),
    readSource('lib/flow/store-slices.ts'),
  ])
  const node = (id, internals) => ({
    id,
    kind: 'agent',
    capability: 'normalize',
    params: {},
    ...(internals ? { internals } : {}),
  })
  const project = {
    id: 'nested-edit-regression',
    name: 'Nested edit regression',
    profile: 'intelligence',
    version: 1,
    nodes: [node('l1', {
      locked: false,
      nodes: [node('l2-parent', {
        locked: false,
        nodes: [node('l3-parent', {
          locked: false,
          nodes: [node('l4-existing')],
          edges: [],
        })],
        edges: [],
      })],
      edges: [],
    })],
    edges: [],
    settings: { timezone: 'Asia/Shanghai', deterministicSimulation: true, maxItemsPerRun: 20 },
    adapters: [],
    agentPermissions: {
      canFetchNetwork: false,
      canSendNotifications: false,
      canWriteInbox: true,
      allowedDomains: [],
    },
  }

  const scopes = [
    { parent: 'l1', existing: 'l2-parent', added: 'l2-added', canvas: 'l1__l2-added', expected: { x: 40, y: 60 } },
    { parent: 'l1__l2-parent', existing: 'l3-parent', added: 'l3-added', canvas: 'l1__l2-parent__l3-added', expected: { x: 80, y: 100 } },
    { parent: 'l1__l2-parent__l3-parent', existing: 'l4-existing', added: 'l4-added', canvas: 'l1__l2-parent__l3-parent__l4-added', expected: { x: 120, y: 140 } },
  ]

  let edited = project
  for (const [index, scope] of scopes.entries()) {
    edited = canonical.appendCanonicalNetworkNode(edited, scope.parent, node(scope.added))
    edited = canonical.appendCanonicalNetworkEdge(edited, scope.parent, {
      id: `edge-${index + 2}`,
      source: scope.existing,
      target: scope.added,
    })
    edited = canonical.updateCanonicalProjectNodeByCanvasId(edited, scope.canvas, (current) => ({
      ...current,
      params: { editedAtLayer: index + 2 },
    }))
    edited = canonical.syncCanonicalNetworkNodePositions(edited, scope.parent, [{
      id: scope.canvas,
      position: {
        x: canonical.NETWORK_CANVAS_ORIGIN.x + scope.expected.x,
        y: canonical.NETWORK_CANVAS_ORIGIN.y + scope.expected.y,
      },
    }])
  }

  for (const [index, scope] of scopes.entries()) {
    const firstEntry = canonical.readCanonicalNetworkScope(edited, scope.parent)
    const reEntry = canonical.readCanonicalNetworkScope(edited, scope.parent)
    const added = reEntry.nodes.find((candidate) => candidate.id === scope.added)
    assert.deepStrictEqual(reEntry, firstEntry, `L${index + 2} canonical scope survives exit/re-entry`)
    assert.equal(added.params.editedAtLayer, index + 2)
    assert.deepStrictEqual(added.ui.position, scope.expected)
    assert.ok(reEntry.edges.some((edge) => edge.source === scope.existing && edge.target === scope.added))
  }

  edited = canonical.appendCanonicalNetworkNode(edited, scopes[2].parent, node('l4-delete-me'))
  edited = canonical.appendCanonicalNetworkEdge(edited, scopes[2].parent, {
    id: 'edge-delete-me',
    source: 'l4-existing',
    target: 'l4-delete-me',
  })
  edited = canonical.removeCanonicalNetworkItems(
    edited,
    scopes[2].parent,
    new Set(['l4-delete-me']),
    new Set(),
  )
  const finalL4 = canonical.readCanonicalNetworkScope(edited, scopes[2].parent)
  assert.ok(!finalL4.nodes.some((candidate) => candidate.id === 'l4-delete-me'))
  assert.ok(!finalL4.edges.some((edge) => edge.id === 'edge-delete-me'))

  for (const canonicalWrite of [
    'appendCanonicalNetworkNode',
    'updateCanonicalProjectNodeByCanvasId',
    'appendCanonicalNetworkEdge',
    'removeCanonicalNetworkItems',
    'syncCanonicalNetworkNodePositions',
  ]) {
    assert.ok(store.includes(canonicalWrite) || slices.includes(canonicalWrite), `${canonicalWrite} must be wired into the store`)
  }
  assert.match(store, /exitNodeNetwork:[\s\S]*previous\.snapshot\.nodes/)
  assert.match(store, /enterNodeNetwork:[\s\S]*materializeProjectInternals\(projectNode/)
})

function workflowProjectFixture(nodes, edges = []) {
  return {
    id: 'store-regression',
    name: 'Store regression',
    profile: 'intelligence',
    version: 1,
    nodes,
    edges,
    settings: { timezone: 'Asia/Shanghai', deterministicSimulation: true, maxItemsPerRun: 20 },
    adapters: [],
    agentPermissions: {
      canFetchNetwork: false,
      canSendNotifications: false,
      canWriteInbox: true,
      allowedDomains: [],
    },
  }
}

function canonicalTestNode(id, options = {}) {
  return {
    id,
    kind: 'agent',
    capability: 'normalize',
    params: {},
    ui: { label: id, position: { x: 0, y: 0 }, ...(options.ui ?? {}) },
    ...(options.internals ? { internals: options.internals } : {}),
    ...(options.parameterInterface ? { parameterInterface: options.parameterInterface } : {}),
  }
}

function canonicalNodeAtPath(project, pathIds) {
  let nodes = project.nodes
  let current
  for (const id of pathIds) {
    current = nodes.find((node) => node.id === id)
    assert.ok(current, `missing canonical node path segment: ${id}`)
    nodes = current.internals?.nodes ?? []
  }
  return current
}

function publicParameterInterface(childId) {
  return {
    groups: [{ id: 'general', label: 'General' }],
    fields: [{
      id: 'public-value',
      label: 'Public value',
      groupId: 'general',
      type: 'text',
      binding: { nodeId: childId, source: 'params', fieldId: 'value' },
      value: 'before',
    }],
  }
}

test('actual store actions keep root and nested canonical graphs undoable', async () => {
  const [{ useFlowStore }, { readCanonicalNetworkScope }] = await Promise.all([
    importTypeScript('lib/flow/store.ts'),
    importTypeScript('lib/flow/store-canonical-actions.ts'),
  ])
  const rootProject = workflowProjectFixture([
    canonicalTestNode('root-a'),
    canonicalTestNode('root-b', { ui: { position: { x: 260, y: 0 } } }),
  ])
  useFlowStore.getState().importWorkflowProject(rootProject)

  useFlowStore.getState().onConnect({ source: 'root-a', target: 'root-b', sourceHandle: null, targetHandle: null })
  let current = useFlowStore.getState()
  assert.equal(current.workflowProject.edges.length, 1, 'root connect persists to the canonical graph')

  current.onNodesChange([{ type: 'position', id: 'root-a', position: { x: 80, y: 120 }, dragging: false }])
  current = useFlowStore.getState()
  assert.deepStrictEqual(current.workflowProject.nodes.find((node) => node.id === 'root-a').ui.position, { x: 80, y: 120 })

  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({ ...node, selected: node.id === 'root-b' })),
  }))
  useFlowStore.getState().deleteSelected()
  current = useFlowStore.getState()
  assert.ok(!current.workflowProject.nodes.some((node) => node.id === 'root-b'))
  assert.equal(current.workflowProject.edges.length, 0, 'deleting a root node removes canonical incident edges')

  const nestedProject = workflowProjectFixture([
    canonicalTestNode('l1', {
      internals: {
        locked: false,
        nodes: [canonicalTestNode('l2')],
        edges: [],
      },
    }),
  ])
  current.importWorkflowProject(nestedProject)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1'), 1)
  useFlowStore.getState().takeSnapshot()
  useFlowStore.getState().onNodesChange([{
    type: 'position',
    id: 'l1__l2',
    position: { x: 600, y: 200 },
    dragging: false,
  }])
  current = useFlowStore.getState()
  assert.deepStrictEqual(readCanonicalNetworkScope(current.workflowProject, 'l1').nodes[0].ui.position, { x: 80, y: 120 })
  current.undo()
  current = useFlowStore.getState()
  assert.deepStrictEqual(readCanonicalNetworkScope(current.workflowProject, 'l1').nodes[0].ui.position, { x: 0, y: 0 })
  assert.deepStrictEqual(current.networkStack.map((entry) => entry.nodeId), ['l1'])
})

test('L2 and L3 primitive edits persist compiler-recognized primitive origins', async () => {
  const [{ useFlowStore }, { getWorkflowPrimitives }, { readCanonicalNetworkScope }, registrySource] = await Promise.all([
    importTypeScript('lib/flow/store.ts'),
    importTypeScript('lib/workflow/node-primitives.ts'),
    importTypeScript('lib/flow/store-canonical-actions.ts'),
    readFile(path.join(frontendRoot, '..', 'backend', 'workflow', 'node_registry.py'), 'utf8'),
  ])
  const project = workflowProjectFixture([
    canonicalTestNode('l1', {
      internals: {
        locked: false,
        nodes: [canonicalTestNode('l2-parent', {
          internals: {
            locked: false,
            nodes: [canonicalTestNode('l3-existing')],
            edges: [],
          },
        })],
        edges: [],
      },
    }),
  ])
  const primitive = getWorkflowPrimitives()[0]
  useFlowStore.getState().importWorkflowProject(project)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1'), 1)
  useFlowStore.getState().addPrimitiveNode(primitive, { x: 760, y: 220 })
  let current = useFlowStore.getState()
  const l2Added = readCanonicalNetworkScope(current.workflowProject, 'l1').nodes.find(
    (node) => node.ui?.primitiveId === primitive.id,
  )
  assert.ok(l2Added, 'L2 primitive is persisted canonically')
  assert.equal(l2Added.ui.catalogId, primitive.id, 'catalogId remains as a frontend compatibility hint')

  assert.equal(current.enterNodeNetwork('l1__l2-parent'), 1)
  useFlowStore.getState().addPrimitiveNode(primitive, { x: 720, y: 180 })
  current = useFlowStore.getState()
  const l3Added = readCanonicalNetworkScope(current.workflowProject, 'l1__l2-parent').nodes.find(
    (node) => node.ui?.primitiveId === primitive.id,
  )
  assert.ok(l3Added, 'L3 primitive is persisted canonically')
  const stackBeforeLeafDive = current.networkStack.map((entry) => entry.nodeId)
  assert.equal(current.enterNodeNetwork(`l1__l2-parent__${l3Added.id}`), 0)
  assert.deepStrictEqual(
    useFlowStore.getState().networkStack.map((entry) => entry.nodeId),
    stackBeforeLeafDive,
    'a leaf without internals does not enter an empty scope',
  )
  assert.match(registrySource, new RegExp(`['"]${primitive.id.replaceAll('.', '\\.') }['"]`))
  assert.match(registrySource, /if primitive_id in WORKFLOW_PRIMITIVE_IDS:/)
})

test('duplicate, cut, and paste clone the active canonical scope while visual Add Child is inert', async () => {
  const [{ useFlowStore }, { readCanonicalNetworkScope }] = await Promise.all([
    importTypeScript('lib/flow/store.ts'),
    importTypeScript('lib/flow/store-canonical-actions.ts'),
  ])
  const nestedProject = workflowProjectFixture([
    canonicalTestNode('l1', {
      internals: {
        locked: false,
        nodes: [canonicalTestNode('left'), canonicalTestNode('right', { ui: { position: { x: 260, y: 0 } } })],
        edges: [{ id: 'nested-edge', source: 'left', target: 'right' }],
      },
    }),
  ])
  useFlowStore.getState().importWorkflowProject(nestedProject)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1'), 2)
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({ ...node, selected: true })),
    edges: [{
      id: 'e-l1__nested-edge',
      source: 'l1__left',
      target: 'l1__right',
      type: 'workflow',
      data: { internalOf: 'l1', internalEdgeId: 'nested-edge' },
    }],
  }))
  const beforeInsert = JSON.stringify({
    project: useFlowStore.getState().workflowProject,
    nodes: useFlowStore.getState().nodes,
    edges: useFlowStore.getState().edges,
  })
  useFlowStore.getState().insertNodeOnEdge('e-l1__nested-edge')
  assert.equal(JSON.stringify({
    project: useFlowStore.getState().workflowProject,
    nodes: useFlowStore.getState().nodes,
    edges: useFlowStore.getState().edges,
  }), beforeInsert, 'canvas-only edge insertion is disabled')
  useFlowStore.getState().duplicateSelected()
  let current = useFlowStore.getState()
  let nestedScope = readCanonicalNetworkScope(current.workflowProject, 'l1')
  assert.equal(nestedScope.nodes.length, 4, 'nested duplicate writes canonical child nodes')
  assert.equal(nestedScope.edges.length, 2, 'nested duplicate writes the canonical internal edge')
  assert.equal(current.nodes.length, 4)
  assert.equal(current.edges.length, 2)

  const rootProject = workflowProjectFixture([
    canonicalTestNode('only-root'),
    canonicalTestNode('root-anchor', { ui: { position: { x: 320, y: 0 } } }),
  ])
  current.importWorkflowProject(rootProject)
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({ ...node, selected: node.id === 'only-root' })),
  }))
  useFlowStore.getState().cut()
  assert.ok(
    !useFlowStore.getState().workflowProject.nodes.some((node) => node.id === 'only-root'),
    'cut removes the canonical source',
  )
  useFlowStore.getState().paste()
  current = useFlowStore.getState()
  assert.equal(current.workflowProject.nodes.length, 2, 'paste restores a new canonical root node')
  assert.equal(current.nodes.length, 2)
  assert.ok(current.workflowProject.nodes.some((node) => node.id !== 'root-anchor' && node.id !== 'only-root'))

  const beforeAddChild = JSON.stringify({
    project: current.workflowProject,
    nodes: current.nodes,
    edges: current.edges,
    historyLength: current.past.length,
  })
  current.addChildNode(current.nodes[0].id)
  const afterAddChild = useFlowStore.getState()
  assert.equal(JSON.stringify({
    project: afterAddChild.workflowProject,
    nodes: afterAddChild.nodes,
    edges: afterAddChild.edges,
    historyLength: afterAddChild.past.length,
  }), beforeAddChild, 'visual Add Child cannot create a second non-canonical hierarchy')
})

test('canonical paste rejects a subtree that would exceed the four-level boundary', async () => {
  const { useFlowStore } = await importTypeScript('lib/flow/store.ts')
  const sourceProject = workflowProjectFixture([
    canonicalTestNode('copied-root', {
      internals: { locked: false, nodes: [canonicalTestNode('copied-child')], edges: [] },
    }),
  ])
  useFlowStore.getState().importWorkflowProject(sourceProject)
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => ({ ...node, selected: node.id === 'copied-root' })),
  }))
  useFlowStore.getState().copy()

  const destinationProject = workflowProjectFixture([
    canonicalTestNode('l1', { internals: { locked: false, nodes: [
      canonicalTestNode('l2', { internals: { locked: false, nodes: [
        canonicalTestNode('l3', { internals: { locked: false, nodes: [canonicalTestNode('l4')], edges: [] } }),
      ], edges: [] } }),
    ], edges: [] } }),
  ])
  useFlowStore.getState().importWorkflowProject(destinationProject)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1'), 1)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1__l2'), 1)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1__l2__l3'), 1)
  const beforePaste = JSON.stringify({
    project: useFlowStore.getState().workflowProject,
    nodes: useFlowStore.getState().nodes,
    edges: useFlowStore.getState().edges,
    historyLength: useFlowStore.getState().past.length,
  })
  useFlowStore.getState().paste()
  assert.equal(JSON.stringify({
    project: useFlowStore.getState().workflowProject,
    nodes: useFlowStore.getState().nodes,
    edges: useFlowStore.getState().edges,
    historyLength: useFlowStore.getState().past.length,
  }), beforePaste)
})

test('fallback internals migrate only on an explicit edit and survive scope re-entry', async () => {
  const [{ useFlowStore }, { getWorkflowPrimitives }, { readCanonicalNetworkScope }] = await Promise.all([
    importTypeScript('lib/flow/store.ts'),
    importTypeScript('lib/workflow/node-primitives.ts'),
    importTypeScript('lib/flow/store-canonical-actions.ts'),
  ])
  const project = workflowProjectFixture([
    canonicalTestNode('normalize', { ui: { catalogId: 'intelligence.processing.normalize' } }),
  ])
  useFlowStore.getState().importWorkflowProject(project)
  const beforeUnlock = JSON.stringify({
    project: useFlowStore.getState().workflowProject,
    nodes: useFlowStore.getState().nodes,
    edges: useFlowStore.getState().edges,
  })
  assert.equal(useFlowStore.getState().unlockNodeInternals('normalize'), 0)
  assert.equal(JSON.stringify({
    project: useFlowStore.getState().workflowProject,
    nodes: useFlowStore.getState().nodes,
    edges: useFlowStore.getState().edges,
  }), beforeUnlock, 'fallback internals cannot be unlocked into a canvas-only draft')
  const beforeDive = JSON.stringify(useFlowStore.getState().workflowProject)
  const fallbackCount = useFlowStore.getState().enterNodeNetwork('normalize')
  assert.ok(fallbackCount > 0)
  assert.equal(JSON.stringify(useFlowStore.getState().workflowProject), beforeDive, 'navigation is persistence-free')

  const primitive = getWorkflowPrimitives()[0]
  useFlowStore.getState().addPrimitiveNode(primitive, { x: 760, y: 220 })
  let current = useFlowStore.getState()
  let canonicalScope = readCanonicalNetworkScope(current.workflowProject, 'normalize')
  assert.equal(canonicalScope.nodes.length, fallbackCount + 1)
  assert.ok(canonicalScope.nodes.some((node) => node.ui?.primitiveId === primitive.id))

  assert.equal(current.exitNodeNetwork(), true)
  assert.equal(useFlowStore.getState().enterNodeNetwork('normalize'), fallbackCount + 1)
  current = useFlowStore.getState()
  canonicalScope = readCanonicalNetworkScope(current.workflowProject, 'normalize')
  assert.equal(canonicalScope.nodes.length, fallbackCount + 1, 'migrated fallback and explicit node survive re-entry')

  useFlowStore.getState().importWorkflowProject(project)
  const historyBeforeAtomicAdd = useFlowStore.getState().past.length
  assert.ok(useFlowStore.getState().addPrimitiveToNodeNetwork('normalize', primitive, { x: 780, y: 96 }) > 0)
  assert.equal(useFlowStore.getState().past.length, historyBeforeAtomicAdd + 1)
  useFlowStore.getState().undo()
  assert.deepStrictEqual(
    useFlowStore.getState().workflowProject,
    project,
    'one undo restores both the primitive add and fallback-to-canonical migration',
  )
})

test('local public bindings persist at L2/L3, unlocked networks remain editable, and L4 is the depth boundary', async () => {
  const [{ useFlowStore }, { NODE_NETWORK_DEPTH_LIMIT_REACHED }] = await Promise.all([
    importTypeScript('lib/flow/store.ts'),
    importTypeScript('lib/workflow/node-hierarchy.ts'),
  ])
  const project = workflowProjectFixture([
    canonicalTestNode('l1', {
      internals: {
        locked: false,
        nodes: [canonicalTestNode('l2-package', {
          parameterInterface: publicParameterInterface('l3-package'),
          internals: {
            locked: false,
            nodes: [canonicalTestNode('l3-package', {
              parameterInterface: publicParameterInterface('l4-atom'),
              internals: {
                locked: false,
                nodes: [canonicalTestNode('l4-atom')],
                edges: [],
              },
            })],
            edges: [],
          },
        })],
        edges: [],
      },
    }),
  ])
  useFlowStore.getState().importWorkflowProject(project)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1'), 1)
  let current = useFlowStore.getState()
  assert.equal(current.nodes[0].draggable, true)
  assert.equal(current.nodes[0].connectable, true)
  current.updateParameterInterfaceField('l1__l2-package', 'public-value', 'from-l2')
  current = useFlowStore.getState()
  assert.equal(canonicalNodeAtPath(current.workflowProject, ['l1', 'l2-package']).parameterInterface.fields[0].value, 'from-l2')
  assert.equal(canonicalNodeAtPath(current.workflowProject, ['l1', 'l2-package', 'l3-package']).params.value, 'from-l2')

  assert.equal(current.enterNodeNetwork('l1__l2-package'), 1)
  current = useFlowStore.getState()
  current.updateParameterInterfaceField('l1__l2-package__l3-package', 'public-value', 'from-l3')
  current = useFlowStore.getState()
  assert.equal(canonicalNodeAtPath(current.workflowProject, ['l1', 'l2-package', 'l3-package']).parameterInterface.fields[0].value, 'from-l3')
  assert.equal(canonicalNodeAtPath(current.workflowProject, ['l1', 'l2-package', 'l3-package', 'l4-atom']).params.value, 'from-l3')

  assert.equal(current.enterNodeNetwork('l1__l2-package__l3-package'), 1)
  current = useFlowStore.getState()
  const stackAtL4 = current.networkStack.map((entry) => entry.nodeId)
  assert.equal(current.enterNodeNetwork('l1__l2-package__l3-package__l4-atom'), NODE_NETWORK_DEPTH_LIMIT_REACHED)
  assert.deepStrictEqual(useFlowStore.getState().networkStack.map((entry) => entry.nodeId), stackAtL4)
})

test('four-level runtime paths update exact nodes without a completed leaf clearing a blocked package', async () => {
  const { useFlowStore } = await importTypeScript('lib/flow/store.ts')
  const project = workflowProjectFixture([
    canonicalTestNode('l1', {
      internals: { locked: false, nodes: [canonicalTestNode('l2', {
        internals: { locked: false, nodes: [canonicalTestNode('l3', {
          internals: { locked: false, nodes: [canonicalTestNode('l4')], edges: [] },
        })], edges: [] },
      })], edges: [] },
    }),
  ])
  useFlowStore.getState().importWorkflowProject(project)
  useFlowStore.getState().applyWorkflowNodeRunEvent({
    id: 'event-l4-blocked',
    sequence: 1,
    workflowId: project.id,
    workflowRunId: 'run-1',
    traceId: 'trace-1',
    nodeId: 'l4',
    nodePath: ['l1', 'l2', 'l3', 'l4'],
    eventType: 'blocked',
    createdAt: '2026-07-14T00:00:00Z',
    details: {},
  })
  let current = useFlowStore.getState()
  for (const pathIds of [['l1'], ['l1', 'l2'], ['l1', 'l2', 'l3'], ['l1', 'l2', 'l3', 'l4']]) {
    assert.equal(canonicalNodeAtPath(current.workflowProject, pathIds).ui.runtimeRunState.status, 'blocked')
  }

  const state = (nodeId, nodePath, status, eventCount) => ({
    nodeId,
    nodePath,
    status,
    sourceGroups: [],
    eventCount,
    blockReasons: status === 'blocked' ? [{ code: 'blocked', message: 'blocked', details: {} }] : [],
    batches: [],
  })
  current.applyWorkflowRunProjection({
    workflowId: project.id,
    runId: 'run-1',
    traceId: 'trace-1',
    valid: true,
    status: 'blocked',
    startedAt: '2026-07-14T00:00:00Z',
    updatedAt: '2026-07-14T00:01:00Z',
    eventCount: 3,
    nodeStates: [
      state('l1', ['l1'], 'blocked', 1),
      state('l4', ['l1', 'l2', 'l3', 'l4'], 'blocked', 1),
      state('l4', ['l1', 'l2', 'l3', 'l4'], 'completed', 2),
    ],
    errors: [],
  })
  current = useFlowStore.getState()
  assert.equal(canonicalNodeAtPath(current.workflowProject, ['l1']).ui.runtimeRunState.status, 'blocked')
  assert.equal(canonicalNodeAtPath(current.workflowProject, ['l1', 'l2', 'l3', 'l4']).ui.runtimeRunState.status, 'completed')
})

test('internal primitive menu edits the clicked node child scope at L2/L3 and rejects L4', async () => {
  const [{ useFlowStore }, { getWorkflowPrimitives }, { NODE_NETWORK_DEPTH_LIMIT_REACHED }, menuSource] = await Promise.all([
    importTypeScript('lib/flow/store.ts'),
    importTypeScript('lib/workflow/node-primitives.ts'),
    importTypeScript('lib/workflow/node-hierarchy.ts'),
    readSource('components/flow/workflow-node-menu-actions.ts'),
  ])
  const menuAction = sourceSection(menuSource, 'const addPrimitiveFromMenu', 'const lockInternals')
  assert.match(menuAction, /addPrimitiveToNodeNetwork\([\s\S]*nodeMenu\.nodeId/)
  assert.doesNotMatch(menuAction, /isInsideNetwork/)
  assert.match(menuAction, /if \(count <= 0\)[\s\S]*return/)

  const project = workflowProjectFixture([
    canonicalTestNode('l1', {
      internals: { locked: false, nodes: [canonicalTestNode('l2-target')], edges: [] },
    }),
  ])
  const [l3Primitive, l4Primitive] = getWorkflowPrimitives()
  useFlowStore.getState().importWorkflowProject(project)
  assert.equal(useFlowStore.getState().enterNodeNetwork('l1'), 1)
  assert.ok(useFlowStore.getState().addPrimitiveToNodeNetwork('l1__l2-target', l3Primitive, { x: 780, y: 96 }) > 0)

  let current = useFlowStore.getState()
  const l2Target = canonicalNodeAtPath(current.workflowProject, ['l1', 'l2-target'])
  assert.equal(canonicalNodeAtPath(current.workflowProject, ['l1']).internals.nodes.length, 1, 'L3 is not added as an L2 sibling')
  const l3Node = l2Target.internals.nodes.find((node) => node.ui?.primitiveId === l3Primitive.id)
  assert.ok(l3Node)

  const l3CanvasId = `l1__l2-target__${l3Node.id}`
  assert.ok(current.addPrimitiveToNodeNetwork(l3CanvasId, l4Primitive, { x: 780, y: 96 }) > 0)
  current = useFlowStore.getState()
  const l4Node = canonicalNodeAtPath(current.workflowProject, ['l1', 'l2-target', l3Node.id]).internals.nodes.find(
    (node) => node.ui?.primitiveId === l4Primitive.id,
  )
  assert.ok(l4Node)

  const beforeL4Edit = JSON.stringify({
    project: current.workflowProject,
    stack: current.networkStack,
  })
  assert.equal(
    current.addPrimitiveToNodeNetwork(`${l3CanvasId}__${l4Node.id}`, l4Primitive, { x: 780, y: 96 }),
    NODE_NETWORK_DEPTH_LIMIT_REACHED,
  )
  assert.equal(JSON.stringify({
    project: useFlowStore.getState().workflowProject,
    stack: useFlowStore.getState().networkStack,
  }), beforeL4Edit)
})
