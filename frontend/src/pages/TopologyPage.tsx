import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
} from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Bell,
  Bot,
  Calendar,
  CheckCircle2,
  CircleAlert,
  Database,
  FileText,
  ListChecks,
  Network,
  RefreshCw,
  Server,
  Workflow,
  Zap,
} from 'lucide-react'

import {
  listAgents,
  listNodes,
  listNotificationLogs,
  listNotificationRules,
  listRecords,
  listSchedules,
  listSources,
  listTasks,
  listWorkers,
} from '../api/endpoints'
import Card from '../components/Card'
import ErrorAlert from '../components/ErrorAlert'
import { PageLoader } from '../components/LoadingSpinner'
import PageHeader from '../components/PageHeader'
import {
  buildTopologyGraph,
  fallbackLayout,
  nodeId,
  type TopologyGraph,
  type TopologyHealth,
  type TopologyKind,
  type TopologyNodeData,
  type TopologySkillState,
} from '../lib/topologyModel'

type TopologyFlowNode = Node<TopologyNodeData, 'topologyNode'>
type TopologyFlowEdge = Edge<{ health: TopologyHealth }>

const nodeTypes = {
  topologyNode: TopologyNodeView,
}

type ElkLayoutEngine = {
  layout: (graph: {
    id: string
    layoutOptions?: Record<string, string>
    children?: Array<{ id: string; width: number; height: number }>
    edges?: Array<{ id: string; sources: string[]; targets: string[] }>
  }) => Promise<{ children?: Array<{ id: string; x?: number; y?: number }> }>
}

let elkEngine: ElkLayoutEngine | null = null

async function getElkEngine(): Promise<ElkLayoutEngine> {
  if (elkEngine) return elkEngine
  const module = await import('elkjs/lib/elk.bundled.js')
  elkEngine = new module.default() as ElkLayoutEngine
  return elkEngine
}

const KIND_LABELS: Record<TopologyKind, string> = {
  source: 'Source',
  schedule: 'Plan',
  task: 'Task',
  agent: 'Agent',
  record: 'Record',
  notification: 'Notify',
  'edge-node': 'Edge',
  worker: 'Worker',
}

const KIND_ICONS: Record<TopologyKind, typeof Database> = {
  source: Database,
  schedule: Calendar,
  task: ListChecks,
  agent: Bot,
  record: FileText,
  notification: Bell,
  'edge-node': Network,
  worker: Server,
}

