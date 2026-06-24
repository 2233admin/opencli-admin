import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
  SlidersHorizontal,
  Zap,
  type LucideIcon,
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
import {
  listExecutableNodeActions,
  runNodeAction,
  type NodeActionRunRequest,
} from '../lib/nodeActions'

type TopologyMode = 'flow' | 'health' | 'skills'

type TopologyFlowNode = Node<TopologyNodeData, 'topologyNode'>
type TopologyFlowEdge = Edge<{ health: TopologyHealth }>
type TopologyActionState = 'loading' | 'ok' | 'err'

const actionStateKey = (nodeId: string, actionId: string) => `${nodeId}:${actionId}`
const TOPOLOGY_NODE_WIDTH = 252
const TOPOLOGY_NODE_HEIGHT = 220
const TOPOLOGY_COLUMN_GAP = 304
const TOPOLOGY_ROW_GAP = 252

interface TopologyRunActionPayload extends Omit<NodeActionRunRequest, 'payload'> {
  nodeKind: string
  actionId: string
  entityId: string
  nodeUiId: string
  payload?: Record<string, unknown>
}

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

const KIND_LABEL_KEYS: Record<TopologyKind, string> = {
  source: 'topology.kinds.source',
  schedule: 'topology.kinds.schedule',
  task: 'topology.kinds.task',
  agent: 'topology.kinds.agent',
  record: 'topology.kinds.record',
  notification: 'topology.kinds.notification',
  'edge-node': 'topology.kinds.edgeNode',
  worker: 'topology.kinds.worker',
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
  const [viewMode, setViewMode] = useState<TopologyMode>('flow')
  const [actionStates, setActionStates] = useState<Record<string, TopologyActionState>>({})
  const [layouted, setLayouted] = useState<{ nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] }>({
    nodes: [],
    edges: [],
  })
  const qc = useQueryClient()

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
    () => deriveTopologyGraph(fullGraph, sourceFilter, viewMode),
    [fullGraph, sourceFilter, viewMode],
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

  const runActionMut = useMutation({
    mutationFn: ({ nodeKind, entityId, actionId, payload }: TopologyRunActionPayload) =>
      runNodeAction({ actionId, nodeKind, entityId, payload }),
    onMutate: ({ nodeUiId, actionId }) => {
      const key = actionStateKey(nodeUiId, actionId)
      setActionStates((state) => ({ ...state, [key]: 'loading' }))
    },
    onSuccess: (result, { nodeUiId, actionId }) => {
      const key = actionStateKey(nodeUiId, actionId)
      if (result.ok) {
        setActionStates((state) => ({ ...state, [key]: 'ok' }))
        qc.invalidateQueries({ queryKey: ['topology'] })
        toast.success(result.message)
      } else {
        setActionStates((state) => ({ ...state, [key]: 'err' }))
        toast.error(result.message)
      }
      setTimeout(() => {
        setActionStates((state) => {
          const next = { ...state }
          delete next[key]
          return next
        })
      }, 2200)
    },
    onError: (_error, { nodeUiId, actionId }) => {
      const key = actionStateKey(nodeUiId, actionId)
      setActionStates((state) => ({ ...state, [key]: 'err' }))
      setTimeout(() => {
        setActionStates((state) => {
          const next = { ...state }
          delete next[key]
          return next
        })
      }, 2600)
      toast.error(_error instanceof Error ? _error.message : t('topology.errors.actionFailed'))
    },
  })

  const runNodeKindAction = (node: TopologyFlowNode, actionId?: string) => {
    const executable = listExecutableNodeActions(node.data.kind)
    const targetAction = executable.find((item) => item.id === actionId) ?? executable[0]
    if (!targetAction) {
      toast.error(t('topology.errors.noExecutableAction'))
      return
    }
    const action = node.data.actions.find((candidate) => candidate.id === targetAction.id)
    if (!action || !action.enabled) {
      toast.error(t('topology.errors.actionUnavailable'))
      return
    }
    runActionMut.mutate({
      nodeKind: node.data.kind,
      entityId: String(node.data.detail.id ?? node.id),
      nodeUiId: node.id,
      actionId: targetAction.id,
    })
  }

  if (isInitialLoading) return <PageLoader />
  if (error) return <ErrorAlert error={error as Error} onRetry={refetchAll} />

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('topology.title')}
        description={sourceFilter
          ? t('topology.focusDescription', { name: focusedSource?.name ?? sourceFilter })
          : t('topology.description')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <TopologyModeSwitcher mode={viewMode} onChange={setViewMode} />
            {sourceFilter && (
              <Link
                to="/topology"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-white/[0.12] bg-white/[0.03] px-3 text-sm font-medium text-zinc-200 hover:border-white/[0.24] hover:bg-white/[0.06]"
              >
                {t('topology.clearFocus')}
              </Link>
            )}
            <button
              onClick={refetchAll}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-blue-500/[0.45] bg-blue-500/[0.15] px-3 text-sm font-medium text-blue-100 hover:border-blue-400/[0.7] hover:bg-blue-500/[0.2]"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              {t('topology.refresh')}
            </button>
          </div>
        }
      />

      <TopologyOperations
        graph={graph}
        isFetching={isFetching}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onSetMode={setViewMode}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card padding={false} className="overflow-hidden">
          <div className="h-[calc(100vh-270px)] min-h-[620px] bg-black">
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
              <Background color="rgba(255,255,255,0.08)" gap={32} />
              <Controls position="bottom-left" />
              <MiniMap
                position="bottom-right"
                nodeColor={(node) => healthColor((node.data as TopologyNodeData).health, 'mini')}
                maskColor="rgba(0, 0, 0, 0.72)"
                style={{ backgroundColor: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)' }}
                pannable
                zoomable
              />
              <Panel position="top-left">
                <div className="rounded-md border border-white/10 bg-black/90 px-3 py-2 text-xs text-zinc-300 shadow-lg">
                  <span className="font-mono text-zinc-500">Ctrl/⌘ K</span>
                  <span className="ml-2">{t('topology.quickJump')}</span>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        </Card>

        <NodeInspector
          node={selectedNode}
          actionStates={actionStates}
          onRunAction={runNodeKindAction}
        />
      </div>
    </div>
  )
}

