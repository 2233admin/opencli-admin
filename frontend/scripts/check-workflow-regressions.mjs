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

test('L1 business nodes use business names and business-first source configuration', async () => {
  const [{ businessNodeName }, sourceConfig, nodeSource, inspectorSource, menuSource, catalogSource, i18nSource, internalsSource] = await Promise.all([
    importTypeScript('lib/workflow/business-node-experience.ts'),
    importTypeScript('lib/workflow/source-business-config.ts'),
    readSource('components/flow/nodes/workflow-node.tsx'),
    readSource('components/flow/inspector.tsx'),
    readSource('components/flow/node-context-menu.tsx'),
    readSource('lib/workflow/node-catalog.ts'),
    readSource('lib/workflow/node-i18n.ts'),
    readSource('lib/workflow/node-internals.ts'),
  ])

  assert.equal(businessNodeName({
    label: 'A 股多源真实采集',
    kind: 'agent',
    capability: 'normalize',
    params: { template: 'opencli-multi-source' },
  }), '采集 A 股市场数据')
  assert.equal(businessNodeName({
    label: '多站点数据',
    kind: 'agent',
    capability: 'normalize',
    params: {
      template: 'opencli-multi-source',
      sources: [{ label: '沪深京 A 股行情全景', args: { market: 'hs-a' } }],
    },
  }), '采集 A 股市场数据')
  assert.equal(businessNodeName({
    label: '记录清洗与准入',
    kind: 'agent',
    capability: 'normalize',
    params: { template: 'record-hygiene' },
  }), '核验并准入数据')
  assert.equal(businessNodeName({
    label: 'A 股金融数据集',
    kind: 'sink',
    capability: 'store',
  }), '更新 A 股金融数据集')
  assert.equal(businessNodeName({
    label: '采集沪深公告与研报',
    kind: 'agent',
    capability: 'normalize',
    params: { template: 'opencli-multi-source' },
  }), '采集沪深公告与研报')
  assert.equal(businessNodeName({
    label: '盘前更新',
    kind: 'schedule',
    capability: 'trigger',
  }), '盘前更新')
  assert.match(nodeSource, /businessLabel/)
  assert.match(inspectorSource, /title=\{isBusinessLevel \? businessLabel : data\.label\}/)
  assert.match(inspectorSource, /节点名称/)
  assert.match(inspectorSource, /节点说明/)
  assert.match(inspectorSource, /<OpenCLISourceEditor/)
  assert.match(inspectorSource, /添加数据源/)
  assert.match(inspectorSource, /管理数据源/)
  assert.match(inspectorSource, /采集主题/)
  assert.match(inspectorSource, /市场范围/)
  assert.match(inspectorSource, /高级设置/)
  assert.match(inspectorSource, /useSources/)
  assert.doesNotMatch(inspectorSource, /label: "新数据来源"/)
  assert.match(inspectorSource, /firstStringParam/)
  assert.doesNotMatch(inspectorSource, /JIN10 macro news sample with policy\/market impact/)
  assert.doesNotMatch(inspectorSource, /3-bullet macro brief, impact score, source refs, and risk note/)
  assert.match(menuSource, /查看 Agent 执行方式/)
  assert.match(menuSource, /编辑业务设置/)
  assert.match(catalogSource, /label: "多站点数据采集"/)
  assert.match(i18nSource, /label: "多站点数据采集"/)
  assert.match(internalsSource, /title: "多站点采集执行"/)

  const registered = sourceConfig.openCLISlotFromDataSource({
    id: 'source-1',
    name: '东方财富行情',
    channel_type: 'opencli',
    channel_config: { site: 'eastmoney', command: 'quote', args: { market: 'hs-a', limit: 20 } },
    enabled: true,
    tags: ['finance-market'],
    created_at: '2026-07-24T00:00:00Z',
    updated_at: '2026-07-24T00:00:00Z',
  })
  assert.deepEqual(registered, {
    id: 'registered-source-1',
    label: '东方财富行情',
    sourceGroup: 'finance-market',
    site: 'eastmoney',
    command: 'quote',
    args: { market: 'hs-a', limit: 20 },
    format: undefined,
  })
  assert.equal(sourceConfig.openCLISlotFromDataSource({
    id: 'source-2',
    name: '未启用',
    channel_type: 'opencli',
    channel_config: { site: 'eastmoney', command: 'quote', args: {} },
    enabled: false,
    tags: [],
    created_at: '2026-07-24T00:00:00Z',
    updated_at: '2026-07-24T00:00:00Z',
  }), undefined)

  const sourceSlots = [
    { id: 'one', label: 'A', sourceGroup: 'social', site: 'x', command: 'search', args: { query: 'AI' } },
    { id: 'two', label: 'B', sourceGroup: 'video', site: 'b', command: 'search', args: { keyword: 'AI' } },
  ]
  assert.equal(sourceConfig.sourceBusinessQuery(sourceSlots), 'AI')
  assert.deepEqual(
    sourceConfig.updateSourceBusinessQuery(sourceSlots, '机器人').map((source) => source.args),
    [{ query: '机器人' }, { keyword: '机器人' }],
  )
})