export default function TopologyPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const sourceFilter = searchParams.get('source')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [layouted, setLayouted] = useState<{ nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] }>({
    nodes: [],
    edges: [],
  })

  const sourcesQuery = useQuery({
    queryKey: ['topology', 'sources'],
    queryFn: () => listSources({ limit: 100 }),
    refetchInterval: 30_000,
  })
  const tasksQuery = useQuery({
    queryKey: ['topology', 'tasks'],
    queryFn: () => listTasks({ limit: 100 }),
    refetchInterval: 10_000,
  })
  const schedulesQuery = useQuery({
    queryKey: ['topology', 'schedules'],
    queryFn: () => listSchedules(),
    refetchInterval: 30_000,
  })
  const agentsQuery = useQuery({
    queryKey: ['topology', 'agents'],
    queryFn: () => listAgents(),
    refetchInterval: 30_000,
  })
  const recordsQuery = useQuery({
    queryKey: ['topology', 'records'],
    queryFn: () => listRecords({ limit: 80 }),
    refetchInterval: 15_000,
  })
  const rulesQuery = useQuery({
    queryKey: ['topology', 'notification-rules'],
    queryFn: () => listNotificationRules(),
    refetchInterval: 30_000,
  })
  const logsQuery = useQuery({
    queryKey: ['topology', 'notification-logs'],
    queryFn: () => listNotificationLogs(),
    refetchInterval: 15_000,
  })
  const nodesQuery = useQuery({
    queryKey: ['topology', 'edge-nodes'],
    queryFn: () => listNodes(),
    refetchInterval: 10_000,
  })
  const workersQuery = useQuery({
    queryKey: ['topology', 'workers'],
    queryFn: () => listWorkers(),
    refetchInterval: 10_000,
  })

  const queries = [
    sourcesQuery,
    tasksQuery,
    schedulesQuery,
    agentsQuery,
    recordsQuery,
    rulesQuery,
    logsQuery,
    nodesQuery,
    workersQuery,
  ]
  const error = queries.find((query) => query.error)?.error
  const isInitialLoading = queries.some((query) => query.isLoading) && layouted.nodes.length === 0
  const isFetching = queries.some((query) => query.isFetching)

  const fullGraph = useMemo(
    () =>
      buildTopologyGraph({
        sources: sourcesQuery.data?.data ?? [],
        schedules: schedulesQuery.data?.data ?? [],
        tasks: tasksQuery.data?.data ?? [],
        agents: agentsQuery.data?.data ?? [],
        records: recordsQuery.data?.data ?? [],
        notificationRules: rulesQuery.data?.data ?? [],
        notificationLogs: logsQuery.data?.data ?? [],
        edgeNodes: nodesQuery.data?.data ?? [],
        workers: workersQuery.data?.data ?? [],
      }),
    [
      agentsQuery.data,
      logsQuery.data,
      nodesQuery.data,
      recordsQuery.data,
      rulesQuery.data,
      schedulesQuery.data,
      sourcesQuery.data,
      tasksQuery.data,
      workersQuery.data,
    ],
  )
  const graph = useMemo(
    () => filterTopologyGraphBySource(fullGraph, sourceFilter),
    [fullGraph, sourceFilter],
  )
  const focusedSource = useMemo(
    () => sourcesQuery.data?.data.find((source) => source.id === sourceFilter) ?? null,
    [sourceFilter, sourcesQuery.data],
  )

  useEffect(() => {
    let cancelled = false
    layoutGraph(graph).then((nextLayout) => {
      if (!cancelled) setLayouted(nextLayout)
    })
    return () => {
      cancelled = true
    }
  }, [graph])

  useEffect(() => {
    if (selectedNodeId && layouted.nodes.some((node) => node.id === selectedNodeId)) return
    const next = layouted.nodes.find((node) => node.data.health === 'failed')
      ?? layouted.nodes.find((node) => node.data.health === 'warning')
      ?? layouted.nodes[0]
    setSelectedNodeId(next?.id ?? null)
  }, [layouted.nodes, selectedNodeId])

  const selectedNode = layouted.nodes.find((node) => node.id === selectedNodeId) ?? null

  const refetchAll = () => {
    for (const query of queries) query.refetch()
  }

  if (isInitialLoading) return <PageLoader />
  if (error) return <ErrorAlert error={error as Error} onRetry={refetchAll} />

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('topology.title')}
        description={sourceFilter
          ? `按数据源聚焦：${focusedSource?.name ?? sourceFilter}`
          : t('topology.description')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {sourceFilter && (
              <Link
                to="/topology"
                className="inline-flex items-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-300/20 dark:text-cyan-200"
              >
                清除聚焦
              </Link>
            )}
            <button
              onClick={refetchAll}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              {t('topology.refresh')}
            </button>
          </div>
        }
      />

      <TopologySummary graph={graph} isFetching={isFetching} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card padding={false} className="overflow-hidden">
          <div className="h-[calc(100vh-270px)] min-h-[620px] bg-slate-950">
            <ReactFlow
              nodes={layouted.nodes}
              edges={layouted.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.3}
              maxZoom={1.4}
              nodesDraggable
              nodesFocusable
              edgesFocusable
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
            >
              <Background color="#334155" gap={22} />
              <Controls position="bottom-left" />
              <MiniMap
                position="bottom-right"
                nodeColor={(node) => healthColor((node.data as TopologyNodeData).health, 'mini')}
                maskColor="rgba(2, 6, 23, 0.72)"
                pannable
                zoomable
              />
              <Panel position="top-left">
                <div className="rounded-md border border-white/10 bg-slate-950/90 px-3 py-2 text-xs text-slate-300 shadow-lg">
                  <span className="font-mono text-slate-500">Ctrl/⌘ K</span>
                  <span className="ml-2">{t('topology.quickJump')}</span>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        </Card>

        <NodeInspector node={selectedNode} />
      </div>
    </div>
  )
}