function TopologyNodeView({ data, selected }: NodeProps<TopologyFlowNode>) {
  const { t } = useTranslation()
  const Icon = KIND_ICONS[data.kind]
  const stateLabel = healthLabel(t, data.health)

  return (
    <div
      className={[
        'relative w-[252px] rounded-md border bg-[#0a0a0a] px-3 py-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.16)] transition',
        selected ? 'border-blue-500 ring-2 ring-blue-500/[0.25]' : 'border-white/[0.12]',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-black" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-black" />
      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${healthSoftClass(data.health)}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {kindLabel(t, data.kind)}
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
            className="max-w-[104px] truncate rounded-sm border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-300"
            title={badge}
          >
            {badge}
          </span>
        ))}
      </div>
      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="grid grid-cols-3 gap-1.5">
          {data.skills.slice(0, 3).map((item) => (
            <span
              key={item.id}
              className={`truncate rounded-sm border px-1.5 py-1 text-center text-[10px] font-semibold ${skillChipClass(item.state)}`}
              title={`${item.label}: ${item.description}`}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function TopologySummary({ graph, isFetching }: { graph: TopologyGraph; isFetching: boolean }) {
  const { t } = useTranslation()
  const items = [
    { id: 'all', label: t('topology.allNodes'), value: graph.summary.total, icon: Workflow, tone: 'text-blue-300' },
    { id: 'running', label: t('topology.running'), value: graph.summary.active, icon: Zap, tone: 'text-blue-300' },
    { id: 'focus', label: t('topology.needsFocus'), value: graph.summary.failed + graph.summary.warning, icon: CircleAlert, tone: 'text-amber-300' },
    { id: 'ready', label: t('topology.ready'), value: graph.summary.total - graph.summary.failed - graph.summary.warning - graph.summary.disabled, icon: CheckCircle2, tone: 'text-emerald-300' },
    { id: 'skills', label: t('topology.missingSkills'), value: graph.summary.skills.missing + graph.summary.skills.blocked, icon: CircleAlert, tone: 'text-red-300' },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-5">
      {items.map(({ id, label, value, icon: Icon, tone }) => (
        <Card key={id} className="border-white/[0.1] bg-[#0a0a0a]">
          <div className="flex items-center justify-between">
            <div>
              <p className="telemetry-label">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-50">{value}</p>
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

function TopologyOperations({
  graph,
  isFetching,
  selectedNodeId,
  onSelectNode,
  onSetMode,
}: {
  graph: TopologyGraph
  isFetching: boolean
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onSetMode: (mode: TopologyMode) => void
}) {
  const { t } = useTranslation()
  const attentionNodes = graph.nodes.filter((node) => (
    node.data.health === 'failed' || node.data.health === 'warning'
  ))
  const runningNodes = graph.nodes.filter((node) => node.data.health === 'active')
  const skillGapNodes = graph.nodes.filter((node) => (
    node.data.skills.some((item) => item.state === 'missing' || item.state === 'blocked')
  ))
  const actionReadyNodes = graph.nodes.filter((node) => node.data.actions.some((action) => action.enabled))
  const priorityNodes = [
    ...attentionNodes,
    ...runningNodes,
    ...skillGapNodes,
    ...actionReadyNodes,
  ].filter((node, index, nodes) => nodes.findIndex((item) => item.id === node.id) === index).slice(0, 6)

  const cards: Array<{
    id: string
    label: string
    value: number
    hint: string
    icon: LucideIcon
    tone: string
    mode: TopologyMode
  }> = [
    {
      id: 'attention',
      label: '需要处理',
      value: attentionNodes.length,
      hint: '失败、警告节点优先看',
      icon: CircleAlert,
      tone: 'border-amber-400/35 bg-amber-400/10 text-amber-100',
      mode: 'health',
    },
    {
      id: 'running',
      label: '运行中',
      value: runningNodes.length,
      hint: '正在采集或执行',
      icon: Zap,
      tone: 'border-sky-400/35 bg-sky-400/10 text-sky-100',
      mode: 'health',
    },
    {
      id: 'skills',
      label: '能力缺口',
      value: skillGapNodes.length,
      hint: '缺配置、缺节点、阻塞项',
      icon: Network,
      tone: 'border-red-400/35 bg-red-400/10 text-red-100',
      mode: 'skills',
    },
    {
      id: 'actions',
      label: '可执行动作',
      value: actionReadyNodes.length,
      hint: '可触发、可补全、可跳转',
      icon: ListChecks,
      tone: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-100',
      mode: 'flow',
    },
  ]

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="border-b border-white/10 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="telemetry-label">OPERATIONS QUEUE</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-100">先处理工作，再打开诊断画布</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">
              拓扑页现在先回答“哪里需要人介入”，画布负责解释关系和定位根因。
            </p>
          </div>
          <div className="shrink-0 border border-white/10 bg-black/25 px-3 py-2 text-xs text-zinc-500">
            {isFetching ? t('topology.refreshing') : t('topology.edgeCount', { count: graph.edges.length })}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onSetMode(card.mode)}
                className="group min-h-28 border border-white/10 bg-black/20 p-3 text-left transition-colors hover:border-primary-500/45 hover:bg-white/[0.04]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center border ${card.tone}`}>
                    <Icon size={16} />
                  </span>
                  <span className="font-code text-2xl text-zinc-50">{card.value}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-zinc-100">{card.label}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{card.hint}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="telemetry-label">NEXT NODES</p>
          <span className="font-code text-[11px] text-zinc-600">{graph.summary.total} nodes</span>
        </div>
        {priorityNodes.length === 0 ? (
          <div className="mt-3 border border-dashed border-white/12 bg-black/20 px-4 py-6 text-sm text-zinc-500">
            当前没有需要优先处理的拓扑节点。
          </div>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {priorityNodes.map((node) => {
              const Icon = KIND_ICONS[node.data.kind]
              const missingCount = node.data.skills.filter((item) => item.state === 'missing' || item.state === 'blocked').length
              return (
                <button
                  key={node.id}
                  type="button"
                  data-active={selectedNodeId === node.id}
                  onClick={() => onSelectNode(node.id)}
                  className="min-w-0 border border-white/10 bg-black/20 p-3 text-left transition-colors hover:border-primary-500/45 hover:bg-white/[0.04] data-[active=true]:border-primary-500/65 data-[active=true]:bg-primary-500/[0.075]"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center border ${healthSoftClass(node.data.health)}`}>
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${healthDotClass(node.data.health)}`} />
                        <p className="truncate text-sm font-semibold text-zinc-100">{node.data.title}</p>
                      </div>
                      <p className="mt-1 truncate text-xs text-zinc-500">{node.data.subtitle}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="border border-white/10 bg-white/[0.035] px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {kindLabel(t, node.data.kind)}
                        </span>
                        <span className="border border-white/10 bg-white/[0.035] px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {healthLabel(t, node.data.health)}
                        </span>
                        {missingCount > 0 && (
                          <span className="border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[10px] uppercase text-red-100">
                            {missingCount} gaps
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

function TopologyModeSwitcher({
  mode,
  onChange,
}: {
  mode: TopologyMode
  onChange: (mode: TopologyMode) => void
}) {
  const { t } = useTranslation()
  const items = [
    { mode: 'flow', label: t('topology.modes.flow'), icon: SlidersHorizontal },
    { mode: 'health', label: t('topology.modes.health'), icon: CircleAlert },
    { mode: 'skills', label: t('topology.modes.skills'), icon: CircleAlert },
  ] as const

  return (
    <div className="inline-flex h-10 overflow-hidden rounded-md border border-white/[0.12] bg-white/[0.03]">
      {items.map(({ mode: itemMode, label, icon: Icon }) => (
        <button
          key={itemMode}
          onClick={() => onChange(itemMode)}
          className={`flex items-center gap-2 px-3 text-xs font-semibold transition ${
            itemMode === mode
              ? 'bg-zinc-100 text-black'
              : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

function NodeInspector({
  node,
  actionStates,
  onRunAction,
}: {
  node: TopologyFlowNode | null
  actionStates: Record<string, TopologyActionState>
  onRunAction: (node: TopologyFlowNode, actionId?: string) => void
}) {
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
    <Card className="h-full border-white/[0.1] bg-[#0a0a0a]">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="min-w-0">
          <p className="telemetry-label">{kindLabel(t, node.data.kind)}</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-zinc-50">{node.data.title}</h2>
          <p className="mt-1 truncate text-sm text-zinc-400">{node.data.subtitle}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${healthPillClass(node.data.health)}`}>
          {healthLabel(t, node.data.health)}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {node.data.badges.map((badge) => (
          <span
            key={badge}
            className="mr-1.5 inline-flex rounded-md border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-xs text-zinc-300"
          >
            {badge}
          </span>
        ))}
      </div>

      <section className="mt-5 rounded-md border border-white/[0.1] bg-black/35 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="telemetry-label">{t('topology.inspector.skillMatrix')}</p>
            <p className="mt-1 text-xs text-slate-400">
              {t('topology.inspector.skillSummary', { ready: readySkills.length, missing: missingSkills.length })}
            </p>
          </div>
          <span
            className={`shrink-0 border px-2 py-1 text-[10px] font-semibold uppercase ${missingSkills.length > 0 ? 'border-amber-400/35 bg-amber-400/10 text-amber-200' : 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'}`}
          >
            {missingSkills.length > 0 ? t('topology.inspector.needsSkill') : t('topology.inspector.ready')}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {node.data.skills.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-md border border-white/[0.1] bg-white/[0.025] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-slate-200">{item.label}</span>
                <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase ${skillChipClass(item.state)}`}>
                  {item.state}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">{item.description}</p>
              {(item.state === 'missing' || item.state === 'blocked') && item.targetPath && (
                <Link
                  to={item.targetPath}
                  className="inline-flex w-fit items-center justify-center rounded-md border border-blue-400/[0.35] bg-blue-500/[0.12] px-2 py-1 text-[11px] font-semibold text-blue-100 hover:bg-blue-500/[0.18]"
                >
                  {t('topology.inspector.completeCapability')}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {node.data.actions.length > 0 && (
        <section className="mt-5 rounded-md border border-white/[0.1] bg-black/30 p-3">
          <p className="telemetry-label">{t('topology.inspector.actions')}</p>
          <div className="mt-3 space-y-2">
            {node.data.actions.map((action) => {
              const state = actionStates[actionStateKey(node.id, action.id)]
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => onRunAction(node, action.id)}
                  disabled={!!state || !action.enabled}
                  className="inline-flex w-full items-center justify-between rounded-md border border-white/[0.12] px-2.5 py-2 text-xs transition hover:border-white/[0.3] hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="truncate">{action.label}</span>
                  {state === 'loading' ? (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : state === 'ok' ? (
                    t('topology.inspector.done')
                  ) : state === 'err' ? (
                    t('topology.inspector.failed')
                  ) : (
                    <span className="font-medium text-slate-300">{t('topology.inspector.run')}</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}

      <dl className="mt-5 space-y-3">
        <dt className="telemetry-label">{t('topology.inspector.detail')}</dt>
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{key}</dt>
            <dd className="mt-1 break-words font-mono text-xs text-gray-700 dark:text-slate-300">
              {formatDetailValue(value)}
            </dd>
          </div>
        ))}
      </dl>

      {node.data.targetPath && (
        <Link
          to={node.data.targetPath}
          className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-100 px-3 text-sm font-semibold text-black hover:bg-white"
        >
          {t('topology.openDetail')}
        </Link>
      )}
    </Card>
  )
}

async function layoutGraph(graph: TopologyGraph): Promise<{ nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] }> {
  const fallback = fallbackLayout(graph, TOPOLOGY_COLUMN_GAP, TOPOLOGY_ROW_GAP)
  try {
    const elk = await getElkEngine()
    const result = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '96',
        'elk.layered.spacing.nodeNodeBetweenLayers': '108',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      },
      children: graph.nodes.map((node) => ({
        id: node.id,
        width: TOPOLOGY_NODE_WIDTH,
        height: TOPOLOGY_NODE_HEIGHT,
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
    position: positions.get(node.id) ?? { x: node.column * TOPOLOGY_COLUMN_GAP, y: node.row * TOPOLOGY_ROW_GAP },
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
      fill: '#a0a0a0',
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: '#000000',
      fillOpacity: 0.85,
    },
  }))
  return { nodes, edges }
}

function deriveTopologyGraph(graph: TopologyGraph, sourceId: string | null, mode: TopologyMode): TopologyGraph {
  const hasSourceFilter = Boolean(sourceId)
  const base = hasSourceFilter ? focusTopologyGraphBySource(graph, sourceId) : graph

  if (mode === 'health') {
    const nodes = base.nodes.filter((node) => node.data.health === 'failed' || node.data.health === 'warning' || node.data.health === 'active')
    return summarizeTopologyGraph(expandWithNeighbors(base, nodes.map((node) => node.id)))
  }

  if (mode === 'skills') {
    const nodes = base.nodes.filter(
      (node) =>
        node.data.skills.some((item) => item.state === 'missing' || item.state === 'blocked'),
    )
    return summarizeTopologyGraph(expandWithNeighbors(base, nodes.map((node) => node.id)))
  }

  return summarizeTopologyGraph(base)
}

function focusTopologyGraphBySource(graph: TopologyGraph, sourceId: string | null): TopologyGraph {
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
  return summarizeTopologyGraph({ nodes, edges, summary: graph.summary })
}

function expandWithNeighbors(graph: TopologyGraph, nodeIds: string[]) {
  const related = new Set(nodeIds)
  for (const edge of graph.edges) {
    if (related.has(edge.source)) related.add(edge.target)
    if (related.has(edge.target)) related.add(edge.source)
  }
  const nodes = graph.nodes.filter((node) => related.has(node.id))
  const edges = graph.edges.filter((edge) => related.has(edge.source) && related.has(edge.target))
  return summarizeTopologyGraph({ nodes, edges, summary: graph.summary })
}

function summarizeTopologyGraph(graph: TopologyGraph) {
  return {
    ...graph,
    summary: graph.nodes.reduce(
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
      { total: 0, failed: 0, warning: 0, active: 0, disabled: 0, skills: { total: 0, ready: 0, running: 0, missing: 0, blocked: 0 } },
    ),
  }
}

function kindLabel(t: TFunction, kind: TopologyKind) {
  return t(KIND_LABEL_KEYS[kind])
}

function healthLabel(t: TFunction, health: TopologyHealth) {
  return t(`topology.health.${health}`)
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

function healthColor(health: TopologyHealth, context: 'line' | 'mini') {
  const colors: Record<TopologyHealth, string> = {
    healthy: context === 'line' ? '#00ac3a' : '#009432',
    active: '#47a8ff',
    warning: '#ffae00',
    failed: '#ff565f',
    disabled: '#64748b',
    unknown: '#a0a0a0',
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
