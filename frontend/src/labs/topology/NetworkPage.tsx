import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { Activity, AlertTriangle, CheckCircle2, ChevronRight, Database, MessageSquareText, RefreshCw, SlidersHorizontal, Workflow, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  deleteSource,
  listAgents,
  listNodes,
  listNotificationLogs,
  listNotificationRules,
  listRecords,
  listSchedules,
  listSources,
  listTasks,
  listWorkers,
} from '../../api/endpoints'
import type {
  AIAgent,
  CollectedRecord,
  CollectionTask,
  CronSchedule,
  DataSource,
  EdgeNode,
  NotificationLog,
  NotificationRule,
  WorkerNode,
} from '../../api/types'
import Card from '../../components/Card'
import { CanvasToolbarButton, canvasToolbarButtonClass } from '../../components/CanvasToolbarButton'
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorAlert from '../../components/ErrorAlert'
import { MetricTile } from '../../components/opencli'
import { cn } from '../../lib/utils'
import { AgentDock, type DockContextNode } from './AgentDock'
import { ODP_NODE_ID, odpSystemGraphNode } from './odpNode'
import { ReactFlowTopologyCanvas } from './ReactFlowTopologyCanvas'
import { TopologyCanvasDropZone } from './TopologyPalette'
import { StageOperationPanel, type StageDataBundle } from './nodes/StageOperations'
import {
  buildTopologyGraph,
  fallbackLayout,
  type TopologyGraph,
  type TopologyHealth,
  type TopologyInput,
  type TopologyNodeData,
} from './topologyModel'

/* ── Houdini-style read-first collection network ────────────────────────────
 * L0  top network = one node per collection project (data source); a grid.
 *      double-click a project node = dive into its subnet (Houdini dive-in).
 * L1  project subnet = source → schedule → task → agent → record → notify,
 *      scoped to that one source only, built by the existing buildTopologyGraph.
 * Breadcrumb pops levels. Selecting a node opens a read-first data-at-node
 * inspector (real entity data + ops). Mutation lives elsewhere (agent chat).
 * The graph mirrors reality — it is NOT a manual authoring board.
 * ────────────────────────────────────────────────────────────────────────── */

type TopologyFlowNode = Node<TopologyNodeData>
type TopologyFlowEdge = Edge<{ health: TopologyHealth }>

const PROJECT_COLS = 4
const PROJECT_COL_GAP = 300
const PROJECT_ROW_GAP = 200

interface NetworkPageProps {
  /** Rendered inline at the right end of the toolbar row, after 同步 (D18-B
   * #7 chrome dedup): PlanCanvasPage passes its 总览/当前Plan ViewSwitch here
   * instead of stacking a second header row above this page — one row: breadcrumb
   * chip, then whatever the host wants (the view toggle), then 同步. */
  headerExtra?: React.ReactNode
}