function TopologyNodeView({ data, selected }: NodeProps<TopologyFlowNode>) {
  const Icon = KIND_ICONS[data.kind]
  const stateLabel = healthLabel(data.health)

  return (
    <div
      className={[
        'relative w-[258px] rounded-lg border bg-slate-900 px-3 py-3 text-left shadow-lg transition',
        selected ? 'border-cyan-300 ring-2 ring-cyan-300/30' : 'border-slate-700',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-slate-950" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-slate-950" />
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${healthSoftClass(data.health)}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {KIND_LABELS[data.kind]}
            </span>
            <span className={`h-2 w-2 rounded-full ${healthDotClass(data.health)}`} title={stateLabel} />
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-white" title={data.title}>
            {data.title}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-400" title={data.subtitle}>
            {data.subtitle}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[stateLabel, ...data.badges].slice(0, 4).map((badge) => (
          <span
            key={badge}
            className="max-w-[98px] truncate rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-300"
            title={badge}
          >
            {badge}
          </span>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-white/10 pt-3">
        {data.skills.slice(0, 3).map((item) => (
          <span
            key={item.id}
            className={`truncate border px-1.5 py-1 text-center text-[10px] font-semibold ${skillChipClass(item.state)}`}
            title={`${item.label}: ${item.description}`}
          >
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function TopologySummary({ graph, isFetching }: { graph: TopologyGraph; isFetching: boolean }) {
  const { t } = useTranslation()
  const items = [
    { id: 'all', label: t('topology.allNodes'), value: graph.summary.total, icon: Workflow, tone: 'text-cyan-300' },
    { id: 'running', label: t('topology.running'), value: graph.summary.active, icon: Zap, tone: 'text-blue-300' },
    { id: 'focus', label: t('topology.needsFocus'), value: graph.summary.failed + graph.summary.warning, icon: CircleAlert, tone: 'text-amber-300' },
    { id: 'ready', label: t('topology.ready'), value: graph.summary.total - graph.summary.failed - graph.summary.warning - graph.summary.disabled, icon: CheckCircle2, tone: 'text-emerald-300' },
    { id: 'skills', label: 'Missing skills', value: graph.summary.skills.missing + graph.summary.skills.blocked, icon: CircleAlert, tone: 'text-red-300' },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-5">
      {items.map(({ id, label, value, icon: Icon, tone }) => (
        <Card key={id} className="border-gray-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{value}</p>
            </div>
            <Icon className={`h-5 w-5 ${tone}`} />
          </div>
          {id === 'all' && (
            <p className="mt-3 text-xs text-gray-400">
              {isFetching ? t('topology.refreshing') : t('topology.edgeCount', { count: graph.edges.length })}
            </p>
          )}
        </Card>
      ))}
    </div>
  )
}

function NodeInspector({ node }: { node: TopologyFlowNode | null }) {
  const { t } = useTranslation()

  if (!node) {
    return (
      <Card className="h-full border-dashed dark:border-slate-700">
        <div className="flex h-full min-h-[260px] items-center justify-center text-center text-sm text-gray-500 dark:text-slate-400">
          {t('topology.selectNode')}
        </div>
      </Card>
    )
  }

  const entries = Object.entries(node.data.detail).filter(([, value]) => value != null && value !== '')
  const missingSkills = node.data.skills.filter((item) => item.state === 'missing' || item.state === 'blocked')
  const readySkills = node.data.skills.filter((item) => item.state === 'ready' || item.state === 'running')

  return (
    <Card className="h-full dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-4 dark:border-slate-800">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{KIND_LABELS[node.data.kind]}</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-gray-900 dark:text-white">{node.data.title}</h2>
          <p className="mt-1 truncate text-sm text-gray-500 dark:text-slate-400">{node.data.subtitle}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${healthPillClass(node.data.health)}`}>
          {healthLabel(node.data.health)}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {node.data.badges.map((badge) => (
          <span
            key={badge}
            className="mr-1.5 inline-flex rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 dark:border-slate-700 dark:text-slate-300"
          >
            {badge}
          </span>
        ))}
      </div>

      <section className="mt-5 border border-slate-800 bg-slate-950/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Skill Matrix</p>
            <p className="mt-1 text-xs text-slate-400">
              {readySkills.length} ready · {missingSkills.length} missing
            </p>
          </div>
          <span className={`shrink-0 border px-2 py-1 text-[10px] font-semibold uppercase ${missingSkills.length > 0 ? 'border-amber-400/35 bg-amber-400/10 text-amber-200' : 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'}`}>
            {missingSkills.length > 0 ? 'Needs skill' : 'Ready'}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {node.data.skills.map((item) => (
            <div key={item.id} className="grid gap-2 border border-white/10 bg-black/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-slate-200">{item.label}</span>
                <span className={`shrink-0 border px-1.5 py-0.5 text-[10px] uppercase ${skillChipClass(item.state)}`}>
                  {item.state}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">{item.description}</p>
              {(item.state === 'missing' || item.state === 'blocked') && item.targetPath && (
                <Link
                  to={item.targetPath}
                  className="inline-flex w-fit items-center justify-center border border-cyan-300/35 bg-cyan-300/10 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-300/20"
                >
                  补齐能力
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <dl className="mt-5 space-y-3">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{key}</dt>
            <dd className="mt-1 break-words font-mono text-xs text-gray-700 dark:text-slate-300">
              {formatDetailValue(value)}
            </dd>
          </div>
        ))}
      </dl>

      {node.data.targetPath && (
        <Link
          to={node.data.targetPath}
          className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        >
          {t('topology.openDetail')}
        </Link>
      )}
    </Card>
  )
}

async function layoutGraph(graph: TopologyGraph): Promise<{ nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] }> {
  const fallback = fallbackLayout(graph)
  try {
    const elk = await getElkEngine()
    const result = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '64',
        'elk.layered.spacing.nodeNodeBetweenLayers': '92',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children: graph.nodes.map((node) => ({
        id: node.id,
        width: 258,
        height: 146,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    })
    const positions = new Map(
      (result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
    )
    return toFlowElements(graph, positions)
  } catch {
    return toFlowElements(graph, new Map(fallback.map((node) => [node.id, node.position])))
  }
}

function toFlowElements(graph: TopologyGraph, positions: Map<string, { x: number; y: number }>) {
  const nodes: TopologyFlowNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'topologyNode',
    position: positions.get(node.id) ?? { x: node.column * 300, y: node.row * 170 },
    data: node.data,
  }))
  const edges: TopologyFlowEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: { health: edge.health },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: healthColor(edge.health, 'line'),
    },
    style: {
      stroke: healthColor(edge.health, 'line'),
      strokeWidth: edge.health === 'failed' ? 2.4 : 1.6,
      strokeDasharray: edge.health === 'unknown' ? '5 5' : undefined,
    },
    labelStyle: {
      fill: '#94a3b8',
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: '#020617',
      fillOpacity: 0.85,
    },
  }))
  return { nodes, edges }
}

function filterTopologyGraphBySource(graph: TopologyGraph, sourceId: string | null): TopologyGraph {
  if (!sourceId) return graph

  const sourceNodeId = nodeId('source', sourceId)
  const related = new Set(
    graph.nodes
      .filter((node) =>
        node.id === sourceNodeId
        || node.data.detail.source_id === sourceId
        || (node.data.kind === 'source' && node.data.detail.id === sourceId),
      )
      .map((node) => node.id),
  )
  const expandableLabels = new Set(['plans', 'triggers', 'collects', 'notifies', 'enriches', 'writes', 'sent', 'acked'])

  let changed = true
  while (changed) {
    changed = false
    for (const edge of graph.edges) {
      if (!expandableLabels.has(edge.label ?? '')) continue
      if (related.has(edge.source) && !related.has(edge.target)) {
        related.add(edge.target)
        changed = true
      }
      if ((edge.label === 'writes' || edge.label === 'sent' || edge.label === 'acked') && related.has(edge.target) && !related.has(edge.source)) {
        related.add(edge.source)
        changed = true
      }
    }
  }

  const nodes = graph.nodes.filter((node) => related.has(node.id))
  const edges = graph.edges.filter((edge) => related.has(edge.source) && related.has(edge.target))
  return {
    nodes,
    edges,
    summary: nodes.reduce(
      (acc, node) => ({
        total: acc.total + 1,
        failed: acc.failed + (node.data.health === 'failed' ? 1 : 0),
        warning: acc.warning + (node.data.health === 'warning' ? 1 : 0),
        active: acc.active + (node.data.health === 'active' ? 1 : 0),
        disabled: acc.disabled + (node.data.health === 'disabled' ? 1 : 0),
        skills: node.data.skills.reduce(
          (skills, item) => ({
            total: skills.total + 1,
            ready: skills.ready + (item.state === 'ready' ? 1 : 0),
            running: skills.running + (item.state === 'running' ? 1 : 0),
            missing: skills.missing + (item.state === 'missing' ? 1 : 0),
            blocked: skills.blocked + (item.state === 'blocked' ? 1 : 0),
          }),
          acc.skills,
        ),
      }),
      {
        total: 0,
        failed: 0,
        warning: 0,
        active: 0,
        disabled: 0,
        skills: { total: 0, ready: 0, running: 0, missing: 0, blocked: 0 },
      },
    ),
  }
}

function healthLabel(health: TopologyHealth) {
  const labels: Record<TopologyHealth, string> = {
    healthy: 'healthy',
    active: 'running',
    warning: 'attention',
    failed: 'failed',
    disabled: 'disabled',
    unknown: 'unknown',
  }
  return labels[health]
}

function healthColor(health: TopologyHealth, context: 'line' | 'mini') {
  const colors: Record<TopologyHealth, string> = {
    healthy: context === 'line' ? '#22c55e' : '#16a34a',
    active: '#38bdf8',
    warning: '#f59e0b',
    failed: '#ef4444',
    disabled: '#64748b',
    unknown: '#94a3b8',
  }
  return colors[health]
}

function healthDotClass(health: TopologyHealth) {
  const classes: Record<TopologyHealth, string> = {
    healthy: 'bg-emerald-400',
    active: 'bg-sky-400',
    warning: 'bg-amber-400',
    failed: 'bg-red-400',
    disabled: 'bg-slate-500',
    unknown: 'bg-slate-300',
  }
  return classes[health]
}

function skillChipClass(state: TopologySkillState) {
  const classes: Record<TopologySkillState, string> = {
    ready: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    running: 'border-sky-400/35 bg-sky-400/10 text-sky-200',
    missing: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
    blocked: 'border-red-400/35 bg-red-400/10 text-red-200',
  }
  return classes[state]
}

function healthSoftClass(health: TopologyHealth) {
  const classes: Record<TopologyHealth, string> = {
    healthy: 'bg-emerald-400/15 text-emerald-300',
    active: 'bg-sky-400/15 text-sky-300',
    warning: 'bg-amber-400/15 text-amber-300',
    failed: 'bg-red-400/15 text-red-300',
    disabled: 'bg-slate-400/15 text-slate-300',
    unknown: 'bg-slate-400/15 text-slate-300',
  }
  return classes[health]
}

function healthPillClass(health: TopologyHealth) {
  const classes: Record<TopologyHealth, string> = {
    healthy: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
    active: 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
    failed: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300',
    disabled: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
    unknown: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
  }
  return classes[health]
}

function formatDetailValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}