test('workflow event replay tolerates the post-run commit visibility race', async () => {
  const { replayWorkflowRunEventStream } = await importTypeScript('lib/workflow/backend-runs.ts')
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts += 1
    if (attempts === 1) {
      return Response.json({ message: 'Workflow run not found' }, { status: 404 })
    }
    return new Response(
      'event: run_state\ndata: {"workflowId":"wf","runId":"run","traceId":"trace","valid":true,"status":"completed","startedAt":"2026-07-24T00:00:00Z","updatedAt":"2026-07-24T00:00:01Z","eventCount":0,"nodeStates":[],"errors":[]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  try {
    const replay = await replayWorkflowRunEventStream('run')
    assert.equal(attempts, 2)
    assert.equal(replay.projection?.status, 'completed')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('studio creation is transactional and the editor anchors to the project primary workflow', async () => {
  const [types, endpoints, hooks, studio, templates, newProject, session, lifecycle, editor, commandStrip] = await Promise.all([
    readSource('lib/api/types.ts'),
    readSource('lib/api/endpoints.ts'),
    readSource('lib/api/hooks.ts'),
    readSource('app/(app)/studio/page.tsx'),
    readSource('app/(app)/studio/templates/page.tsx'),
    readSource('app/(app)/studio/new/page.tsx'),
    readSource('components/flow/workflow-editor-session.tsx'),
    readSource('components/studio/workflow-lifecycle-strip.logic.ts'),
    readSource('components/flow/workflow-editor.tsx'),
    readSource('components/flow/command-strip.tsx'),
  ])

  assert.match(types, /primary_workflow_id: string \| null/)
  assert.match(endpoints, /projects\/bootstrap/)
  assert.doesNotMatch(endpoints, /createWorkspaceProject/)
  assert.match(hooks, /useBootstrapWorkspaceProject/)
  assert.doesNotMatch(hooks, /useCreateWorkspaceProject/)
  for (const source of [studio, templates, newProject]) {
    assert.match(source, /useBootstrapWorkspaceProject/)
    assert.doesNotMatch(source, /useCreateWorkspaceProject/)
  }
  assert.match(session, /project\?\.primary_workflow_id/)
  assert.doesNotMatch(session, /projectWorkflows\.data\?\.\[0\]\?\.id/)
  assert.match(session, /if \(!active\) return/)
  assert.match(session, /setLoadError\(message\)/)
  assert.match(session, /<WorkflowEditor documentState=\{documentState\}/)
  assert.match(editor, /documentState=\{documentState\}/)
  assert.match(commandStrip, /documentState === "saving"/)
  assert.doesNotMatch(commandStrip, /\{isDirty \? "未保存" : "已保存"\}/)
  assert.match(session, /console\.error\('\[WorkflowEditorSession\] failed to load workflow draft'/)
  assert.match(session, /role="alert"/)
  assert.doesNotMatch(lifecycle, /activate|激活|待后端接入/)
  assert.doesNotMatch(newProject, /可激活|正式激活|检查并激活/)
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

test('project application types use persisted values and preserve Dify modes', async () => {
  const [{ PROJECT_APP_TYPE_LABELS, projectAppTypeForDifyMode, projectMatchesAppType }, { translateWorkflowDsl }, { studioAppTypeForTemplate }] = await Promise.all([
    importTypeScript('lib/studio/app-types.ts'),
    importTypeScript('lib/workflow/codec.ts'),
    importTypeScript('lib/workflow/studio-templates.ts'),
  ])

  assert.deepEqual(
    ['chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion'].map(projectAppTypeForDifyMode),
    ['chatbot', 'agent', 'chatflow', 'workflow', 'text-generator'],
  )
  assert.equal(projectAppTypeForDifyMode('unknown'), 'workflow')
  assert.equal(projectMatchesAppType({ app_type: 'chatbot' }, 'chatbot'), true)
  assert.equal(projectMatchesAppType({ app_type: 'chatbot' }, 'agent'), false)
  assert.equal(PROJECT_APP_TYPE_LABELS['text-generator'], '文本生成')
  assert.equal(studioAppTypeForTemplate('research-agent'), 'agent')
  assert.equal(studioAppTypeForTemplate('content-summary'), 'text-generator')
  assert.equal(studioAppTypeForTemplate('blank'), 'workflow')

  const imported = translateWorkflowDsl(JSON.stringify({
    kind: 'app',
    app: { name: 'Support flow', mode: 'advanced-chat' },
    version: '0.3.0',
    workflow: { graph: { nodes: [{ id: 'start', data: { type: 'start', title: 'Start' } }], edges: [] } },
  }))
  assert.equal(imported.ok, true)
  assert.equal(imported.report?.source, 'dify')
  assert.equal(imported.report?.appMode, 'advanced-chat')
  assert.equal(projectAppTypeForDifyMode(imported.report?.appMode), 'chatflow')
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
  assert.match(studio, /placeholder="搜索名称、描述或标识"/)
  assert.match(studio, /aria-label="项目排序"/)
  assert.doesNotMatch(studio, /PROJECT_TYPE_FILTERS|Dify 应用类型筛选/)
  assert.doesNotMatch(studio, /const \[type, setType\]|const \[creator, setCreator\]/)
  assert.doesNotMatch(studio, /全部创建者|创建者 \{project\.created_by_user_id/)
  assert.match(studio, /const selectedWorkspace = workspaces\.data\?\.find/)
  assert.match(studio, /workspaces\.data\?\.length[\s\S]*> 1/)
  assert.match(studio, /<SelectValue>\{selectedWorkspace\?\.name \?\? '选择工作区'\}<\/SelectValue>/)
  assert.match(studio, /aria-label="当前工作区"/)
  assert.doesNotMatch(studio, /<SelectValue placeholder="选择工作区"\s*\/>/)
  assert.doesNotMatch(studio, /projectMatchesAppType\(project, type\)/)
  assert.doesNotMatch(studio, /PROJECT_APP_TYPE_LABELS\[project\.app_type\]/)
  assert.doesNotMatch(studio, /inferProjectType/)
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
  const [editor, surface, palette, dropdownMenu] = await Promise.all([
    readSource('components/flow/workflow-editor.tsx'),
    readSource('components/flow/workflow-canvas-surface.tsx'),
    readSource('components/flow/command-palette.tsx'),
    readSource('components/ui/dropdown-menu.tsx'),
  ])

  assert.match(editor, /const onPaneContextMenu/)
  assert.match(editor, /setPaletteAnchor\(\{ x: event\.clientX, y: event\.clientY \}\)/)
  assert.match(editor, /useOpenCLIAdapterCatalog\(true\)/)
  assert.match(editor, /mergeWorkflowNodeCatalog/)
  assert.match(surface, /onPaneContextMenu=\{props\.onPaneContextMenu\}/)
  assert.match(palette, /catalogItems/)
  assert.doesNotMatch(palette, /getWorkflowNodeCatalog/)
  assert.doesNotMatch(palette, /filter\(\(item\) => item\.category !== ["']package["']\)/)
  assert.match(palette, /inNodeNetwork && activeTab === "tools" \? getWorkflowPrimitives\(\) : \[\]/)
  assert.match(palette, /item\.category === ["']annotation["'] \|\| item\.category === ["']shape["']/)
  assert.match(palette, /选择后直接进入配置/)
  assert.match(palette, /输入 > 搜索画布操作/)
  assert.match(palette, /catalogCategoryLabels/)
  assert.match(palette, /role="tablist"/)
  assert.match(palette, /aria-label="节点一级菜单"/)
  assert.match(palette, /role="tab"/)
  assert.match(palette, /aria-selected=\{selected\}/)
  assert.match(palette, /label: "业务节点"/)
  assert.match(palette, /label: "工具"/)
  assert.match(palette, /label: "数据源"/)
  assert.match(palette, /label: "开始"/)
  assert.match(palette, /label: "辅助"/)
  assert.match(palette, /paletteTabForCatalogItem\(item\) === activeTab/)
  assert.match(palette, /if \(item\.category === "package"\) return "business"/)
  assert.match(palette, /if \(item\.category === "source"\) return "sources"/)
  assert.match(palette, /if \(item\.category === "trigger"\) return "start"/)
  assert.doesNotMatch(palette, /defaultCatalogItems/)
  assert.match(palette, /commonOpenCLISites/)
  assert.match(palette, /prioritizeCommonSources/)
  assert.match(palette, /还有 \{hiddenCatalogCount\} 个结果/)
  assert.match(palette, /onNodeCreated\?\.\(\)/)
  assert.match(editor, /onNodeCreated=\{\(\) => setInspectorOpen\(true\)\}/)
  assert.match(palette, /L\{nodeDepth\} · \{nodeLayer\.label\}/)
  assert.match(palette, /groupPrimitivesForNodeMenu\(primitiveOperators\)/)
  assert.match(palette, /group\.label/)
  const labelComponent = sourceSection(
    dropdownMenu,
    'function DropdownMenuLabel(',
    'function DropdownMenuItem(',
  )
  assert.match(labelComponent, /React\.ComponentProps<"div">/)
  assert.doesNotMatch(labelComponent, /MenuPrimitive\.GroupLabel/)
})

test('Dify-style node creation selects the node and editable OpenCLI sources rebuild package internals', async () => {
  const [{ useFlowStore }, { WORKFLOW_NODE_CATALOG }] = await Promise.all([
    importTypeScript('lib/flow/store.ts'),
    importTypeScript('lib/workflow/node-catalog.ts'),
  ])
  const packageItem = WORKFLOW_NODE_CATALOG.find((item) => item.id === 'package.opencli.multi-source-hda')
  assert.ok(packageItem)

  useFlowStore.getState().importWorkflowProject(workflowProjectFixture([
    canonicalTestNode('existing'),
  ]))
  useFlowStore.getState().addWorkflowNodeFromCatalog(packageItem, { x: 240, y: 120 })

  let current = useFlowStore.getState()
  const created = current.nodes.find((node) => node.id !== 'existing')
  assert.ok(created)
  assert.equal(created.selected, true)
  assert.equal(current.nodes.find((node) => node.id === 'existing')?.selected, false)
  const createdProjectNode = current.workflowProject.nodes.find((node) => node.id === created.id)
  assert.equal(createdProjectNode?.ui?.catalogId, 'package.opencli.multi-source-hda')
  assert.equal(createdProjectNode?.ui?.preferCustomLabel, true)

  const sources = [{
    id: 'jin10',
    label: '金十宏观快讯',
    sourceGroup: 'finance-news',
    site: 'jin10',
    command: 'flash',
    args: { limit: 20 },
  }]
  const implementationId = createdProjectNode?.params.operator?.implementationNodeId
  assert.equal(typeof implementationId, 'string')
  current.updateWorkflowNodeParams(`${created.id}__${implementationId}`, { sources })
  current = useFlowStore.getState()
  const projectNode = current.workflowProject.nodes
    .find((node) => node.id === created.id)
    ?.internals?.nodes.find((node) => node.id === implementationId)

  assert.deepEqual(projectNode?.params.sources, sources)
  assert.equal(
    projectNode?.internals?.nodes.some((node) => node.id === 'source-jin10'),
    true,
    `expected rebuilt internals, received: ${projectNode?.internals?.nodes.map((node) => node.id).join(', ')}`,
  )
  assert.equal(projectNode?.internals?.nodes.some((node) => node.ui?.label === '金十宏观快讯'), true)
  assert.equal(current.workflowProject.adapters.some((adapter) => adapter.id === 'opencli-jin10'), true)
})

test('OpenCLI adapter commands become built-in catalog nodes without site hardcoding', async () => {
  const {
    mergeWorkflowNodeCatalog,
    openCLIAdapterNodeToCatalogItem,
  } = await importTypeScript('lib/workflow/opencli-adapter-catalog.ts')
  const { addCatalogNodeToWorkflowProject } = await importTypeScript('lib/workflow/node-catalog.ts')

  const douyinSearchNode = {
    id: 'opencli.adapter.douyin.search',
    label: 'douyin · search',
    description: 'Search Douyin videos',
    status: 'blocked',
    site: 'douyin',
    command: 'search',
    access: 'read',
    browser: true,
    strategy: 'cookie',
    domain: 'www.douyin.com',
    catalogId: 'intelligence.source.opencli-slot',
    kind: 'source',
    capability: 'fetch',
    requiredArgs: ['query'],
    args: [{
      name: 'query',
      type: 'str',
      required: true,
      valueRequired: true,
      positional: false,
      choices: [],
    }],
    adapter: {
      id: 'opencli-douyin',
      type: 'source',
      provider: 'opencli',
      mode: 'live',
      config: { channel: 'opencli' },
    },
    params: {
      site: 'douyin',
      command: 'search',
      format: 'json',
      args: {},
    },
    manifest: {
      schema: 'opencli.adapter-node.v1',
      runtime: { binding: 'iii.collector-opencli.snapshot' },
    },
  }
  const douyinSearch = openCLIAdapterNodeToCatalogItem(douyinSearchNode)

  assert.equal(douyinSearch.id, 'opencli.adapter.douyin.search')
  assert.equal(douyinSearch.category, 'source')
  assert.equal(douyinSearch.adapter, 'opencli-douyin')
  assert.equal(douyinSearch.requiredAdapters[0].provider, 'opencli')
  assert.equal(douyinSearch.params.opencliAdapterNodeId, 'opencli.adapter.douyin.search')
  assert.equal(douyinSearch.runtimeCapability.status, 'blocked')
  assert.deepEqual(douyinSearch.runtimeCapability.missing, ['parameter:query'])
  assert.ok(douyinSearch.keywords.includes('douyin'))

  const merged = mergeWorkflowNodeCatalog(
    [{ ...douyinSearch, label: 'stale hardcoded label' }],
    [douyinSearch],
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].label, 'douyin · search')

  const douyinTophot = openCLIAdapterNodeToCatalogItem({
    ...douyinSearchNode,
    id: 'opencli.adapter.douyin.tophot',
    label: 'douyin · tophot',
    command: 'tophot',
    status: 'runnable',
    requiredArgs: [],
    args: [],
    params: {
      site: 'douyin',
      command: 'tophot',
      format: 'json',
      args: {},
    },
  })
  const project = addCatalogNodeToWorkflowProject(
    workflowProjectFixture([]),
    douyinTophot,
    'opencli-douyin-tophot',
    { x: 120, y: 80 },
  )
  assert.equal(project.adapters[0].id, 'opencli-douyin')
  assert.equal(project.nodes[0].adapter, 'opencli-douyin')
  assert.equal(project.nodes[0].params.site, 'douyin')
  assert.equal(project.nodes[0].params.command, 'tophot')
  assert.equal(project.nodes[0].params.opencliAdapterNodeId, 'opencli.adapter.douyin.tophot')
})

test('the default canvas is an operator network with recursive four-layer lookup', async () => {
  const [pipeline, store, commandStrip, editor, settings, hierarchy, { PACKAGED_WORKFLOW_PROJECT }] = await Promise.all([
    readSource('lib/workflow/collection-pipeline.ts'),
    readSource('lib/flow/store.ts'),
    readSource('components/flow/command-strip.tsx'),
    readSource('components/flow/workflow-editor.tsx'),
    readSource('lib/flow/settings-store.ts'),
    readSource('lib/workflow/node-hierarchy.ts'),
    importTypeScript('lib/workflow/collection-pipeline.ts'),
  ])
  const packaged = sourceSection(pipeline, 'export function buildPackagedWorkflowProject(', 'export const PACKAGED_WORKFLOW_PROJECT')

  for (const packageId of ['package.opencli.multi-source-hda', 'package.intelligence.pipeline', 'package.review.human-review']) {
    assert.match(packaged, new RegExp(packageId.replaceAll('.', '\\.')))
  }
  assert.match(packaged, /createOperatorNodeFromCatalog/)
  for (const operatorId of ['source-operator', 'intelligence-operator', 'review-operator']) {
    assert.match(packaged, new RegExp(operatorId))
  }
  assert.deepStrictEqual(
    PACKAGED_WORKFLOW_PROJECT.nodes.map((node) => node.id),
    ['source-operator', 'intelligence-operator', 'review-operator'],
  )
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

test('Studio preview only calls the OpenCLI HDA tracer for graphs that contain that package', async () => {
  const [
    { findOpenCLIHDAWorkflowPackageNodeId },
    { PACKAGED_WORKFLOW_PROJECT },
    { studioGraphForTemplate },
  ] = await Promise.all([
    importTypeScript('lib/workflow/backend-opencli-hda-trace.ts'),
    importTypeScript('lib/workflow/collection-pipeline.ts'),
    importTypeScript('lib/workflow/studio-templates.ts'),
  ])
  const nativeTemplate = studioGraphForTemplate('native-intelligence-lifecycle', 'Native preview')

  assert.equal(typeof findOpenCLIHDAWorkflowPackageNodeId, 'function')
  assert.equal(
    findOpenCLIHDAWorkflowPackageNodeId(PACKAGED_WORKFLOW_PROJECT),
    'source-operator::source-package',
  )
  assert.equal(findOpenCLIHDAWorkflowPackageNodeId(nativeTemplate), null)
})

test('native lifecycle Preview exposes 18 non-mutating action readiness records', async () => {
  const [
    {
      NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS,
      buildNativeIntelligencePreviewEvidence,
    },
    { studioGraphForTemplate },
    panel,
  ] = await Promise.all([
    importTypeScript('lib/workflow/native-intelligence-preview.ts'),
    importTypeScript('lib/workflow/studio-templates.ts'),
    readSource('components/flow/run-trace-panel.tsx'),
  ])
  const project = studioGraphForTemplate('native-intelligence-lifecycle', 'Native preview')
  const tools = NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS.map((action) => ({
    id: `tool.intelligence.native.${action}`,
    label: action,
    status: 'runnable',
    provider: 'opencli-admin',
    inputPorts: [{ name: 'in', type: 'record[]' }],
    outputPorts: [{ name: 'out', type: 'record[]' }],
    executor: { mode: 'native_intelligence', params: { action } },
    tags: ['native', 'offline'],
    manifest: { readiness: { status: 'runnable', missingReasons: [] } },
  }))
  const capabilities = {
    version: '1.1.0',
    catalog: [{
      id: 'package.intelligence.native-lifecycle',
      label: 'Native Intelligence Lifecycle',
      surface: 'catalog',
      status: 'runnable',
      backendAvailable: true,
      missing: [],
      tags: ['native'],
      manifest: {
        readiness: {
          status: 'runnable',
          childCount: 18,
          expectedChildCount: 18,
          blockedChildren: [],
          missingReasons: [],
        },
      },
    }],
    primitives: [],
    channels: [],
    notifiers: [],
    triggers: [],
    resources: [],
  }
  const compile = {
    valid: true,
    errors: [],
    plan: {
      runtime: {
        node_ids: ['native-intelligence-lifecycle'],
        nodes: [{ id: 'native-intelligence-lifecycle', runtime: {} }],
      },
    },
  }

  const ready = buildNativeIntelligencePreviewEvidence({
    project,
    compile,
    capabilities,
    tools,
  })

  assert.ok(ready)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.mutates, false)
  assert.equal(ready.dispatch, 'none')
  assert.equal(ready.expectedActionCount, 18)
  assert.equal(ready.actions.length, 18)
  assert.deepStrictEqual(ready.compiledNodeIds, ['native-intelligence-lifecycle'])
  assert.equal(ready.readiness.status, 'runnable')

  const blockedTools = tools.map((tool, index) => index === 17
    ? {
        ...tool,
        status: 'blocked',
        manifest: {
          readiness: {
            status: 'blocked',
            missingReasons: ['database_session'],
          },
        },
      }
    : tool)
  const blocked = buildNativeIntelligencePreviewEvidence({
    project,
    compile,
    capabilities: {
      ...capabilities,
      catalog: [{
        ...capabilities.catalog[0],
        status: 'blocked',
        backendAvailable: false,
        missing: ['database_session'],
        manifest: {
          readiness: {
            status: 'blocked',
            childCount: 18,
            expectedChildCount: 18,
            blockedChildren: ['tool.intelligence.native.close'],
            missingReasons: ['database_session'],
          },
        },
      }],
    },
    tools: blockedTools,
  })

  assert.ok(blocked)
  assert.equal(blocked.status, 'blocked')
  assert.deepStrictEqual(blocked.blockedActions, ['close'])
  assert.deepStrictEqual(blocked.missingReasons, ['database_session'])
  assert.match(panel, /fetchWorkflowCapabilities\(\{\s*authorization\s*\}\)/)
  assert.match(panel, /fetchWorkflowToolCapabilities\(\{\s*authorization\s*\}\)/)
  assert.match(panel, /Capability\/readiness evidence only[\s\S]*does not execute or mutate/)
})

test('legacy WorkflowProject extensions survive frontend parse and serialization', async () => {
  const [
    { parseWorkflowProject },
    { studioGraphForTemplate },
  ] = await Promise.all([
    importTypeScript('lib/workflow/schema.ts'),
    importTypeScript('lib/workflow/studio-templates.ts'),
  ])
  const legacy = studioGraphForTemplate('native-intelligence-lifecycle', 'Legacy graph')
  legacy.legacyExtension = {
    schema: 'legacy-extension.v0',
    nullableValue: null,
  }
  legacy.nodes[0].legacyNodeExtension = {
    owner: 'legacy-canvas',
    nullableValue: null,
  }

  const parsed = parseWorkflowProject(JSON.parse(JSON.stringify(legacy)))
  const serialized = JSON.parse(JSON.stringify(parsed))

  assert.deepStrictEqual(serialized.legacyExtension, legacy.legacyExtension)
  assert.deepStrictEqual(
    serialized.nodes[0].legacyNodeExtension,
    legacy.nodes[0].legacyNodeExtension,
  )
})

test('the explicit Webhook delivery template retains its real configuration gate', async () => {
  const { PACKAGED_WORKFLOW_PROJECT } = await importTypeScript('lib/workflow/collection-pipeline.ts')
  const { studioGraphForTemplate } = await importTypeScript('lib/workflow/studio-templates.ts')
  const delivery = studioGraphForTemplate('webhook-delivery', 'Configured delivery')

  assert.equal(PACKAGED_WORKFLOW_PROJECT.nodes.some((node) => node.id === 'dispatch-operator'), false)
  assert.deepStrictEqual(delivery.nodes.map((node) => node.id), ['dispatch-operator'])
  assert.equal(delivery.agentPermissions.canSendNotifications, false)
  assert.equal(delivery.adapters[0]?.provider, 'webhook')
  assert.equal(delivery.adapters[0]?.config.url, undefined)
})

test('Studio EvidenceBatch projection proxy targets the run projection API', async () => {
  const [proxy, route] = await Promise.all([
    readSource('app/api/workflow/evidence-batch-proxy.ts'),
    readSource('app/api/workflow/runs/[runId]/evidence-batches/projection/route.ts'),
  ])

  assert.match(proxy, /\/runs\/\$\{encodeURIComponent\(runId\)\}\/projection/)
  assert.match(route, /proxyWorkflowEvidenceProjectionRequest\(req,\s*runId\)/)
  assert.doesNotMatch(route, /proxyWorkflowEvidenceBatchRequest\(req,\s*runId,\s*["']\/projection["']\)/)
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
      { source: 'source-pool', target: 'source-douyin', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-pool', target: 'source-bilibili', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-pool', target: 'source-xiaohongshu', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-pool', target: 'source-twitter', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-douyin', target: 'internal-normalize', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-bilibili', target: 'internal-normalize', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-xiaohongshu', target: 'internal-normalize', sourcePort: 'out', targetPort: 'in' },
      { source: 'source-twitter', target: 'internal-normalize', sourcePort: 'out', targetPort: 'in' },
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

test('adding the native lifecycle package to a nonempty canvas defers bindings until materialization', async () => {
  const [
    { PACKAGED_WORKFLOW_PROJECT },
    { WORKFLOW_NODE_CATALOG, addCatalogNodeToWorkflowProject },
  ] = await Promise.all([
    importTypeScript('lib/workflow/collection-pipeline.ts'),
    importTypeScript('lib/workflow/node-catalog.ts'),
  ])
  const nativePackage = WORKFLOW_NODE_CATALOG.find(
    (item) => item.id === 'package.intelligence.native-lifecycle',
  )
  assert.ok(nativePackage)

  const project = addCatalogNodeToWorkflowProject(
    PACKAGED_WORKFLOW_PROJECT,
    nativePackage,
    'editor-native-lifecycle',
    { x: 1600, y: 320 },
  )
  const operator = project.nodes.find((node) => node.id === 'editor-native-lifecycle')
  const implementation = operator?.internals?.nodes.find(
    (node) => node.id === 'editor-native-lifecycle-implementation',
  )
  assert.ok(implementation, 'the package implementation must remain isolated under its operator')
  assert.equal(implementation.parameterInterface, undefined)
  assert.equal(implementation.params.template, 'native-intelligence-lifecycle')
  assert.equal(project.nodes.length, PACKAGED_WORKFLOW_PROJECT.nodes.length + 1)
  assert.equal(operator.internals.nodes.length, 1)

  const repositoryRoot = path.resolve(frontendRoot, '..')
  const windowsRepositoryPython = path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe')
  const unixRepositoryPython = path.join(repositoryRoot, '.venv', 'bin', 'python')
  const pythonExecutable = existsSync(windowsRepositoryPython)
    ? windowsRepositoryPython
    : (process.env.PYTHON ?? (existsSync(unixRepositoryPython) ? unixRepositoryPython : 'python'))
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
    input: JSON.stringify(project),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })

  assert.equal(backendCheck.status, 0, `${backendCheck.stdout}\n${backendCheck.stderr}`)
  const compileResult = JSON.parse(backendCheck.stdout)
  assert.equal(compileResult.valid, true)
  assert.doesNotMatch(JSON.stringify(compileResult.errors), /invalid_parameter_binding/)
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

test('native intelligence tools project all granular backend capabilities into Studio', async () => {
  const { nativeIntelligenceCatalogItems } = await importTypeScript('lib/workflow/node-catalog.ts')
  const tools = Array.from({ length: 29 }, (_, index) => ({
    id: `tool.intelligence.native.action-${index}`,
    label: `Native action ${index}`,
    description: `Action ${index}`,
    status: index === 28 ? 'blocked' : 'runnable',
    provider: 'opencli-admin',
    inputPorts: [{ name: 'in', type: 'intelligenceSessionEnvelope' }],
    outputPorts: [{ name: 'out', type: 'intelligenceSessionEnvelope' }],
    executor: {
      mode: 'native_intelligence',
      params: { action: `action-${index}` },
    },
    tags: ['native', 'offline'],
    manifest: {
      readiness: {
        missingReasons: index === 28 ? ['contract_complete'] : [],
      },
      runtimeContract: {
        bindingId: `workflow.native-intelligence.action-${index}`,
      },
    },
  }))
  const items = nativeIntelligenceCatalogItems(tools)

  assert.equal(items.length, 29)
  assert.equal(items[0].id, 'intelligence.native.action-0')
  assert.equal(items[0].runtimeCapability.status, 'runnable')
  assert.equal(items[28].runtimeCapability.status, 'blocked')
  assert.deepEqual(items[28].runtimeCapability.missing, ['contract_complete'])
  assert.equal(
    items[0].runtimeContract.bindingId,
    'workflow.native-intelligence.action-0',
  )
})

test('native lifecycle template and Run Trace expose bounded query and Q&A results', async () => {
  const [templates, catalog, panel, preview] = await Promise.all([
    readSource('lib/workflow/studio-templates.ts'),
    readSource('lib/workflow/node-catalog.ts'),
    readSource('components/flow/run-trace-panel.tsx'),
    importTypeScript('lib/workflow/native-intelligence-result-preview.ts'),
  ])
  const eventCard = sourceSection(panel, 'function RunEventCard(', 'function BackendRuntimePreview(')

  assert.match(templates, /template:\s*'native-intelligence-lifecycle'/)
  assert.match(templates, /credentialFree:\s*true/)
  assert.match(templates, /canFetchNetwork:\s*false/)
  assert.match(catalog, /groupId:\s*"native-intelligence-lifecycle-package"[\s\S]*nodeCount:\s*21/)
  for (const action of [
    'simulation.timeline',
    'simulation.stats',
    'interviews.history',
    'report.progress',
    'report.read',
    'report.ask',
    'report.answers',
  ]) {
    assert.ok(panel.includes(`"${action}"`), `Run Trace must inspect ${action}`)
  }
  assert.match(eventCard, /formatNativeIntelligenceResultPreview\(nativeResult\)/)
  assert.doesNotMatch(eventCard, /JSON\.stringify\(nativeResult/)

  const giant = {
    status: 'completed',
    sessionId: 'session-bounded-preview',
    query: 'why '.repeat(2_000),
    report: {
      sections: Array.from({ length: 100 }, (_, index) => ({
        heading: `Section ${index}`,
        body: `report-${index}-`.repeat(300),
      })),
    },
    answers: Array.from({ length: 80 }, (_, index) => ({
      payload: {
        question: `Question ${index}`,
        answer: index === 0 ? 'grounded answer retained' : `Answer ${index}`.repeat(200),
      },
      artifactId: `answer-${index}`,
      groundingArtifactIds: Array.from({ length: 30 }, (__, item) => `ground-${index}-${item}`),
    })),
    timeline: Array.from({ length: 120 }, (_, index) => ({
      round: index,
      event: `timeline-${index}-`.repeat(200),
    })),
  }
  const before = structuredClone(giant)
  const formatted = preview.formatNativeIntelligenceResultPreview(giant)

  assert.ok(formatted.length <= preview.NATIVE_RESULT_PREVIEW_MAX_CHARS)
  assert.match(formatted, /session-bounded-preview/)
  assert.match(formatted, /grounded answer retained/)
  assert.match(formatted, /ground-0-0/)
  assert.match(formatted, /\$count/)
  assert.match(formatted, /\$truncated/)
  assert.deepStrictEqual(giant, before, 'preview formatting must not mutate the result')

  const small = {
    status: 'completed',
    sessionId: 'session-small',
    artifacts: [{
      artifactId: 'report-1',
      groundingArtifactIds: ['research-1'],
      payload: { answer: 'small grounded answer' },
    }],
  }
  assert.equal(
    preview.formatNativeIntelligenceResultPreview(small),
    JSON.stringify(small, null, 2),
  )
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
