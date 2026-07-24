'use client'

import dynamic from 'next/dynamic'
import { ArrowLeft, ArrowRight, BrainCircuit, Clock3, Database, Focus, GitBranch, Network, Search, Workflow } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { use, useEffect, useMemo, useRef, useState } from 'react'

import { EmptyState, ErrorState, LoadingState } from '@/components/shell/data-states'
import { PageContainer } from '@/components/shell/page-container'
import { ProjectNavigation } from '@/components/studio/project-navigation'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProjectRecordGraph, useProjectWorkflows, useWorkspaceProjects } from '@/lib/api/hooks'
import type { ProjectRecordGraphPreview, RecordGraphEdge, RecordGraphNode } from '@/lib/api/types'
import { formatDateTime, formatFreshness, formatRelative, formatSourceDateTime } from '@/lib/format'
import { RECORD_GRAPH_KIND_COLOR, RECORD_GRAPH_KIND_LABEL } from '@/lib/records/project-record-graph'
import { cn } from '@/lib/utils'

const ProjectRecordGraphCanvas = dynamic(
  () => import('@/components/records/project-record-graph-canvas').then((module) => module.ProjectRecordGraphCanvas),
  { ssr: false, loading: () => <div className="grid min-h-[40rem] place-items-center text-sm text-muted-foreground">正在初始化关系图…</div> },
)

const DENSITY_OPTIONS = [
  { value: 300, label: '概览 · 300 节点' },
  { value: 700, label: '标准 · 700 节点' },
  { value: 1200, label: '深入 · 1,200 节点' },
]
type EvidenceView = 'timeline' | 'decision' | 'relationships'

