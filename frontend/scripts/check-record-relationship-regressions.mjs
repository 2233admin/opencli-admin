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
        mode: 'strip',
        sourceUrl: url,
      })
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

const read = (relativePath) => readFile(path.join(frontendRoot, relativePath), 'utf8')

function preview() {
  return {
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    project_name: '项目一',
    strategy: 'server-aggregated-sample',
    truncated: true,
    max_nodes: 300,
    nodes: [
      {
        id: 'project:project-1',
        kind: 'project',
        label: '项目一',
        subtitle: '项目预览',
        count: 100_000,
      },
      {
        id: 'workflow:workflow-1',
        kind: 'workflow',
        label: '采集工作流',
        subtitle: '主工作流',
        count: 100_000,
      },
      {
        id: 'record:record-1',
        kind: 'record',
        label: '第一条消息',
        subtitle: 'example.test',
        count: 1,
        record_id: 'record-1',
      },
      {
        id: 'entity:tag:climate',
        kind: 'entity',
        label: 'climate',
        subtitle: '标签',
        count: 42,
      },
    ],
    edges: [
      {
        id: 'contains:1',
        source: 'project:project-1',
        target: 'workflow:workflow-1',
        kind: 'contains',
        label: '项目归属',
        weight: 100_000,
        bidirectional: true,
      },
      {
        id: 'semantic:1',
        source: 'record:record-1',
        target: 'entity:tag:climate',
        kind: 'semantic',
        label: '语义双链',
        weight: 1,
        bidirectional: true,
      },
    ],
    stats: {
      total_records: 100_000,
      sampled_records: 200,
      hidden_records: 99_800,
      total_sources: 18,
      total_workflows: 1,
      total_runs: 40,
      visible_nodes: 4,
      visible_edges: 2,
    },
    generated_at: '2026-07-18T08:00:00Z',
  }
}

test('project preview becomes an undirected WebGL graph with aggregate node sizing', async () => {
  const { buildProjectRecordGraph } = await import(
    pathToFileURL(path.join(frontendRoot, 'lib/records/project-record-graph.ts')).href
  )

  const graph = buildProjectRecordGraph(preview())
  assert.equal(graph.order, 4)
  assert.equal(graph.size, 2)
  assert.equal(graph.type, 'undirected')
  assert.ok(
    graph.getNodeAttribute('project:project-1', 'size') >
      graph.getNodeAttribute('record:record-1', 'size'),
  )
  assert.equal(
    graph.getEdgeAttribute('semantic:1', 'graphEdge').bidirectional,
    true,
  )
})

test('records graph is project-scoped, bounded and rendered through a client-only Sigma island', async () => {
  const [tabs, page, canvas, endpoints, hooks] = await Promise.all([
    read('components/shell/route-tabs.tsx'),
    read('app/(app)/records/graph/page.tsx'),
    read('components/records/project-record-graph-canvas.tsx'),
    read('lib/api/endpoints.ts'),
    read('lib/api/hooks.ts'),
  ])

  assert.match(tabs, /href: '\/records\/graph', label: '关系图谱'/)
  assert.match(page, /useWorkspaceProjects/)
  assert.match(page, /useProjectRecordGraph/)
  assert.match(page, /ssr: false/)
  assert.match(page, /服务端聚合预览/)
  assert.match(page, /隐藏 .* 条，避免图谱过载/)
  assert.match(canvas, /SigmaContainer/)
  assert.match(canvas, /FA2Layout/)
  assert.match(canvas, /barnesHutOptimize/)
  assert.match(canvas, /layout\.kill\(\)/)
  assert.match(endpoints, /projects\/\$\{projectId\}\/record-graph/)
  assert.match(hooks, /\['project-record-graph'/)
})

test('project record surfaces distinguish source freshness from ingestion time', async () => {
  const [evidencePage, dataPage, types] = await Promise.all([
    read('app/(app)/studio/projects/[projectId]/evidence/page.tsx'),
    read('app/(app)/studio/projects/[projectId]/data/page.tsx'),
    read('lib/api/types.ts'),
  ])

  assert.match(types, /source_published_at: string \| null/)
  assert.match(evidencePage, /源发布时间/)
  assert.match(evidencePage, /数据新鲜度/)
  assert.match(evidencePage, /采集时间/)
  assert.doesNotMatch(evidencePage, /Fact label="创建时间"/)
  assert.match(dataPage, /源发布时间/)
  assert.doesNotMatch(dataPage, /<TableHead>更新时间<\/TableHead>/)
  assert.doesNotMatch(dataPage, /formatRelative\(record\.updated_at\)/)
})
