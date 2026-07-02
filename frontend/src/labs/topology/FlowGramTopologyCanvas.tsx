import { useMemo } from 'react'
import {
  EditorRenderer,
  FreeLayoutEditorProvider,
  WorkflowNodeRenderer,
  useNodeRender,
  type WorkflowJSON,
  type WorkflowNodeEntity,
  type WorkflowNodeRegistry,
} from '@flowgram.ai/free-layout-editor'
import '@flowgram.ai/free-layout-editor/index.css'

import type { Edge, Node } from '@xyflow/react'
import type { TopologyHealth, TopologyNodeData } from './topologyModel'

interface FlowGramTopologyCanvasProps {
  nodes: Array<Node<TopologyNodeData>>
  edges: Array<Edge<{ health: TopologyHealth }>>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onNodeDoubleClick?: (nodeId: string) => void
}

interface FlowGramNodeData {
  nodeId: string
  topology: TopologyNodeData
}

const FLOWGRAM_NODE_WIDTH = 272
const FLOWGRAM_NODE_HEIGHT = 190
const FLOWGRAM_CANVAS_PADDING = 20
const FLOWGRAM_POSITION_SCALE = 0.72

function compactCanvasPosition(position: { x: number; y: number }, origin: { x: number; y: number }) {
  return {
    x: Math.round((position.x - origin.x) * FLOWGRAM_POSITION_SCALE + FLOWGRAM_CANVAS_PADDING),
    y: Math.round((position.y - origin.y) * FLOWGRAM_POSITION_SCALE + FLOWGRAM_CANVAS_PADDING),
  }
}