export default function NetworkPage({ headerExtra }: NetworkPageProps = {}) {
  const qc = useQueryClient()
  const [divePath, setDivePath] = useState<string[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  // Right-edge pull-out drawer: 'node' = operate selected node, 'agent' = chat dock, null = collapsed.
  const [rightPanel, setRightPanel] = useState<'node' | 'agent' | null>(null)
  // Delete-key on a source/project node asks first — deleting a DB entity is
  // never silent (issue: editor basics). sourceId + name for the confirm copy.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const sourcesQuery = useQuery({ queryKey: ['network', 'sources'], queryFn: () => listSources({ limit: 100 }), refetchInterval: 30_000 })
  const tasksQuery = useQuery({ queryKey: ['network', 'tasks'], queryFn: () => listTasks({ limit: 100 }), refetchInterval: 10_000 })
  const schedulesQuery = useQuery({ queryKey: ['network', 'schedules'], queryFn: () => listSchedules(), refetchInterval: 30_000 })
  const agentsQuery = useQuery({ queryKey: ['network', 'agents'], queryFn: () => listAgents(), refetchInterval: 30_000 })
  const recordsQuery = useQuery({ queryKey: ['network', 'records'], queryFn: () => listRecords({ limit: 80 }), refetchInterval: 15_000 })
  const rulesQuery = useQuery({ queryKey: ['network', 'notification-rules'], queryFn: () => listNotificationRules(), refetchInterval: 30_000 })
  const logsQuery = useQuery({ queryKey: ['network', 'notification-logs'], queryFn: () => listNotificationLogs(), refetchInterval: 15_000 })
  const edgeNodesQuery = useQuery({ queryKey: ['network', 'edge-nodes'], queryFn: () => listNodes(), refetchInterval: 15_000 })
  const workersQuery = useQuery({ queryKey: ['network', 'workers'], queryFn: () => listWorkers(), refetchInterval: 15_000 })

  const queries = [
    sourcesQuery, tasksQuery, schedulesQuery, agentsQuery, recordsQuery,
    rulesQuery, logsQuery, edgeNodesQuery, workersQuery,
  ] as const

  const input = useMemo<TopologyInput>(
    () => ({
      sources: asArray<DataSource>(sourcesQuery.data),
      schedules: asArray<CronSchedule>(schedulesQuery.data),
      tasks: asArray<CollectionTask>(tasksQuery.data),
      agents: asArray<AIAgent>(agentsQuery.data),
      records: asArray<CollectedRecord>(recordsQuery.data),
      notificationRules: asArray<NotificationRule>(rulesQuery.data),
      notificationLogs: asArray<NotificationLog>(logsQuery.data),
      edgeNodes: asArray<EdgeNode>(edgeNodesQuery.data),
      workers: asArray<WorkerNode>(workersQuery.data),
    }),
    [sourcesQuery.data, schedulesQuery.data, tasksQuery.data, agentsQuery.data, recordsQuery.data, rulesQuery.data, logsQuery.data, edgeNodesQuery.data, workersQuery.data],
  )

  const stageData = useMemo<StageDataBundle>(
    () => ({
      sources: input.sources,
      schedules: input.schedules ?? [],
      tasks: input.tasks,
      agents: input.agents,
      records: input.records,
      rules: input.notificationRules,
    }),
    [input],
  )

  // 总览 KPI strip (D18-B #3): "网络好不好" at a glance, computed from the
  // same raw arrays the canvas already fetched — no new data layer. Global
  // (unscoped by dive level) so the numbers stay stable while diving in/out.
  const kpi = useMemo(() => {
    const enabled = input.sources.filter((s) => s.enabled).length
    const running = input.tasks.filter((t) => t.status === 'running').length
    const failed = input.tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled').length
    return { total: input.sources.length, enabled, running, failed }
  }, [input])

  const divedSourceId = divePath[0] ?? null
  const divedSource = divedSourceId ? input.sources.find((s) => s.id === divedSourceId) ?? null : null

  // current graph: L0 projects grid, or L1 scoped subnet
  const { nodes, edges } = useMemo<{ nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] }>(() => {
    if (!divedSourceId) return { nodes: projectFlowNodes(input), edges: [] }
    const scoped = buildTopologyGraph(scopeInputForSource(input, divedSourceId))
    return toScopedFlow(scoped)
  }, [input, divedSourceId])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  const isFetching = queries.some((q) => q.isFetching)
  const queryError = queries.find((q) => q.error)?.error

  const refetchAll = () => queries.forEach((q) => q.refetch())

  // Delete flow for the canvas's delete key — the canvas only ever *requests*
  // a delete (see ReactFlowTopologyCanvas.onRequestDeleteSource); this page
  // owns the confirm dialog + the real API call, same pattern as SourcesPage's
  // own delete flow (ConfirmDialog + deleteSource mutation).
  const deleteSourceMut = useMutation({
    mutationFn: (id: string) => deleteSource(id),
    onSuccess: (_data, deletedId) => {
      qc.invalidateQueries({ queryKey: ['network', 'sources'] })
      qc.invalidateQueries({ queryKey: ['sources'] })
      if (divedSourceId === deletedId) popTo(0)
      if (selectedNodeId === deletedId) setSelectedNodeId(null)
      setDeleteTarget(null)
      toast.success('已删除采集节点')
      refetchAll()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  const requestDeleteSource = (sourceId: string) => {
    const source = input.sources.find((s) => s.id === sourceId)
    setDeleteTarget({ id: sourceId, name: source?.name ?? sourceId })
  }

  const handleSelect = (id: string) => {
    setSelectedNodeId(id)
    setRightPanel('node')
  }

  const handleDoubleClick = (id: string) => {
    // L0: dive into the project; L1: leaf, just operate it. The ODP system
    // node (issue 07) is a singleton leaf like an L1 node even at L0 — it has
    // no per-source subnet to dive into, so double-click just selects it.
    if (id === ODP_NODE_ID) {
      handleSelect(id)
      return
    }
    if (!divedSourceId) {
      setDivePath([id])
      setSelectedNodeId(null)
      setRightPanel(null)
    } else {
      handleSelect(id)
    }
  }

  const popTo = (depth: number) => {
    setDivePath((path) => path.slice(0, depth))
    setSelectedNodeId(null)
    setRightPanel(null)
  }

  const dockContext: DockContextNode | null = selectedNode
    ? { kind: String(selectedNode.data.kind), id: selectedNode.id, title: selectedNode.data.title }
    : divedSource
      ? { kind: 'source', id: divedSource.id, title: divedSource.name }
      : null

  return (
    <div className="space-y-3">
      {/* slim toolbar — no page-header chrome, no explanatory paragraph.
       * D18-B #7 chrome dedup: headerExtra (PlanCanvasPage's 总览/当前Plan
       * ViewSwitch) lands in THIS row instead of a second row above it. */}
      <div className="flex items-center justify-between gap-3">
        <Breadcrumb divedSourceName={divedSource?.name ?? null} onRoot={() => popTo(0)} count={nodes.length} />
        <div className="flex items-center gap-2">
          {divedSource && (
            <>
              <Link to={`/sources/${divedSource.id}/control-room`} className={canvasToolbarButtonClass()}>
                <SlidersHorizontal className="h-3.5 w-3.5" />
                控制室
              </Link>
              <Link to="/plans/new" className={canvasToolbarButtonClass()}>
                <Workflow className="h-3.5 w-3.5" />
                采集画布
              </Link>
            </>
          )}
          <CanvasToolbarButton
            onClick={refetchAll}
            icon={<RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />}
          >
            同步
          </CanvasToolbarButton>
          {headerExtra}
        </div>
      </div>

      {/* D18-B #3: 4-tile KPI strip — "网络好不好" at a glance, above the
       * canvas. Global counts (not scoped to the current dive level) so they
       * stay stable while diving in/out. Reuses MetricTile + the same raw
       * arrays the canvas already fetched — no new data layer. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile label="源总数" value={kpi.total} icon={Database} tone="accent" />
        <MetricTile label="启用中" value={kpi.enabled} icon={CheckCircle2} tone={kpi.enabled > 0 ? 'success' : 'neutral'} />
        <MetricTile label="运行任务" value={kpi.running} icon={Activity} tone={kpi.running > 0 ? 'info' : 'neutral'} />
        <MetricTile label="失败·缺口" value={kpi.failed} icon={AlertTriangle} tone={kpi.failed > 0 ? 'danger' : 'neutral'} />
      </div>

      {queryError && (
        <ErrorAlert error={queryError instanceof Error ? queryError : '采集网络数据同步失败。'} onRetry={refetchAll} />
      )}

      {/* D18-B #9: fill to the viewport bottom (same calc(100vh-Npx) technique
       * as SourcesPage's topology canvas, adjusted for this page's slimmer
       * toolbar-row-only chrome + the new KPI row above) instead of the old
       * fixed 74vh that left a dead black band under a shorter viewport. */}
      <div className="relative flex h-[calc(100vh-300px)] min-h-[560px] overflow-hidden rounded-md border border-white/10 bg-black">
        <div className="relative min-w-0 flex-1">
          {nodes.length === 0 ? (
            <EmptyState dived={Boolean(divedSourceId)} />
          ) : (
            <TopologyCanvasDropZone onCreated={refetchAll}>
              <ReactFlowTopologyCanvas
                nodes={nodes}
                edges={edges}
                selectedNodeId={selectedNodeId}
                onSelectNode={handleSelect}
                onNodeDoubleClick={handleDoubleClick}
                viewKey={divedSourceId ?? 'root'}
                onRequestDeleteSource={!divedSourceId ? requestDeleteSource : undefined}
                hideOps
                autoLayoutOnMount
                hideAutoLayoutButton
                minimapMinNodes={10}
                topRightExtra={
                  <CanvasToolbarButton
                    tone={rightPanel === 'agent' ? 'accent' : 'neutral'}
                    onClick={() => setRightPanel((p) => (p === 'agent' ? null : 'agent'))}
                    aria-pressed={rightPanel === 'agent'}
                    className="shadow-lg"
                    icon={<MessageSquareText className="h-3.5 w-3.5" />}
                  >
                    AGENT 对话坞
                  </CanvasToolbarButton>
                }
              />
            </TopologyCanvasDropZone>
          )}
        </div>

        {/* slide-out inspector/agent-dock panel — D18-B #1/#4: no rail tab
         * needed anymore, this opens directly from a node click (handleSelect
         * sets rightPanel:'node') or from the Agent Dock canvas toolbar button
         * above (topRightExtra). Its own header carries the close (X). */}
        {rightPanel && (
          <div
            key={rightPanel}
            className="m3-sheet-in absolute right-0 top-0 bottom-0 z-20 w-[380px] max-w-full border-l border-white/10 bg-ops-panel shadow-overlay"
          >
            {rightPanel === 'node' && selectedNode ? (
              <NodeInspector
                node={selectedNode}
                stageData={stageData}
                onChanged={refetchAll}
                onClose={() => setRightPanel(null)}
              />
            ) : rightPanel === 'agent' ? (
              <div className="h-full">
                <AgentDock contextNode={dockContext} onApplied={refetchAll} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`删除采集节点「${deleteTarget?.name ?? ''}」？`}
        description="将删除该数据源及其关联的计划/任务在画布上的引用。此操作不可撤销。"
        confirmLabel={deleteSourceMut.isPending ? '删除中…' : '确认删除'}
        onConfirm={() => { if (deleteTarget) deleteSourceMut.mutate(deleteTarget.id) }}
      />
    </div>
  )
}

function Breadcrumb({
  divedSourceName,
  onRoot,
  count,
}: {
  divedSourceName: string | null
  onRoot: () => void
  count: number
}) {
  return (
    <div className="flex items-center gap-1.5 border border-white/8 bg-black/30 px-3 py-2 font-code text-2xs text-zinc-400">
      <button
        type="button"
        onClick={onRoot}
        className={cn('rounded-sm px-1.5 py-0.5 transition hover:bg-white/6', divedSourceName ? 'text-zinc-300 hover:text-white' : 'text-zinc-100')}
      >
        采集网络
      </button>
      {divedSourceName && (
        <>
          <ChevronRight className="h-3 w-3 text-zinc-700" />
          <span className="rounded-sm px-1.5 py-0.5 text-zinc-100">{divedSourceName}</span>
        </>
      )}
      <span className="ml-1 rounded-full border border-white/10 px-2 py-0.5 text-3xs text-zinc-500">
        {divedSourceName ? `${count} 节点` : `项目 · ${count}`}
      </span>
    </div>
  )
}

function EmptyState({ dived }: { dived: boolean }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-zinc-300">{dived ? '该采集项目暂无子网节点' : '暂无采集项目'}</p>
        <p className="mt-1 text-xs text-zinc-600">{dived ? '没有计划/任务/记录与此来源关联。' : '先在「数据源」里创建采集来源。'}</p>
      </div>
    </div>
  )
}

function NodeInspector({
  node,
  stageData,
  onChanged,
  onClose,
}: {
  node: TopologyFlowNode
  stageData: StageDataBundle
  onChanged: () => void
  onClose: () => void
}) {
  const stageCode = readDetailString(node.data.detail, 'stage_code', node.data.kind.slice(0, 2).toUpperCase())
  return (
    <Card padding={false} className="flex h-full flex-col overflow-hidden border-0 bg-ops-panel">
      <div className="flex items-start justify-between gap-2 border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center border border-white/15 bg-white/4">
            <span className="font-code text-xs font-semibold text-zinc-200">{stageCode}</span>
          </div>
          <div className="min-w-0">
            <p className="telemetry-label">NODE · {node.data.kind}</p>
            <h2 className="mt-0.5 truncate text-sm font-semibold text-white" title={node.data.title}>
              {node.data.title}
            </h2>
            <p className="truncate text-2xs text-zinc-500">{node.data.subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="收起面板"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/12 bg-black/60 text-zinc-400 hover:border-white/[0.28] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="thin-scrollbar flex-1 space-y-4 overflow-auto px-4 py-4">
        <StageOperationPanel node={node.data} stageCode={stageCode} data={stageData} onChanged={onChanged} />
      </div>
    </Card>
  )
}

// ── L0: one project node per source, laid in a grid, plus the singleton ODP
// system node (issue 07) — the shared data plane isn't a source, so it is
// planted at a fixed slot after the source grid rather than folded into the
// per-source loop. Always exactly one instance regardless of source count.
function projectFlowNodes(input: TopologyInput): TopologyFlowNode[] {
  const sourceNodes = input.sources.map((source, index): TopologyFlowNode => {
    const schedules = (input.schedules ?? []).filter((s) => s.source_id === source.id)
    const tasks = input.tasks.filter((t) => t.source_id === source.id)
    const records = input.records.filter((r) => r.source_id === source.id)
    const rules = input.notificationRules.filter((r) => r.source_id === source.id)
    const health = projectHealth(source.enabled, tasks)
    const column = index % PROJECT_COLS
    const row = Math.floor(index / PROJECT_COLS)
    return {
      id: source.id,
      type: 'topologyNode',
      position: { x: column * PROJECT_COL_GAP, y: row * PROJECT_ROW_GAP },
      data: {
        kind: 'source',
        title: source.name,
        subtitle: source.channel_type,
        health,
        badges: [
          `${schedules.length} 计划`,
          `${tasks.length} 任务`,
          `${records.length} 记录`,
        ],
        skills: [],
        actions: [{ id: `${source.id}:dive`, label: '进入子网', description: '查看该项目采集逻辑', enabled: false }],
        ports: { inputs: [], outputs: [] },
        targetPath: '/sources',
        detail: {
          kind: 'project',
          source_id: source.id,
          stage_code: 'PRJ',
          responsibility: `${source.channel_type} 采集项目 · 点「进入子网」查看采集逻辑`,
          current_status: source.enabled ? '启用' : '停用',
          capability_gap: `${schedules.length} 计划 / ${tasks.length} 任务 / ${records.length} 记录 / ${rules.length} 通知`,
        },
      },
    }
  })

  const rowsUsed = Math.ceil(input.sources.length / PROJECT_COLS) || 1
  const odpNode = odpSystemGraphNode(0)
  const odpFlowNode: TopologyFlowNode = {
    id: odpNode.id,
    type: 'topologyNode',
    position: { x: 0, y: rowsUsed * PROJECT_ROW_GAP },
    data: odpNode.data,
  }

  return [...sourceNodes, odpFlowNode]
}

function projectHealth(enabled: boolean, tasks: CollectionTask[]): TopologyHealth {
  if (!enabled) return 'disabled'
  if (tasks.some((t) => t.status === 'failed' || t.status === 'cancelled')) return 'failed'
  if (tasks.some((t) => t.status === 'running')) return 'active'
  if (tasks.some((t) => t.status === 'pending')) return 'warning'
  return 'healthy'
}

// ── L1: scope the full input to one source for the subnet ───────────────────
function scopeInputForSource(input: TopologyInput, sourceId: string): TopologyInput {
  const source = input.sources.find((s) => s.id === sourceId)
  const schedules = (input.schedules ?? []).filter((s) => s.source_id === sourceId)
  const tasks = input.tasks.filter((t) => t.source_id === sourceId)
  const records = input.records.filter((r) => r.source_id === sourceId)
  const rules = input.notificationRules.filter((r) => r.source_id === sourceId)
  const ruleIds = new Set(rules.map((r) => r.id))
  const recordIds = new Set(records.map((r) => r.id))
  const logs = input.notificationLogs.filter((l) => ruleIds.has(l.rule_id) || (l.record_id && recordIds.has(l.record_id)))
  const agentIds = new Set(
    [...tasks.map((t) => t.agent_id), ...schedules.map((s) => s.agent_id)].filter((id): id is string => Boolean(id)),
  )
  const agents = input.agents.filter((a) => agentIds.has(a.id))
  return {
    sources: source ? [source] : [],
    schedules,
    tasks,
    agents,
    records,
    notificationRules: rules,
    notificationLogs: logs,
    edgeNodes: [],
    workers: [],
  }
}

function toScopedFlow(graph: TopologyGraph): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const laid = fallbackLayout(graph, 240, 150)
  return {
    nodes: laid.map((node) => ({
      id: node.id,
      type: 'topologyNode',
      position: node.position,
      data: node.data,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      data: { health: edge.health },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(edge.health) },
      style: { stroke: edgeColor(edge.health), strokeWidth: edge.health === 'failed' ? 2.4 : 1.8 },
      labelStyle: { fill: '#a0a0a0', fontSize: 11, fontWeight: 600 },
      labelBgStyle: { fill: '#000000', fillOpacity: 0.85 },
    })),
  }
}

function edgeColor(health: TopologyHealth): string {
  const colors: Record<TopologyHealth, string> = {
    healthy: '#35b779',
    active: '#47a8ff',
    warning: '#d99a3d',
    failed: '#e15b64',
    disabled: '#71717a',
    unknown: '#a1a1aa',
  }
  return colors[health]
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') {
    const data = (value as { data?: unknown }).data
    if (Array.isArray(data)) return data as T[]
  }
  return []
}

function readDetailString(detail: Record<string, unknown> | undefined, key: string, fallback: string) {
  const value = detail?.[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}
