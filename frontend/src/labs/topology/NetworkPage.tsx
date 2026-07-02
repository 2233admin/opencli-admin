import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { ChevronRight, RefreshCw, Sparkles, SlidersHorizontal, Workflow, X } from 'lucide-react'
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
import ConfirmDialog from '../../components/ConfirmDialog'
import ErrorAlert from '../../components/ErrorAlert'
import { cn } from '../../lib/utils'
import { AgentDock, type DockContextNode } from './AgentDock'
import { ODP_NODE_ID, odpSystemGraphNode } from './odpNode'
import { ReactFlowTopologyCanvas } from './ReactFlowTopologyCanvas'
import { TopologyCanvasDropZone, TopologyPalette } from './TopologyPalette'
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

export default function NetworkPage() {
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
      {/* slim toolbar — no page-header chrome, no explanatory paragraph */}
      <div className="flex items-center justify-between gap-3">
        <Breadcrumb divedSourceName={divedSource?.name ?? null} onRoot={() => popTo(0)} count={nodes.length} />
        <div className="flex items-center gap-2">
          {divedSource && (
            <>
              <Link
                to={`/sources/${divedSource.id}/control-room`}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/12 bg-white/4 px-3 text-xs font-semibold text-zinc-200 transition hover:border-white/24 hover:bg-white/8"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                控制室
              </Link>
              <Link
                to="/plans/new"
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/12 bg-white/4 px-3 text-xs font-semibold text-zinc-200 transition hover:border-white/24 hover:bg-white/8"
              >
                <Workflow className="h-3.5 w-3.5" />
                采集画布
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={refetchAll}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-white/12 bg-white/4 px-3 text-xs font-semibold text-zinc-200 hover:border-white/24 hover:bg-white/8"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            同步
          </button>
        </div>
      </div>

      {queryError && (
        <ErrorAlert error={queryError instanceof Error ? queryError : '采集网络数据同步失败。'} onRetry={refetchAll} />
      )}

      <div className="relative flex h-[74vh] min-h-[560px] overflow-hidden rounded-md border border-white/10 bg-black">
        {/* palette only makes sense at L0 root — a project's subnet (L1) is
         * derived read-only from that one source's real schedules/tasks/etc,
         * there is nothing new to "create" by dropping a channel type there. */}
        {!divedSourceId && <TopologyPalette onCreated={refetchAll} />}

        <div className="relative min-w-0 flex-1 pr-10">
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
              />
            </TopologyCanvasDropZone>
          )}
        </div>

        {/* slide-out panel, sits left of the rail */}
        {rightPanel && (
          <div
            key={rightPanel}
            className="m3-sheet-in absolute right-10 top-0 bottom-0 z-20 w-[380px] max-w-[calc(100%-2.5rem)] border-l border-white/10 bg-[#0a0a0a] shadow-[0_0_40px_rgba(0,0,0,0.5)]"
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
            ) : (
              <div className="grid h-full place-items-center px-6 text-center text-xs text-zinc-600">
                选中一个节点查看它的可操作项
              </div>
            )}
          </div>
        )}

        {/* always-on vertical tab rail (pull-out handles) */}
        <div className="absolute right-0 top-0 bottom-0 z-30 flex w-10 flex-col items-center gap-1 border-l border-white/10 bg-[#0b0c0e] py-3">
          <RailTab
            active={rightPanel === 'node'}
            disabled={!selectedNode}
            icon={SlidersHorizontal}
            label="节点操作"
            onClick={() => setRightPanel((p) => (p === 'node' ? null : 'node'))}
          />
          <div className="my-1 h-px w-5 bg-white/8" />
          <RailTab
            active={rightPanel === 'agent'}
            icon={Sparkles}
            label="AGENT 对话坞"
            onClick={() => setRightPanel((p) => (p === 'agent' ? null : 'agent'))}
          />
        </div>
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

function RailTab({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  icon: typeof Sparkles
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex w-full flex-col items-center gap-1.5 rounded-md py-2 transition',
        disabled
          ? 'cursor-not-allowed text-zinc-700'
          : active
            ? 'bg-sky-500/10 text-sky-200'
            : 'text-zinc-500 hover:bg-white/4 hover:text-zinc-200',
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="font-telemetry text-[10px] tracking-[0.12em] [writing-mode:vertical-rl]">{label}</span>
    </button>
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
    <div className="flex items-center gap-1.5 border border-white/8 bg-black/30 px-3 py-2 font-code text-[11px] text-zinc-400">
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
      <span className="ml-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500">
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
    <Card padding={false} className="flex h-full flex-col overflow-hidden border-0 bg-[#0a0a0a]">
      <div className="flex items-start gap-3 border-b border-white/8 px-4 py-4 pr-12">
        <div className="grid h-10 w-10 shrink-0 place-items-center border border-white/15 bg-white/4">
          <span className="font-code text-xs font-semibold text-zinc-200">{stageCode}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="telemetry-label">NODE · {node.data.kind}</p>
          <h2 className="mt-0.5 truncate text-lg font-semibold text-white" title={node.data.title}>
            {node.data.title}
          </h2>
          <p className="truncate text-xs text-zinc-500">{node.data.subtitle}</p>
        </div>
        <button
          type="button"
          aria-label="收起面板"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/12 bg-black/60 text-zinc-400 hover:border-white/[0.28] hover:text-white"
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
    healthy: '#00ac3a',
    active: '#47a8ff',
    warning: '#ffae00',
    failed: '#ff565f',
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
