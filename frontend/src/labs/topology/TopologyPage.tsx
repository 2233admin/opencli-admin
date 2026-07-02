import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import ReactGridLayout, { useContainerWidth, type Layout } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Calendar,
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  FileJson,
  ListChecks,
  Network,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  SlidersHorizontal,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

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
} from '../../api/endpoints'
import Card from '../../components/Card'
import ErrorAlert from '../../components/ErrorAlert'
import PageHeader from '../../components/PageHeader'
import { OperatorCard, WorkbenchPanel } from '../../components/opencli'
import type { OperatorTone } from '../../components/opencli'
import { ReactFlowTopologyCanvas } from './ReactFlowTopologyCanvas'
import { StageOperationPanel, type StageDataBundle } from './nodes/StageOperations'
import {
  fallbackLayout,
  type TopologyGraph,
  type TopologyHealth,
  type TopologyKind,
  type TopologyNodeAction,
  type TopologyNodeData,
  type TopologySkill,
  type TopologySkillState,
} from './topologyModel'
import { cn } from '../../lib/utils'

type TopologyFlowNode = Node<TopologyNodeData>
type TopologyFlowEdge = Edge<{ health: TopologyHealth }>

interface PrototypeStats {
  sources: number
  schedules: number
  tasks: number
  agents: number
  records: number
  notificationRules: number
  notificationLogs: number
  edgeNodes: number
  workers: number
}

interface PipelineNodeDefinition {
  id: string
  kind: TopologyKind
  title: string
  subtitle: string
  health: TopologyHealth
  badges: string[]
  responsibility: string
  status: string
  gap: string
  primaryAction: string
  targetPath: string
  stageCode: string
  column: number
  row: number
  skills: TopologySkill[]
  telemetry: string
  configEntries: Array<{ label: string; to: string; hint: string }>
}

interface SurfaceEvent {
  id: string
  time: string
  stage: string
  level: 'info' | 'warning' | 'error'
  message: string
}

interface DiagnosisItem {
  id: string
  title: string
  detail: string
  severity: 'ok' | 'warning' | 'error'
}

interface PrototypeActionQueueItem {
  id: string
  nodeId: string
  nodeTitle: string
  actionLabel: string
  createdAt: string
}

const LIVE_SURFACE_LAYOUT_STORAGE_KEY = 'opencli.topology.pipelineSurfaceLayout.v1'

const DEFAULT_LIVE_SURFACE_LAYOUT: Layout = [
  { i: 'events', x: 0, y: 0, w: 5, h: 9, minW: 4, minH: 6 },
  { i: 'render', x: 5, y: 0, w: 7, h: 9, minW: 4, minH: 6 },
  { i: 'records', x: 0, y: 9, w: 6, h: 8, minW: 4, minH: 5 },
  { i: 'diagnosis', x: 6, y: 9, w: 6, h: 8, minW: 4, minH: 5 },
]

const PIPELINE_EVENTS: SurfaceEvent[] = [
  {
    id: 'evt-001',
    time: '10:42:15',
    stage: '入口配置',
    level: 'info',
    message: '收到数据入口样本，等待字段契约确认。',
  },
  {
    id: 'evt-002',
    time: '10:42:19',
    stage: '触发计划',
    level: 'info',
    message: '手动触发窗口已打开，下一次计划触发为 15 分钟后。',
  },
  {
    id: 'evt-003',
    time: '10:42:26',
    stage: '采集运行',
    level: 'info',
    message: '浏览器 worker 已接管渲染任务，页面状态为 collecting。',
  },
  {
    id: 'evt-004',
    time: '10:42:38',
    stage: '处理器',
    level: 'warning',
    message: '归一化 schema 缺少 price_delta 字段映射。',
  },
  {
    id: 'evt-005',
    time: '10:42:44',
    stage: '记录仓',
    level: 'info',
    message: '写入 12 条 prototype record，等待人工复核。',
  },
  {
    id: 'evt-006',
    time: '10:42:51',
    stage: '通知出口',
    level: 'warning',
    message: '交付规则未绑定告警接收人，通知保持草稿态。',
  },
]

const RECORD_PREVIEW = {
  source_id: 'prototype-source',
  run_id: 'run_live_preview',
  status: 'normalized',
  schema_version: 'collector.v0',
  observed_at: '2026-06-25T10:42:44+08:00',
  payload: {
    symbol: 'BTCUSDT',
    venue: 'coinglass',
    metric: 'funding_rate',
    value: '0.0102%',
    price_delta: null,
  },
  gaps: ['price_delta mapping', 'delivery recipient'],
}

const DIAGNOSIS_ITEMS: DiagnosisItem[] = [
  {
    id: 'diag-schema',
    title: '字段契约未锁定',
    detail: '入口样本和处理器 schema 之间还没有自动验收。',
    severity: 'warning',
  },
  {
    id: 'diag-render',
    title: '渲染监控缺口',
    detail: '采集画面已有占位，但缺少截图比对和 DOM 稳定性判断。',
    severity: 'warning',
  },
  {
    id: 'diag-records',
    title: '记录预览可用',
    detail: '最近记录结构已展示，可作为后续真实 API 绑定入口。',
    severity: 'ok',
  },
  {
    id: 'diag-delivery',
    title: '通知规则待绑定',
    detail: '通知出口需要配置接收人和失败重试策略。',
    severity: 'error',
  },
]