function FlowGramTopologyNode({
  node,
  selectedNodeId,
  onSelectNode,
  onNodeDoubleClick,
}: {
  node: WorkflowNodeEntity
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onNodeDoubleClick?: (nodeId: string) => void
}) {
  const { data: rawData } = useNodeRender(node)
  const data = rawData as FlowGramNodeData | undefined
  if (!data) return null

  const { nodeId, topology } = data
  const selected = nodeId === selectedNodeId
  const isProject = readDetailString(topology.detail, 'kind', '') === 'project'
  const status = readDetailString(topology.detail, 'current_status', topology.health)
  const gap = readDetailString(topology.detail, 'capability_gap', '暂无能力缺口')
  const responsibility = readDetailString(topology.detail, 'responsibility', topology.subtitle)
  const stageCode = readDetailString(topology.detail, 'stage_code', topology.kind.slice(0, 2).toUpperCase())
  const actionLabel = topology.actions.find((action) => action.enabled)?.label ?? topology.actions[0]?.label ?? '查看详情'
  const missingCount = topology.skills.filter((item) => item.state === 'missing' || item.state === 'blocked').length

  return (
    <WorkflowNodeRenderer
      node={node}
      className="opencli-flowgram-node"
      portPrimaryColor="#2f7df6"
      portSecondaryColor="rgba(255,255,255,0.28)"
      portErrorColor="#ef4444"
      portBackgroundColor="#0a0a0a"
    >
      <button
        type="button"
        onClick={() => onSelectNode(nodeId)}
        onDoubleClick={() => onNodeDoubleClick?.(nodeId)}
        className={[
          'block min-h-[190px] w-[272px] rounded-md border bg-[#0a0a0a] px-3 py-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.16)] transition duration-200 ease-(--m3-ease-emphasized) hover:border-white/22 active:scale-[0.99]',
          selected ? 'border-blue-500 ring-2 ring-blue-500/25' : 'border-white/12',
        ].join(' ')}
      >
        <div className="flex items-start gap-3">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${healthSoftClass(topology.health)}`}>
            <span className="font-code text-[10px] font-semibold uppercase">{stageCode}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {topology.subtitle}
              </span>
              <span className={`h-2 w-2 rounded-full ${healthDotClass(topology.health)}`} />
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-white" title={topology.title}>
              {topology.title}
            </div>
            <div className="mt-1 max-h-8 overflow-hidden text-[11px] leading-4 text-slate-400" title={responsibility}>
              {responsibility}
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-1.5 text-[10px] leading-4">
          <NodeFact label="状态" value={status} />
          <NodeFact label="缺口" value={gap} tone={missingCount > 0 ? 'warning' : 'neutral'} />
          {isProject ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onNodeDoubleClick?.(nodeId)
              }}
              className="flex items-center justify-between gap-2 border border-sky-500/40 bg-sky-500/12 px-2 py-1 font-medium text-sky-100 transition hover:bg-sky-500/20"
            >
              <span>进入子网</span>
              <span aria-hidden className="text-sky-300">›</span>
            </span>
          ) : (
            <NodeFact label="动作" value={actionLabel} tone="action" />
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {topology.badges.slice(0, 2).map((badge) => (
            <span
              key={badge}
              className="max-w-[116px] truncate rounded-xs border border-white/10 bg-white/4 px-1.5 py-0.5 text-[10px] text-zinc-300"
              title={badge}
            >
              {badge}
            </span>
          ))}
          {missingCount > 0 && (
            <span className="rounded-xs border border-red-400/35 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-100">
              {missingCount} gaps
            </span>
          )}
        </div>
      </button>
    </WorkflowNodeRenderer>
  )
}

function NodeFact({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'warning' | 'action'
}) {
  const valueClass =
    tone === 'warning' ? 'text-amber-100' : tone === 'action' ? 'text-sky-100' : 'text-zinc-300'
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 border border-white/6 bg-white/2.5 px-2 py-1">
      <span className="shrink-0 text-zinc-600">{label}</span>
      <span className={`truncate font-medium ${valueClass}`} title={value}>
        {value}
      </span>
    </div>
  )
}

export function FlowGramTopologyCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onNodeDoubleClick,
}: FlowGramTopologyCanvasProps) {
  const compactedNodes = useMemo(() => {
    if (nodes.length === 0) return []

    const origin = nodes.reduce(
      (acc, node) => ({
        x: Math.min(acc.x, node.position.x),
        y: Math.min(acc.y, node.position.y),
      }),
      { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
    )

    return nodes.map((node) => ({
      ...node,
      position: compactCanvasPosition(node.position, origin),
    }))
  }, [nodes])

  const initialData = useMemo<WorkflowJSON>(
    () => ({
      nodes: compactedNodes.map((node) => ({
        id: node.id,
        type: 'topology-node',
        meta: {
          position: node.position,
          renderKey: 'topology-node',
        },
        data: {
          nodeId: node.id,
          topology: node.data,
        },
      })),
      edges: edges.map((edge) => ({
        sourceNodeID: edge.source,
        targetNodeID: edge.target,
        data: {
          label: edge.label,
          health: edge.data?.health,
        },
      })),
    }),
    [compactedNodes, edges],
  )

  const documentKey = useMemo(() => {
    const nodeKey = compactedNodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join('|')
    const dataKey = compactedNodes
      .map((node) =>
        [
          node.id,
          node.data.title,
          node.data.subtitle,
          node.data.health,
          node.data.badges.join(','),
          readDetailString(node.data.detail, 'current_status', ''),
          readDetailString(node.data.detail, 'capability_gap', ''),
          node.data.actions.map((action) => `${action.id}:${action.label}:${action.enabled}`).join(','),
        ].join(':'),
      )
      .join('|')
    const edgeKey = edges.map((edge) => `${edge.source}>${edge.target}`).join('|')
    return `${nodeKey}/${dataKey}/${edgeKey}`
  }, [compactedNodes, edges])

  const nodeRegistries = useMemo<WorkflowNodeRegistry[]>(
    () => [
      {
        type: 'topology-node',
        meta: {
          renderKey: 'topology-node',
          origin: { x: 0, y: 0 },
          defaultPorts: [{ type: 'input' }, { type: 'output' }],
          size: {
            width: FLOWGRAM_NODE_WIDTH,
            height: FLOWGRAM_NODE_HEIGHT,
          },
        },
      } as WorkflowNodeRegistry,
    ],
    [],
  )

  const materials = useMemo(
    () => ({
      renderDefaultNode: () => null,
      renderNodes: {
        'topology-node': ({ node }: { node: WorkflowNodeEntity }) => (
          <FlowGramTopologyNode
            node={node}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onNodeDoubleClick={onNodeDoubleClick}
          />
        ),
      },
    }),
    [onNodeDoubleClick, onSelectNode, selectedNodeId],
  )

  return (
    <FreeLayoutEditorProvider
      key={documentKey}
      readonly
      initialData={initialData}
      nodeRegistries={nodeRegistries}
      materials={materials}
      playground={{ autoResize: true }}
    >
      <div className="h-full w-full [&_.gedit-playground]:bg-black">
        <EditorRenderer className="h-full w-full" />
      </div>
    </FreeLayoutEditorProvider>
  )
}

function readDetailString(detail: Record<string, unknown>, key: string, fallback: string) {
  const value = detail[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function healthSoftClass(health: TopologyHealth) {
  const classes: Record<TopologyHealth, string> = {
    healthy: 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    active: 'border border-sky-400/35 bg-sky-400/10 text-sky-200',
    warning: 'border border-amber-400/35 bg-amber-400/10 text-amber-200',
    failed: 'border border-red-400/35 bg-red-400/10 text-red-200',
    disabled: 'border border-slate-500/35 bg-slate-500/10 text-slate-300',
    unknown: 'border border-zinc-500/35 bg-zinc-500/10 text-zinc-300',
  }
  return classes[health]
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