export default function ProjectEvidencePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params)
  const searchParams = useSearchParams()
  const workspaceId = searchParams.get('workspace')
  const preferredWorkflowId = searchParams.get('workflow')
  const requestedRecordId = searchParams.get('record')
  const [view, setView] = useState<EvidenceView>(requestedRecordId ? 'decision' : 'timeline')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(requestedRecordId ? `record:${requestedRecordId}` : null)
  const [search, setSearch] = useState('')
  const [maxNodes, setMaxNodes] = useState(700)
  const inspectorRef = useRef<HTMLElement>(null)

  const projectsQuery = useWorkspaceProjects(workspaceId)
  const workflowsQuery = useProjectWorkflows(workspaceId, projectId)
  const graphQuery = useProjectRecordGraph(workspaceId, projectId, maxNodes)
  const project = projectsQuery.data?.find((candidate) => candidate.id === projectId)
  const workflowId = preferredWorkflowId ?? project?.primary_workflow_id ?? workflowsQuery.data?.[0]?.id ?? null
  const preview = graphQuery.data
  const nodesById = useMemo(() => new Map((preview?.nodes ?? []).map((node) => [node.id, node])), [preview?.nodes])
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) ?? null : null
  const related = useMemo(() => relatedNodes(preview, selectedNodeId, nodesById), [nodesById, preview, selectedNodeId])
  const evidencePath = useMemo(() => shortestEvidencePath(preview, selectedNodeId), [preview, selectedNodeId])
  const decisionTargetId = selectedNodeId ?? preview?.nodes.find((node) => node.kind === 'record')?.id ?? preview?.nodes.find((node) => node.kind === 'run')?.id ?? null
  const decisionPath = useMemo(() => shortestEvidencePath(preview, decisionTargetId), [decisionTargetId, preview])
  const timelineNodes = useMemo(() => (preview?.nodes ?? [])
    .filter((node) => nodeTimelineTime(node) && node.kind !== 'project')
    .sort((left, right) => (nodeTimelineTime(right) ?? '').localeCompare(nodeTimelineTime(left) ?? ''))
    .slice(0, 80), [preview?.nodes])
  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term || !preview) return []
    return preview.nodes.filter((node) => `${node.label} ${node.subtitle ?? ''} ${node.preview ?? ''}`.toLowerCase().includes(term)).sort((a, b) => b.count - a.count).slice(0, 10)
  }, [preview, search])

  useEffect(() => {
    if (!requestedRecordId || !preview) return
    const nodeId = `record:${requestedRecordId}`
    if (nodesById.has(nodeId)) setSelectedNodeId(nodeId)
  }, [nodesById, preview, requestedRecordId])

  useEffect(() => {
    inspectorRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [selectedNodeId])

  const overviewHref = workspaceId ? `/studio/projects/${projectId}?workspace=${workspaceId}` : '/studio'
  const dataHref = workspaceId ? `/studio/projects/${projectId}/data?workspace=${workspaceId}${workflowId ? `&workflow=${workflowId}` : ''}` : null
  const workflowHref = workspaceId && workflowId ? `/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${workflowId}` : null
  const loading = projectsQuery.isLoading || workflowsQuery.isLoading || graphQuery.isLoading
  const error = projectsQuery.error || workflowsQuery.error || graphQuery.error

  return (
    <PageContainer
      eyebrow="Project logic and evidence"
      title={project ? `${project.name} · 逻辑与证据` : '项目逻辑与证据'}
      description="从运行轨迹、显式决策路径和证据关系解释结果；展示可审计事实，不暴露模型内部原始思维链。"
      className="max-w-none"
      actions={<Link href={overviewHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-11')}><ArrowLeft className="size-4" />返回项目</Link>}
    >
      <div className="border-b pb-3"><ProjectNavigation active="evidence" workspaceId={workspaceId} projectId={projectId} workflowId={workflowId} /></div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="证据图摘要">
        <Metric label="项目记录" value={preview?.stats.total_records ?? 0} icon={Database} />
        <Metric label="可见关系" value={preview?.stats.visible_edges ?? 0} icon={Network} />
        <Metric label="采集运行" value={preview?.stats.total_runs ?? 0} icon={Focus} />
        <Metric label="工作流" value={preview?.stats.total_workflows ?? 0} icon={Workflow} />
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3">
            <div className="flex rounded-lg border bg-muted/30 p-1" aria-label="逻辑与证据视图">
              <ViewButton active={view === 'timeline'} icon={Clock3} onClick={() => setView('timeline')}>运行轨迹</ViewButton>
              <ViewButton active={view === 'decision'} icon={GitBranch} onClick={() => setView('decision')}>决策图</ViewButton>
              <ViewButton active={view === 'relationships'} icon={Network} onClick={() => setView('relationships')}>证据关系</ViewButton>
            </div>
            <div className="flex gap-2">{dataHref ? <Link href={dataHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Database className="size-4" />数据工作台</Link> : null}{workflowHref ? <Link href={workflowHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Workflow className="size-4" />业务编排</Link> : null}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-64 flex-1 xl:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索记录、来源、实体或运行…" className="pl-9" />
              {search.trim() && searchResults.length ? <div className="absolute left-0 top-11 z-40 w-full overflow-hidden rounded-lg border bg-popover shadow-xl">{searchResults.map((node) => <button key={node.id} type="button" onClick={() => { setSelectedNodeId(node.id); setSearch('') }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"><span className="truncate">{node.label}</span><span className="text-[10px] text-muted-foreground">{RECORD_GRAPH_KIND_LABEL[node.kind]}</span></button>)}</div> : null}
            </div>
            <Select value={String(maxNodes)} onValueChange={(value) => { setMaxNodes(Number(value)); setSelectedNodeId(null) }}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent>{DENSITY_OPTIONS.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent></Select>
          </div>
        </header>

        {loading ? <div className="p-5"><LoadingState rows={8} /></div> : error ? <div className="p-5"><ErrorState message={error instanceof Error ? error.message : '逻辑与证据读取失败'} hint="确认项目已有可读取的工作流和运行记录。" /></div> : !preview ? <EmptyState title="暂无证据图" description="项目运行产生记录后，系统会在这里建立来源、运行、记录和实体之间的关系。" /> : (
          <div className="grid min-h-[42rem] xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
            <div className="min-h-[42rem] border-b xl:border-b-0 xl:border-r">
              {view === 'relationships' ? <ProjectRecordGraphCanvas preview={preview} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} /> : view === 'decision' ? <DecisionMap path={decisionPath} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} /> : <RunTimeline nodes={timelineNodes} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />}
            </div>
            <aside ref={inspectorRef} className="max-h-[42rem] overflow-y-auto bg-background/95">
              {selectedNode ? <EvidenceInspector node={selectedNode} related={related} path={evidencePath} onSelect={setSelectedNodeId} workspaceId={workspaceId} projectId={projectId} /> : <EvidenceGuide preview={preview} view={view} />}
            </aside>
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function ViewButton({ active, children, icon: Icon, onClick }: { active: boolean; children: React.ReactNode; icon: typeof Network; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn('flex min-h-9 items-center gap-2 rounded-md px-3 text-xs transition-colors', active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}><Icon className="size-3.5" />{children}</button>
}

function RunTimeline({ nodes, selectedNodeId, onSelect }: { nodes: RecordGraphNode[]; selectedNodeId: string | null; onSelect: (id: string) => void }) {
  return <div className="mx-auto max-w-4xl p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">项目运行轨迹</h2><p className="mt-1 text-xs text-muted-foreground">记录按源发布时间排序；缺少源时间时会明确标注采集时间。</p></div><Badge variant="outline">{nodes.length} 个事件</Badge></div><ol className="relative mt-6 space-y-1 before:absolute before:bottom-5 before:left-[1.18rem] before:top-5 before:w-px before:bg-border">{nodes.length ? nodes.map((node) => <li key={node.id} className="relative"><button type="button" onClick={() => onSelect(node.id)} className={cn('grid w-full grid-cols-[2.4rem_minmax(0,1fr)_auto] items-start gap-3 rounded-lg p-3 text-left hover:bg-muted/40', selectedNodeId === node.id && 'bg-muted/60')}><span className="relative z-10 mt-0.5 grid size-5 place-items-center rounded-full border bg-card"><span className="size-2 rounded-full" style={{ backgroundColor: RECORD_GRAPH_KIND_COLOR[node.kind] }} /></span><span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium">{node.label}</span><Badge variant="outline" className="shrink-0">{RECORD_GRAPH_KIND_LABEL[node.kind]}</Badge></span><span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">{node.preview ?? node.subtitle ?? '已纳入项目证据图。'}</span></span><span className="whitespace-nowrap text-[10px] text-muted-foreground">{nodeTimelineLabel(node)}</span></button></li>) : <li className="p-6 text-sm text-muted-foreground">当前证据图没有带时间戳的运行事件。</li>}</ol></div>
}

function DecisionMap({ path, selectedNodeId, onSelect }: { path: RecordGraphNode[]; selectedNodeId: string | null; onSelect: (id: string) => void }) {
  return <div className="p-5"><div className="mx-auto max-w-5xl"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">显式决策路径</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">把项目、工作流、运行、来源和结果整理为可审计路径；这是系统事实摘要，不是模型私有思维链。</p></div><Badge variant="outline">{path.length} 个证据步骤</Badge></div>{path.length ? <div className="mt-8 flex flex-col items-stretch gap-3 xl:flex-row xl:items-center">{path.map((node, index) => <div key={node.id} className="contents"><button type="button" onClick={() => onSelect(node.id)} className={cn('min-w-0 flex-1 rounded-lg border p-4 text-left transition-colors hover:bg-muted/40', selectedNodeId === node.id && 'border-primary bg-primary/5')}><div className="flex items-center justify-between gap-2"><Badge variant="outline">{RECORD_GRAPH_KIND_LABEL[node.kind]}</Badge><span className="font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span></div><h3 className="mt-3 truncate text-sm font-semibold">{node.label}</h3><p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{node.preview ?? node.subtitle ?? '该步骤由项目证据关系推导。'}</p><div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground"><span className="size-2 rounded-full" style={{ backgroundColor: RECORD_GRAPH_KIND_COLOR[node.kind] }} />{node.status ?? 'evidence-ready'}</div></button>{index < path.length - 1 ? <ArrowRight className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground xl:rotate-0" /> : null}</div>)}</div> : <div className="mt-10 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">选择一个记录或运行后，这里会生成从项目到结果的可审计路径。</div>}</div></div>
}

function EvidenceInspector({ node, related, path, onSelect, workspaceId, projectId }: { node: RecordGraphNode; related: Array<{ node: RecordGraphNode; edge: RecordGraphEdge }>; path: RecordGraphNode[]; onSelect: (id: string) => void; workspaceId: string | null; projectId: string }) {
  return <div className="min-h-full">
    <header className="border-b px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: RECORD_GRAPH_KIND_COLOR[node.kind] }} />
          <span className="truncate">{RECORD_GRAPH_KIND_LABEL[node.kind]}</span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {node.status ?? '可用'}
        </span>
      </div>
      <h2 className="mt-4 break-words text-xl font-semibold leading-7 tracking-tight" style={{ color: RECORD_GRAPH_KIND_COLOR[node.kind] }}>{node.label}</h2>
      <p className="mt-2 line-clamp-4 text-sm leading-6 text-muted-foreground">{node.preview ?? node.subtitle ?? '该节点没有额外预览内容。'}</p>
    </header>

    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-b bg-muted/15 px-5 py-4">
      <Fact label="关联数量" value={String(node.count)} />
      <Fact label="双向关系" value={String(related.length)} />
      {node.kind === 'record' ? <>
        <Fact label="源发布时间" value={formatSourceDateTime(node.source_published_at)} />
        <Fact label="数据新鲜度" value={formatFreshness(node.source_published_at)} />
        <Fact label="采集时间" value={node.created_at ? formatDateTime(node.created_at) : '—'} />
      </> : <Fact label="记录时间" value={node.created_at ? formatDateTime(node.created_at) : '—'} />}
      <Fact label="节点状态" value={node.status ?? '可用'} />
    </dl>

    {path.length > 1 ? <section className="border-b px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm font-medium text-foreground">证据路径</p><p className="mt-1 text-xs text-muted-foreground">从项目到当前节点的最短可审计链路</p></div>
        <Badge variant="outline" className="shrink-0">{path.length} 步</Badge>
      </div>
      <ol className="mt-4">
        {path.map((item, index) => <li key={item.id} className="relative">
          {index < path.length - 1 ? <span aria-hidden className="absolute bottom-0 left-[0.875rem] top-8 w-px bg-border" /> : null}
          <button type="button" onClick={() => onSelect(item.id)} className="group grid w-full grid-cols-[1.75rem_minmax(0,1fr)_1rem] items-start gap-3 rounded-md border border-transparent px-1 py-2.5 text-left transition-colors hover:bg-muted/50" style={item.id === node.id ? { backgroundColor: `${RECORD_GRAPH_KIND_COLOR[item.kind]}14`, borderColor: `${RECORD_GRAPH_KIND_COLOR[item.kind]}80` } : undefined}>
            <span className="relative z-10 grid size-7 place-items-center rounded-full border bg-background font-mono text-[10px] text-muted-foreground group-hover:border-primary/50 group-hover:text-foreground">{String(index + 1).padStart(2, '0')}</span>
            <span className="min-w-0 pt-0.5"><span className="block line-clamp-2 text-xs font-medium leading-5" style={item.id === node.id ? { color: RECORD_GRAPH_KIND_COLOR[item.kind] } : undefined}>{item.label}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{RECORD_GRAPH_KIND_LABEL[item.kind]}</span></span>
            <ArrowRight className="mt-2 size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        </li>)}
      </ol>
    </section> : null}

    <section className="px-5 py-5">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-foreground">直接关联</p><p className="mt-1 text-xs text-muted-foreground">与当前节点直接相连的证据对象</p></div><span className="font-mono text-xs text-muted-foreground">{related.length}</span></div>
      <div className="mt-3 divide-y">{related.length ? related.slice(0, 12).map(({ node: neighbor, edge }) => <button type="button" key={`${edge.id}:${neighbor.id}`} onClick={() => onSelect(neighbor.id)} className="group grid w-full grid-cols-[0.5rem_minmax(0,1fr)_1rem] items-start gap-3 py-3 text-left"><span className="mt-1.5 size-2 rounded-full" style={{ backgroundColor: RECORD_GRAPH_KIND_COLOR[neighbor.kind] }} /><span className="min-w-0"><span className="block line-clamp-2 text-xs font-medium leading-5 text-foreground/90 group-hover:text-foreground">{neighbor.label}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{edge.label} · {RECORD_GRAPH_KIND_LABEL[neighbor.kind]}</span></span><ArrowRight className="mt-1 size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" /></button>) : <p className="py-4 text-xs text-muted-foreground">当前节点没有可见的直接关联。</p>}</div>
    </section>

    {(workspaceId && node.workflow_id) || (workspaceId && node.record_id) ? <footer className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background/95 px-5 py-4 backdrop-blur">{workspaceId && node.workflow_id ? <Link href={`/studio/workflow?workspace=${workspaceId}&project=${projectId}&workflow=${node.workflow_id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Workflow className="size-4" />打开工作流</Link> : null}{workspaceId && node.record_id ? <Link href={`/studio/projects/${projectId}/data?workspace=${workspaceId}&search=${encodeURIComponent(node.label)}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Database className="size-4" />查看记录</Link> : null}</footer> : null}
  </div>
}

function EvidenceGuide({ preview, view }: { preview: ProjectRecordGraphPreview; view: EvidenceView }) {
  const copy = view === 'timeline' ? '选择一个运行事件，查看它的状态、关联来源和产物。' : view === 'decision' ? '选择一个结果，查看从项目到产物的显式证据路径。' : '点击关系图中的节点，查看直接关系与可审计路径。'
  return <div className="p-5"><span className="grid size-10 place-items-center rounded-lg bg-muted"><BrainCircuit className="size-5 text-muted-foreground" /></span><h2 className="mt-4 font-semibold">选择一个证据节点</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p><div className="mt-5 space-y-2">{(Object.keys(RECORD_GRAPH_KIND_LABEL) as Array<RecordGraphNode['kind']>).map((kind) => <div key={kind} className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full" style={{ backgroundColor: RECORD_GRAPH_KIND_COLOR[kind] }} />{RECORD_GRAPH_KIND_LABEL[kind]}</div>)}</div>{preview.truncated ? <p className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200">当前是聚合采样视图，隐藏了 {preview.stats.hidden_records.toLocaleString('zh-CN')} 条记录。提高密度可继续深入。</p> : null}</div>
}

function nodeTimelineTime(node: RecordGraphNode) {
  return node.kind === 'record' ? node.source_published_at ?? node.created_at : node.created_at
}

function nodeTimelineLabel(node: RecordGraphNode) {
  if (node.kind !== 'record') return node.created_at ? formatRelative(node.created_at) : '—'
  if (node.source_published_at) return `源发布 ${formatFreshness(node.source_published_at)}`
  return node.created_at ? `源时间缺失 · 采集 ${formatRelative(node.created_at)}` : '源时间缺失'
}

function relatedNodes(preview: ProjectRecordGraphPreview | undefined, selectedNodeId: string | null, nodesById: Map<string, RecordGraphNode>) {
  if (!preview || !selectedNodeId) return []
  return preview.edges.flatMap((edge) => { const neighborId = edge.source === selectedNodeId ? edge.target : edge.target === selectedNodeId ? edge.source : null; const node = neighborId ? nodesById.get(neighborId) : null; return node ? [{ node, edge }] : [] }).sort((left, right) => right.edge.weight - left.edge.weight)
}

function shortestEvidencePath(preview: ProjectRecordGraphPreview | undefined, targetId: string | null) {
  if (!preview || !targetId) return []
  const startId = `project:${preview.project_id}`
  if (startId === targetId) return preview.nodes.filter((node) => node.id === startId)
  const nodes = new Map(preview.nodes.map((node) => [node.id, node]))
  const adjacency = new Map<string, string[]>()
  preview.edges.forEach((edge) => { adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]); adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]) })
  const queue = [startId]
  const parent = new Map<string, string | null>([[startId, null]])
  while (queue.length) { const current = queue.shift() as string; if (current === targetId) break; for (const neighbor of adjacency.get(current) ?? []) if (!parent.has(neighbor)) { parent.set(neighbor, current); queue.push(neighbor) } }
  if (!parent.has(targetId)) return []
  const ids: string[] = []
  for (let current: string | null = targetId; current; current = parent.get(current) ?? null) ids.unshift(current)
  return ids.flatMap((id) => nodes.get(id) ? [nodes.get(id) as RecordGraphNode] : [])
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Database }) { return <div className="flex items-center gap-3 rounded-xl border bg-card p-4"><span className="grid size-10 place-items-center rounded-lg bg-muted"><Icon className="size-4 text-muted-foreground" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold">{value.toLocaleString('zh-CN')}</p></div></div> }
function Fact({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 truncate font-mono text-sm font-medium text-foreground/90">{value}</dd></div> }