const healthOrder: Record<TopologyHealth, number> = {
  failed: 0,
  warning: 1,
  active: 2,
  disabled: 3,
  unknown: 4,
  healthy: 5,
}

export default function TopologyPage() {
  const [searchParams] = useSearchParams()
  const sourceFilter = searchParams.get('source')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('pipeline:entry')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [queuedActions, setQueuedActions] = useState<PrototypeActionQueueItem[]>([])

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
  ] as const

  const stats = useMemo<PrototypeStats>(
    () => ({
      sources: collectionSize(sourcesQuery.data),
      schedules: collectionSize(schedulesQuery.data),
      tasks: collectionSize(tasksQuery.data),
      agents: collectionSize(agentsQuery.data),
      records: collectionSize(recordsQuery.data),
      notificationRules: collectionSize(rulesQuery.data),
      notificationLogs: collectionSize(logsQuery.data),
      edgeNodes: collectionSize(nodesQuery.data),
      workers: collectionSize(workersQuery.data),
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

  const stageData = useMemo<StageDataBundle>(
    () => ({
      sources: asArray(sourcesQuery.data),
      schedules: asArray(schedulesQuery.data),
      tasks: asArray(tasksQuery.data),
      agents: asArray(agentsQuery.data),
      records: asArray(recordsQuery.data),
      rules: asArray(rulesQuery.data),
    }),
    [
      sourcesQuery.data,
      schedulesQuery.data,
      tasksQuery.data,
      agentsQuery.data,
      recordsQuery.data,
      rulesQuery.data,
    ],
  )

  const graph = useMemo(() => buildPrototypePipelineGraph(stats), [stats])
  const flowGraph = useMemo(() => toFlowGraph(graph), [graph])
  const selectedNode = flowGraph.nodes.find((node) => node.id === selectedNodeId) ?? flowGraph.nodes[0] ?? null
  const isFetching = queries.some((query) => query.isFetching)
  const queryError = queries.find((query) => query.error)?.error

  useEffect(() => {
    if (selectedNodeId && flowGraph.nodes.some((node) => node.id === selectedNodeId)) return
    setSelectedNodeId(flowGraph.nodes[0]?.id ?? null)
  }, [flowGraph.nodes, selectedNodeId])

  const refetchAll = () => {
    for (const query of queries) query.refetch()
  }

  const selectTopologyNode = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    setInspectorOpen(true)
  }

  const runPrototypeAction = (node: TopologyFlowNode, action?: TopologyNodeAction) => {
    const label = action?.label ?? node.data.actions[0]?.label ?? '执行动作'
    const queueItem: PrototypeActionQueueItem = {
      id: `${node.id}:${action?.id ?? label}:${Date.now()}`,
      nodeId: node.id,
      nodeTitle: node.data.title,
      actionLabel: label,
      createdAt: new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    }
    setQueuedActions((items) => [queueItem, ...items].slice(0, 6))
    toast.info(`${node.data.title}: ${label} 已进入原型队列`)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="采集管线工作台"
        description="采集管线可视化工作台，原型模式验证结构，真实 API 统计同步。"
        action={
          <div className="flex items-center gap-2">
            {sourceFilter && (
              <span className="hidden border border-white/10 bg-black/25 px-2 py-1 font-code text-[10px] text-zinc-500 sm:inline-flex">
                source={sourceFilter}
              </span>
            )}
            <button
              type="button"
              onClick={refetchAll}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/12 bg-white/4 px-3 text-xs font-semibold text-zinc-200 hover:border-white/24 hover:bg-white/8"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
              同步
            </button>
          </div>
        }
      />

      {queryError && (
        <ErrorAlert
          error={queryError instanceof Error ? queryError : '拓扑统计同步失败，原型管线仍可查看。'}
          onRetry={refetchAll}
        />
      )}

      <PipelineStats stats={stats} isFetching={isFetching} />

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <TopologyOperations
          graph={graph}
          queuedActions={queuedActions}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={selectTopologyNode}
        />

        <div className="min-w-0 space-y-4">
          <Card padding={false} className="overflow-hidden border-white/10 bg-[#060606]">
            <div className="flex min-h-16 items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
              <div className="min-w-0">
                <p className="telemetry-label">PIPELINE CANVAS</p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-zinc-100">
                    {selectedNode ? selectedNode.data.title : '采集管线'}
                  </h2>
                  <span className="border border-white/10 bg-white/[0.035] px-2 py-0.5 font-code text-[10px] text-zinc-500">
                    {flowGraph.nodes.length} stages / {flowGraph.edges.length} links
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden border border-signal-cyan/25 bg-signal-cyan/10 px-2 py-1 font-code text-[10px] uppercase text-sky-100 sm:inline-flex">
                  prototype
                </span>
                {selectedNode && (
                  <button
                    type="button"
                    onClick={() => setInspectorOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/12 bg-white/4 px-2.5 text-xs font-semibold text-zinc-200 hover:border-white/25 hover:bg-white/8"
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    详情
                  </button>
                )}
              </div>
            </div>
            <div className="h-[52vh] min-h-[440px] bg-black">
              <ReactFlowTopologyCanvas
                nodes={flowGraph.nodes}
                edges={flowGraph.edges}
                selectedNodeId={selectedNode?.id ?? null}
                onSelectNode={selectTopologyNode}
              />
            </div>
          </Card>

          <LivePipelineSurface selectedNode={selectedNode} />
        </div>
      </div>

      {inspectorOpen && selectedNode && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex justify-end bg-black/55 p-4 backdrop-blur-xs"
          onClick={() => setInspectorOpen(false)}
        >
          <div className="relative h-full w-full max-w-[600px]" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label="Close node details"
              onClick={() => setInspectorOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/12 bg-black/80 text-zinc-300 hover:border-white/[0.28] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <PipelineNodeInspector
              node={selectedNode}
              onRunAction={runPrototypeAction}
              stageData={stageData}
              onChanged={refetchAll}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function buildPrototypePipelineGraph(stats: PrototypeStats): TopologyGraph {
  const definitions: PipelineNodeDefinition[] = [
    {
      id: 'entry',
      kind: 'source',
      title: '入口配置',
      subtitle: '数据入口',
      health: 'healthy',
      badges: ['DATA ENTRY', `${stats.sources || 3} sources`],
      responsibility: '定义来源、认证、采集范围和字段样本，是整条采集链路的输入契约。',
      status: '原型入口已就绪，真实来源连接继续复用现有数据源 API。',
      gap: '缺少连通性检测、样本字段验收和入口级失败归因。',
      primaryAction: '配置入口',
      targetPath: '/sources',
      stageCode: 'IN',
      column: 0,
      row: 0,
      telemetry: `${stats.sources} real sources visible to stats layer`,
      configEntries: [
        { label: '数据源配置', to: '/sources', hint: '绑定 URL、认证和入口参数' },
        { label: '边缘节点', to: '/nodes', hint: '选择采集执行环境' },
      ],
      skills: [
        skill('source-contract', '来源契约', 'ready', '入口字段和采集范围已在原型中固定', '/sources'),
        skill('connectivity-check', '连通性检测', 'missing', '需要真实连接探测和失败分类', '/nodes'),
      ],
    },
    {
      id: 'trigger',
      kind: 'schedule',
      title: '触发计划',
      subtitle: '调度/触发',
      health: 'warning',
      badges: ['SCHEDULE', `${stats.schedules || 2} plans`],
      responsibility: '把手动、定时和事件触发统一成可排队的采集请求。',
      status: '支持展示调度窗口，但 SLA、重试和互斥策略仍处于设计态。',
      gap: '缺少触发冲突处理、节流策略和错峰运行配置。',
      primaryAction: '调整计划',
      targetPath: '/schedules',
      stageCode: 'TR',
      column: 1,
      row: 0,
      telemetry: `${stats.schedules} schedules synced`,
      configEntries: [
        { label: '调度配置', to: '/schedules', hint: '维护 cron、时区和一次性触发' },
        { label: '任务队列', to: '/tasks', hint: '查看待执行采集任务' },
      ],
      skills: [
        skill('cron-window', '触发窗口', 'ready', '可展示下一次调度和手动触发入口', '/schedules'),
        skill('retry-policy', '重试策略', 'missing', '需要按入口/节点配置失败重试'),
      ],
    },
    {
      id: 'run',
      kind: 'task',
      title: '采集运行',
      subtitle: '采集执行',
      health: 'active',
      badges: ['RUNNING', `${stats.workers || 1} workers`],
      responsibility: '分配 worker、打开渲染面、执行采集步骤并持续推送运行事件。',
      status: '原型实时窗口已模拟采集事件和渲染状态。',
      gap: '缺少真实浏览器画面绑定、截图回放和运行中断恢复。',
      primaryAction: '打开运行窗口',
      targetPath: '/tasks',
      stageCode: 'EX',
      column: 2,
      row: 0,
      telemetry: `${stats.tasks} tasks / ${stats.workers} workers`,
      configEntries: [
        { label: '采集任务', to: '/tasks', hint: '查看实时运行队列' },
        { label: 'Worker 节点', to: '/nodes', hint: '确认执行环境在线状态' },
      ],
      skills: [
        skill('event-stream', '事件流', 'running', '采集事件持续写入实时窗口', '/tasks'),
        skill('render-capture', '渲染画面', 'missing', '需要绑定真实浏览器画面和截图', '/browsers'),
      ],
    },
    {
      id: 'processor',
      kind: 'agent',
      title: '处理器',
      subtitle: '解析/归一化',
      health: 'warning',
      badges: ['NORMALIZE', `${stats.agents || 1} agents`],
      responsibility: '把采集结果解析为结构化记录，并执行字段归一化、去重和 enrichment。',
      status: '基础 record preview 可展示，schema 差异仍需要诊断。',
      gap: '缺少字段映射工作台、样本 diff 和失败样本回放。',
      primaryAction: '查看处理器',
      targetPath: '/agents',
      stageCode: 'PR',
      column: 3,
      row: 0,
      telemetry: `${stats.agents} agents available`,
      configEntries: [
        { label: '处理器/Agent', to: '/agents', hint: '配置解析提示词和模型' },
        { label: '模型服务商', to: '/providers', hint: '检查模型和凭证绑定' },
      ],
      skills: [
        skill('normalize-schema', '归一化 schema', 'missing', 'price_delta 字段映射待确认', '/records'),
        skill('enrichment', 'Enrichment', 'ready', 'AI enrichment 能力已接入 Agent 层', '/agents'),
      ],
    },
    {
      id: 'store',
      kind: 'record',
      title: '记录仓',
      subtitle: '存储记录',
      health: 'healthy',
      badges: ['RECORDS', `${stats.records || 12} rows`],
      responsibility: '保存原始记录、归一化结果、采集证据和复核状态。',
      status: '最近记录结构可预览，后续可接入真实 record inspector。',
      gap: '缺少版本化 schema、批次对比和记录质量评分。',
      primaryAction: '查看记录',
      targetPath: '/records',
      stageCode: 'DB',
      column: 4,
      row: 0,
      telemetry: `${stats.records} records sampled`,
      configEntries: [
        { label: '记录列表', to: '/records', hint: '检查采集结果和 normalized data' },
        { label: '任务历史', to: '/tasks', hint: '从运行批次回到记录' },
      ],
      skills: [
        skill('record-preview', '记录预览', 'ready', '实时窗口展示最近记录结构', '/records'),
        skill('quality-score', '质量评分', 'missing', '需要对缺字段和异常值打分'),
      ],
    },
    {
      id: 'delivery',
      kind: 'notification',
      title: '通知出口',
      subtitle: '通知/交付',
      health: 'warning',
      badges: ['DELIVERY', `${stats.notificationRules || 1} rules`],
      responsibility: '把可用记录投递到告警、人工复核或下游系统。',
      status: '通知规则数量可同步，原型提示交付配置缺口。',
      gap: '缺少接收人绑定、交付重试和 ack 状态闭环。',
      primaryAction: '配置通知',
      targetPath: '/notifications',
      stageCode: 'OUT',
      column: 5,
      row: 0,
      telemetry: `${stats.notificationRules} rules / ${stats.notificationLogs} logs`,
      configEntries: [
        { label: '通知规则', to: '/notifications', hint: '配置接收人和触发条件' },
        { label: '交付日志', to: '/notifications', hint: '追踪 ack 和失败重试' },
      ],
      skills: [
        skill('delivery-rule', '交付规则', 'blocked', '通知接收人未绑定', '/notifications'),
        skill('ack-loop', 'ACK 闭环', 'missing', '需要失败重试和确认状态', '/notifications'),
      ],
    },
  ]

  const nodes = definitions.map<TopologyGraph['nodes'][number]>((definition) => ({
    id: `pipeline:${definition.id}`,
    column: definition.column,
    row: definition.row,
    data: {
      kind: definition.kind,
      title: definition.title,
      subtitle: definition.subtitle,
      health: definition.health,
      badges: definition.badges,
      skills: definition.skills,
      actions: [
        {
          id: `${definition.id}:primary`,
          label: definition.primaryAction,
          description: definition.status,
          enabled: true,
        },
      ],
      ports: {
        inputs: definition.id === 'entry' ? [] : ['pipeline'],
        outputs: definition.id === 'delivery' ? [] : ['pipeline'],
      },
      targetPath: definition.targetPath,
      detail: {
        responsibility: definition.responsibility,
        current_status: definition.status,
        capability_gap: definition.gap,
        primary_action: definition.primaryAction,
        telemetry: definition.telemetry,
        stage_code: definition.stageCode,
        config_entries: definition.configEntries,
      },
    },
  }))

  const edges: TopologyGraph['edges'] = [
    link('entry', 'trigger', '触发', 'healthy'),
    link('trigger', 'run', '排队执行', 'active'),
    link('run', 'processor', '输出样本', 'warning'),
    link('processor', 'store', '写入记录', 'healthy'),
    link('store', 'delivery', '交付', 'warning'),
  ]

  return {
    nodes,
    edges,
    summary: summarizeGraph(nodes),
  }
}

function link(source: string, target: string, label: string, health: TopologyHealth): TopologyGraph['edges'][number] {
  return {
    id: `pipeline:${source}->pipeline:${target}`,
    source: `pipeline:${source}`,
    target: `pipeline:${target}`,
    label,
    health,
  }
}

function toFlowGraph(graph: TopologyGraph): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const layoutedNodes = fallbackLayout(graph, 240, 210)
  return {
    nodes: layoutedNodes.map((node) => ({
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
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: healthColor(edge.health, 'line'),
      },
      style: {
        stroke: healthColor(edge.health, 'line'),
        strokeWidth: edge.health === 'failed' ? 2.4 : 1.8,
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
    })),
  }
}

function TopologyOperations({
  graph,
  queuedActions,
  selectedNodeId,
  onSelectNode,
}: {
  graph: TopologyGraph
  queuedActions: PrototypeActionQueueItem[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
}) {
  const runningNodes = graph.nodes.filter((node) => node.data.health === 'active')
  const attentionNodes = graph.nodes.filter((node) => node.data.health === 'failed' || node.data.health === 'warning')
  const gapNodes = graph.nodes.filter((node) =>
    node.data.skills.some((skill) => skill.state === 'missing' || skill.state === 'blocked'),
  )
  const actionNodes = graph.nodes.filter((node) => node.data.actions.some((action) => action.enabled))
  const queueItems = buildQueueItems(graph)

  return (
    <WorkbenchPanel
      label="OPERATIONS QUEUE"
      title="工作台队列"
      description="按正在运行、需要处理、能力缺口和可执行动作组织，不再列出实体关系图。"
      className="xl:sticky xl:top-4 xl:self-start"
    >
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <OperatorCard label="正在运行" value={runningNodes.length} icon={Radio} tone="info" />
          <OperatorCard label="需要处理" value={attentionNodes.length} icon={CircleAlert} tone="warning" />
          <OperatorCard label="能力缺口" value={gapNodes.length} icon={AlertTriangle} tone="danger" />
          <OperatorCard label="可执行动作" value={actionNodes.length} icon={Play} tone="success" />
        </div>

        <div className="divide-y divide-white/8 overflow-hidden border border-white/10 bg-black/20">
          {queueItems.map((item) => (
            <button
              key={`${item.group}:${item.node.id}`}
              type="button"
              onClick={() => onSelectNode(item.node.id)}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-white/4',
                selectedNodeId === item.node.id && 'bg-signal-cyan/10',
              )}
            >
              <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center border', queueToneClass(item.tone))}>
                <item.icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="telemetry-label">{item.group}</span>
                  <span className={cn('h-1.5 w-1.5 rounded-full', healthDotClass(item.node.data.health))} />
                </span>
                <span className="mt-1 block truncate text-sm font-semibold text-zinc-100">{item.node.data.title}</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <section className="border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="telemetry-label">ACTION QUEUE</p>
            <span className="font-code text-[10px] text-zinc-600">{queuedActions.length} queued</span>
          </div>
          <div className="mt-3 space-y-2">
            {queuedActions.length === 0 ? (
              <p className="text-xs leading-5 text-zinc-600">节点详情里的动作会进入这里，作为原型交互队列。</p>
            ) : (
              queuedActions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectNode(item.nodeId)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-white/8 bg-white/2.5 px-3 py-2 text-left text-xs hover:border-white/22 hover:bg-white/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-zinc-100">{item.actionLabel}</span>
                    <span className="mt-0.5 block truncate text-zinc-500">{item.nodeTitle}</span>
                  </span>
                  <span className="shrink-0 font-code text-[10px] text-zinc-600">{item.createdAt}</span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </WorkbenchPanel>
  )
}

function PipelineStats({ stats, isFetching: _isFetching }: { stats: PrototypeStats; isFetching: boolean }) {
  const items = [
    { label: 'SOURCES', value: stats.sources, icon: Network, tone: 'info' as OperatorTone, to: '/sources', hint: '采集入口数量，点击配置数据源' },
    { label: 'TASKS', value: stats.tasks, icon: Workflow, tone: 'accent' as OperatorTone, to: '/tasks', hint: '历史采集任务，点击查看运行队列' },
    { label: 'RECORDS', value: stats.records, icon: Database, tone: 'success' as OperatorTone, to: '/records', hint: '已存储记录数，点击检查采集结果' },
    { label: 'RULES', value: stats.notificationRules, icon: Bell, tone: 'warning' as OperatorTone, to: '/notifications', hint: '通知规则数量，点击配置交付出口' },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(({ label, value, icon: Icon, tone, to, hint }) => (
        <Link key={label} to={to} className="block transition hover:opacity-80">
          <OperatorCard label={label} value={value} icon={Icon} tone={tone} hint={hint} />
        </Link>
      ))}
    </div>
  )
}

function LivePipelineSurface({ selectedNode }: { selectedNode: TopologyFlowNode | null }) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 960 })
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      const mutableContainerRef = containerRef as { current: HTMLDivElement | null }
      mutableContainerRef.current = node
    },
    [containerRef],
  )
  const [layout, setLayout] = useState<Layout>(() => loadLiveSurfaceLayout())

  const handleLayoutChange = (nextLayout: Layout) => {
    setLayout(nextLayout)
    window.localStorage.setItem(LIVE_SURFACE_LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout))
  }

  const resetLayout = () => {
    const nextLayout = cloneDefaultLiveSurfaceLayout()
    setLayout(nextLayout)
    window.localStorage.setItem(LIVE_SURFACE_LAYOUT_STORAGE_KEY, JSON.stringify(nextLayout))
  }

  const panels = (
    <>
      <div key="events" className="overflow-hidden">
        <SurfacePanel title="事件流" label="EVENT STREAM" icon={Radio}>
          <EventStreamPanel selectedNode={selectedNode} />
        </SurfacePanel>
      </div>
      <div key="render" className="overflow-hidden">
        <SurfacePanel title="渲染/采集画面" label="RENDER" icon={Eye}>
          <RenderPreviewPanel selectedNode={selectedNode} />
        </SurfacePanel>
      </div>
      <div key="records" className="overflow-hidden">
        <SurfacePanel title="记录预览" label="RECORDS" icon={FileJson}>
          <RecordPreviewPanel />
        </SurfacePanel>
      </div>
      <div key="diagnosis" className="overflow-hidden">
        <SurfacePanel
          title="诊断"
          label="DIAGNOSIS"
          icon={AlertTriangle}
          action={
            <button
              type="button"
              onClick={resetLayout}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 px-2 text-[11px] text-zinc-300 hover:border-white/25 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              重置
            </button>
          }
        >
          <DiagnosisPanel selectedNode={selectedNode} />
        </SurfacePanel>
      </div>
    </>
  )

  return (
    <WorkbenchPanel
      label="LIVE COLLECTION SURFACE"
      title="实时采集窗口区"
      description="轻量原型窗口：事件流、渲染面、记录预览和诊断可拖拽调整，后续再绑定真实运行数据。"
    >
      <div ref={setContainerRef} className="hidden min-h-[650px] p-4 lg:block">
        {mounted && width > 0 && (
          <ReactGridLayout
            className="live-run-surface-grid"
            layout={layout}
            width={width - 32}
            gridConfig={{ cols: 12, rowHeight: 36, margin: [12, 12], containerPadding: [0, 0] }}
            dragConfig={{ enabled: true, handle: '.pipeline-surface-handle', bounded: true }}
            resizeConfig={{ enabled: true, handles: ['se'] }}
            onLayoutChange={handleLayoutChange}
          >
            {panels}
          </ReactGridLayout>
        )}
      </div>
      <div className="space-y-3 p-4 lg:hidden">
        <SurfacePanel title="事件流" label="EVENT STREAM" icon={Radio}>
          <EventStreamPanel selectedNode={selectedNode} />
        </SurfacePanel>
        <SurfacePanel title="渲染/采集画面" label="RENDER" icon={Eye}>
          <RenderPreviewPanel selectedNode={selectedNode} />
        </SurfacePanel>
        <SurfacePanel title="记录预览" label="RECORDS" icon={FileJson}>
          <RecordPreviewPanel />
        </SurfacePanel>
        <SurfacePanel title="诊断" label="DIAGNOSIS" icon={AlertTriangle}>
          <DiagnosisPanel selectedNode={selectedNode} />
        </SurfacePanel>
      </div>
    </WorkbenchPanel>
  )
}

function SurfacePanel({
  title,
  label,
  icon: Icon,
  children,
  action,
}: {
  title: string
  label: string
  icon: LucideIcon
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="flex h-full min-h-[220px] flex-col overflow-hidden border border-white/10 bg-black/20">
      <header className="pipeline-surface-handle flex cursor-move items-center justify-between gap-3 border-b border-white/10 bg-white/2.5 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center border border-white/10 bg-black/25 text-zinc-400">
            <Icon size={14} />
          </span>
          <div className="min-w-0">
            <p className="telemetry-label">{label}</p>
            <h3 className="truncate text-sm font-semibold text-zinc-100">{title}</h3>
          </div>
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
    </section>
  )
}

function EventStreamPanel({ selectedNode }: { selectedNode: TopologyFlowNode | null }) {
  return (
    <div className="h-full overflow-auto pr-1">
      <div className="space-y-2">
        {PIPELINE_EVENTS.map((event) => {
          const active = selectedNode?.data.title === event.stage
          return (
            <div
              key={event.id}
              className={cn(
                'border px-3 py-2 text-xs leading-5',
                eventToneClass(event.level),
                active && 'ring-1 ring-signal-cyan/45',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-code text-[10px] text-zinc-500">{event.time}</span>
                <span className="font-semibold text-zinc-200">{event.stage}</span>
              </div>
              <p className="mt-1 text-zinc-300">{event.message}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RenderPreviewPanel({ selectedNode }: { selectedNode: TopologyFlowNode | null }) {
  const stage = selectedNode?.data.title ?? '采集运行'
  const gap = readDetailString(selectedNode?.data.detail, 'capability_gap', '等待选择节点查看采集上下文。')

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between border border-white/10 bg-[#050505] px-3 py-2">
        <div className="min-w-0">
          <p className="telemetry-label">COLLECTOR VIEWPORT</p>
          <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{stage}</p>
        </div>
        <span className="border border-signal-cyan/35 bg-signal-cyan/10 px-2 py-1 font-code text-[10px] text-sky-100">
          LIVE MOCK
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden border border-white/10 bg-black">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px)] bg-size-[28px_28px] opacity-40" />
        <div className="absolute left-5 top-5 w-[min(520px,calc(100%-40px))] border border-white/15 bg-[#0b0b0b] shadow-2xl">
          <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1">
            <span className="h-2 w-2 rounded-full bg-red-400/80" />
            <span className="h-2 w-2 rounded-full bg-amber-300/80" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
            <span className="ml-2 truncate font-code text-[10px] text-zinc-500">collector://prototype/live</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="h-7 w-40 bg-white/8" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-16 border border-white/10 bg-white/[0.035]" />
              <div className="h-16 border border-signal-cyan/30 bg-signal-cyan/10" />
              <div className="h-16 border border-white/10 bg-white/[0.035]" />
            </div>
            <div className="space-y-2">
              <div className="h-2 w-full bg-white/6" />
              <div className="h-2 w-10/12 bg-white/6" />
              <div className="h-2 w-7/12 bg-white/6" />
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 left-4 right-4 border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
          {gap}
        </div>
      </div>
    </div>
  )
}

function RecordPreviewPanel() {
  return (
    <pre className="h-full overflow-auto border border-white/10 bg-black/40 p-3 font-code text-xs leading-5 text-zinc-300">
      {JSON.stringify(RECORD_PREVIEW, null, 2)}
    </pre>
  )
}

function DiagnosisPanel({ selectedNode }: { selectedNode: TopologyFlowNode | null }) {
  const selectedGap = readDetailString(selectedNode?.data.detail, 'capability_gap')
  const items = selectedGap
    ? [
        {
          id: 'selected',
          title: `${selectedNode?.data.title ?? '当前节点'}缺口`,
          detail: selectedGap,
          severity: selectedNode?.data.health === 'failed' ? 'error' : 'warning',
        } satisfies DiagnosisItem,
        ...DIAGNOSIS_ITEMS,
      ]
    : DIAGNOSIS_ITEMS

  return (
    <div className="h-full overflow-auto pr-1">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className={cn('border px-3 py-2 text-xs leading-5', diagnosisToneClass(item.severity))}>
            <div className="flex items-center gap-2">
              {item.severity === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              <span className="font-semibold">{item.title}</span>
            </div>
            <p className="mt-1 text-zinc-300">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineNodeInspector({
  node,
  onRunAction,
  stageData,
  onChanged,
}: {
  node: TopologyFlowNode
  onRunAction: (node: TopologyFlowNode, action?: TopologyNodeAction) => void
  stageData: StageDataBundle
  onChanged: () => void
}) {
  const responsibility = readDetailString(node.data.detail, 'responsibility', node.data.subtitle)
  const status = readDetailString(node.data.detail, 'current_status', healthLabel(node.data.health))
  const gap = readDetailString(node.data.detail, 'capability_gap', '暂无能力缺口')
  const stageCode = readDetailString(node.data.detail, 'stage_code', node.data.kind.slice(0, 2).toUpperCase())
  const primaryAction = node.data.actions.find((action) => action.enabled) ?? node.data.actions[0]

  return (
    <Card padding={false} className="flex h-full flex-col overflow-hidden border-white/10 bg-[#0a0a0a]">
      {/* NDV header */}
      <div className="flex items-start gap-3 border-b border-white/8 px-4 py-4 pr-12">
        <div className="grid h-10 w-10 shrink-0 place-items-center border border-white/15 bg-white/4">
          <span className="font-code text-xs font-semibold text-zinc-200">{stageCode}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="telemetry-label">NODE · {stageCode}</p>
            <span className={cn('h-1.5 w-1.5 rounded-full', healthDotClass(node.data.health))} />
          </div>
          <h2 className="mt-0.5 truncate text-lg font-semibold text-white" title={node.data.title}>
            {node.data.title}
          </h2>
          <p className="truncate text-xs text-zinc-500">{node.data.subtitle}</p>
        </div>
      </div>

      {/* scroll body */}
      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        <div className="space-y-2 border border-white/8 bg-black/25 p-3 text-xs leading-5">
          <p className="text-zinc-400">{responsibility}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px]">
            <span className="text-zinc-500">
              状态 <span className="text-zinc-300">{status}</span>
            </span>
            <span className="text-amber-200/80">缺口 {gap}</span>
          </div>
        </div>

        <StageOperationPanel node={node.data} stageCode={stageCode} data={stageData} onChanged={onChanged} />
      </div>

      {/* footer · prototype action queue */}
      {primaryAction && (
        <div className="border-t border-white/8 px-4 py-3">
          <button
            type="button"
            onClick={() => onRunAction(node, primaryAction)}
            disabled={!primaryAction.enabled}
            className="inline-flex w-full items-center justify-between border border-white/12 px-3 py-2 text-xs transition hover:border-white/30 hover:bg-white/4 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="truncate">{primaryAction.label}</span>
            <span className="font-medium text-slate-300">加入原型队列</span>
          </button>
        </div>
      )}
    </Card>
  )
}

function DetailRow({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warning' }) {
  return (
    <div className="rounded-md border border-white/8 bg-black/25 p-3">
      <p className="telemetry-label">{label}</p>
      <p className={cn('mt-1 text-sm leading-6 text-zinc-300', tone === 'warning' && 'text-amber-100')}>{value}</p>
    </div>
  )
}

function SkillList({ title, skills }: { title: string; skills: TopologySkill[] }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 p-3">
      <p className="telemetry-label">{title}</p>
      <div className="mt-3 space-y-2">
        {skills.length === 0 ? (
          <p className="text-xs text-zinc-600">无</p>
        ) : (
          skills.map((skill) => (
            <div key={skill.id} className="text-xs leading-5">
              <span className={cn('inline-flex border px-1.5 py-0.5 text-[10px]', skillChipClass(skill.state))}>
                {skill.label}
              </span>
              <p className="mt-1 text-zinc-500">{skill.description}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function buildQueueItems(graph: TopologyGraph) {
  const items: Array<{
    group: string
    node: TopologyGraph['nodes'][number]
    hint: string
    icon: LucideIcon
    tone: OperatorTone
  }> = []

  for (const node of [...graph.nodes].sort((a, b) => healthOrder[a.data.health] - healthOrder[b.data.health])) {
    const gap = readDetailString(node.data.detail, 'capability_gap')
    if (node.data.health === 'active') {
      items.push({ group: '正在运行', node, hint: readDetailString(node.data.detail, 'current_status'), icon: Activity, tone: 'info' })
    }
    if (node.data.health === 'warning' || node.data.health === 'failed') {
      items.push({ group: '需要处理', node, hint: gap, icon: CircleAlert, tone: 'warning' })
    }
    if (node.data.skills.some((skill) => skill.state === 'missing' || skill.state === 'blocked')) {
      items.push({ group: '能力缺口', node, hint: gap, icon: SlidersHorizontal, tone: 'danger' })
    }
    if (node.data.actions.some((action) => action.enabled)) {
      items.push({
        group: '可执行动作',
        node,
        hint: node.data.actions.find((action) => action.enabled)?.label ?? '查看详情',
        icon: Zap,
        tone: 'success',
      })
    }
  }

  return items.slice(0, 10)
}

function collectionSize(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  const data = (value as { data?: unknown }).data
  return Array.isArray(data) ? data.length : 0
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object') {
    const data = (value as { data?: unknown }).data
    if (Array.isArray(data)) return data as T[]
  }
  return []
}

function summarizeGraph(nodes: TopologyGraph['nodes']): TopologyGraph['summary'] {
  return nodes.reduce<TopologyGraph['summary']>(
    (summary, node) => {
      summary.total += 1
      summary.failed += node.data.health === 'failed' ? 1 : 0
      summary.warning += node.data.health === 'warning' ? 1 : 0
      summary.active += node.data.health === 'active' ? 1 : 0
      summary.disabled += node.data.health === 'disabled' ? 1 : 0
      for (const item of node.data.skills) {
        summary.skills.total += 1
        summary.skills.ready += item.state === 'ready' ? 1 : 0
        summary.skills.running += item.state === 'running' ? 1 : 0
        summary.skills.missing += item.state === 'missing' ? 1 : 0
        summary.skills.blocked += item.state === 'blocked' ? 1 : 0
      }
      return summary
    },
    {
      total: 0,
      failed: 0,
      warning: 0,
      active: 0,
      disabled: 0,
      skills: { total: 0, ready: 0, running: 0, missing: 0, blocked: 0 },
    },
  )
}

function skill(
  id: string,
  label: string,
  state: TopologySkillState,
  description: string,
  targetPath?: string,
): TopologySkill {
  return { id, label, state, description, targetPath }
}

function cloneDefaultLiveSurfaceLayout(): Layout {
  return DEFAULT_LIVE_SURFACE_LAYOUT.map((item) => ({ ...item })) as Layout
}

function loadLiveSurfaceLayout(): Layout {
  if (typeof window === 'undefined') return cloneDefaultLiveSurfaceLayout()
  try {
    const raw = window.localStorage.getItem(LIVE_SURFACE_LAYOUT_STORAGE_KEY)
    if (!raw) return cloneDefaultLiveSurfaceLayout()
    const parsed = JSON.parse(raw) as Layout
    return Array.isArray(parsed) ? parsed : cloneDefaultLiveSurfaceLayout()
  } catch {
    return cloneDefaultLiveSurfaceLayout()
  }
}

function readDetailString(detail: Record<string, unknown> | undefined, key: string, fallback = '') {
  const value = detail?.[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function readConfigEntries(detail: Record<string, unknown>) {
  const value = detail.config_entries
  if (!Array.isArray(value)) return []
  return value.filter(isConfigEntry)
}

function isConfigEntry(value: unknown): value is { label: string; to: string; hint: string } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { label?: unknown }).label === 'string' &&
    typeof (value as { to?: unknown }).to === 'string' &&
    typeof (value as { hint?: unknown }).hint === 'string'
  )
}

function healthLabel(health: TopologyHealth) {
  const labels: Record<TopologyHealth, string> = {
    healthy: 'healthy',
    active: 'active',
    warning: 'warning',
    failed: 'failed',
    disabled: 'disabled',
    unknown: 'unknown',
  }
  return labels[health]
}

function healthColor(health: TopologyHealth, context: 'line' | 'mini') {
  const colors: Record<TopologyHealth, string> = {
    healthy: context === 'line' ? '#00ac3a' : '#009432',
    active: '#47a8ff',
    warning: '#ffae00',
    failed: '#ff565f',
    disabled: '#71717a',
    unknown: '#a1a1aa',
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
    unknown: 'bg-zinc-500',
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

function queueToneClass(tone: OperatorTone) {
  const classes: Record<OperatorTone, string> = {
    neutral: 'border-white/10 bg-white/[0.035] text-zinc-300',
    accent: 'border-primary-500/45 bg-primary-500/12 text-primary-100',
    info: 'border-signal-cyan/45 bg-signal-cyan/12 text-sky-100',
    gold: 'border-signal-gold/45 bg-signal-gold/12 text-yellow-100',
    success: 'border-signal-green/45 bg-signal-green/12 text-emerald-100',
    warning: 'border-signal-amber/45 bg-signal-amber/12 text-amber-100',
    danger: 'border-signal-red/50 bg-signal-red/14 text-red-100',
    violet: 'border-signal-violet/45 bg-signal-violet/12 text-violet-100',
  }
  return classes[tone]
}

function eventToneClass(level: SurfaceEvent['level']) {
  if (level === 'error') return 'border-red-500/35 bg-red-500/10 text-red-200'
  if (level === 'warning') return 'border-amber-400/35 bg-amber-400/10 text-amber-100'
  return 'border-sky-400/30 bg-sky-400/10 text-sky-100'
}

function diagnosisToneClass(severity: DiagnosisItem['severity']) {
  if (severity === 'error') return 'border-red-500/35 bg-red-500/10 text-red-200'
  if (severity === 'warning') return 'border-amber-400/35 bg-amber-400/10 text-amber-100'
  return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
}
