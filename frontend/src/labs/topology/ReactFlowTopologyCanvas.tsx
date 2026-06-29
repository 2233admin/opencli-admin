import { useEffect, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { TopologyHealth, TopologyNodeData } from './topologyModel'

type TopologyNodeViewData = TopologyNodeData & { onDive?: () => void }
type TopologyFlowNode = Node<TopologyNodeViewData>
type TopologyFlowEdge = Edge<{ health: TopologyHealth }>

interface ReactFlowTopologyCanvasProps {
  nodes: Array<Node<TopologyNodeData>>
  edges: TopologyFlowEdge[]
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onNodeDoubleClick?: (nodeId: string) => void
  /** Changes on dive (L0↔L1); drives an animated fitView instead of a remount. */
  viewKey?: string
  headerLabel?: string
}

// M3 emphasized-decelerate ~ approximated as easeOutQuart for the d3 viewport tween.
const m3Decel = (t: number) => 1 - Math.pow(1 - t, 4)
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const NODE_WIDTH = 264

function TopologyNodeView({ data, selected }: NodeProps<TopologyFlowNode>) {
  const status = readDetailString(data.detail, 'current_status', healthLabel(data.health))
  const gap = readDetailString(data.detail, 'capability_gap', '暂无能力缺口')
  const responsibility = readDetailString(data.detail, 'responsibility', data.subtitle)
  const stageCode = readDetailString(data.detail, 'stage_code', data.kind.slice(0, 2).toUpperCase())
  const actionLabel = data.actions.find((action) => action.enabled)?.label ?? data.actions[0]?.label ?? '查看详情'
  const missingCount = data.skills.filter((item) => item.state === 'missing' || item.state === 'blocked').length
  const hasInput = data.ports.inputs.length > 0
  const hasOutput = data.ports.outputs.length > 0

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={[
        'group relative rounded-lg border bg-[#0a0a0c]/95 px-3 py-3 text-left shadow-xl backdrop-blur transition-colors',
        selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-white/[0.12] hover:border-white/30',
      ].join(' ')}
    >
      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className={`!h-3 !w-3 !border-2 !border-[#0a0a0c] ${handleColorClass(data.health)}`}
        />
      )}
      {hasOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className={`!h-3 !w-3 !border-2 !border-[#0a0a0c] ${handleColorClass(data.health)}`}
        />
      )}

      <div className="flex items-start gap-3">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${healthSoftClass(data.health)}`}>
          <span className="font-code text-[10px] font-semibold uppercase">{stageCode}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {data.subtitle}
            </span>
            <span className={`h-2 w-2 rounded-full ${healthDotClass(data.health)}`} />
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-white" title={data.title}>
            {data.title}
          </div>
          <div className="mt-1 max-h-8 overflow-hidden text-[11px] leading-4 text-slate-400" title={responsibility}>
            {responsibility}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-1.5 text-[10px] leading-4">
        <NodeFact label="状态" value={status} />
        <NodeFact label="缺口" value={gap} tone={missingCount > 0 ? 'warning' : 'neutral'} />
        {data.onDive ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              data.onDive?.()
            }}
            className="nodrag nopan flex items-center justify-between gap-2 border border-sky-500/40 bg-sky-500/[0.12] px-2 py-1 font-medium text-sky-100 transition hover:bg-sky-500/20 active:scale-[0.99]"
          >
            <span>进入子网</span>
            <span aria-hidden className="text-sky-300">›</span>
          </button>
        ) : (
          <NodeFact label="动作" value={actionLabel} tone="action" />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.badges.slice(0, 2).map((badge) => (
          <span
            key={badge}
            className="max-w-[116px] truncate rounded-sm border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-300"
            title={badge}
          >
            {badge}
          </span>
        ))}
        {missingCount > 0 && (
          <span className="rounded-sm border border-red-400/35 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-100">
            {missingCount} gaps
          </span>
        )}
      </div>
    </div>
  )
}

const topologyNodeTypes = {
  topologyNode: TopologyNodeView,
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
    <div className="flex min-w-0 items-center justify-between gap-2 border border-white/[0.06] bg-white/[0.025] px-2 py-1">
      <span className="shrink-0 text-zinc-600">{label}</span>
      <span className={`truncate font-medium ${valueClass}`} title={value}>
        {value}
      </span>
    </div>
  )
}

function ReactFlowTopologyCanvasInner({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onNodeDoubleClick,
  viewKey,
  headerLabel,
}: ReactFlowTopologyCanvasProps) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<TopologyFlowNode>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<TopologyFlowEdge>([])
  const { fitView } = useReactFlow()

  // Keep dive callback in a ref so the sync effect below does NOT depend on its
  // (per-render-unstable) identity — otherwise every parent re-render rebuilds
  // all nodes and thrashes the canvas, eating clicks.
  const diveRef = useRef(onNodeDoubleClick)
  useEffect(() => {
    diveRef.current = onNodeDoubleClick
  })

  // Sync props → controlled state WITHOUT remounting. Preserve any user-dragged
  // position by id so the periodic refetches don't snap nodes back to layout.
  useEffect(() => {
    setRfNodes((prev) => {
      const posById = new Map(prev.map((n) => [n.id, n.position]))
      return nodes.map((node) => {
        const isProject = readDetailString(node.data.detail, 'kind', '') === 'project'
        return {
          ...node,
          type: 'topologyNode',
          position: posById.get(node.id) ?? node.position,
          selected: node.id === selectedNodeId,
          data: isProject
            ? { ...node.data, onDive: () => diveRef.current?.(node.id) }
            : node.data,
        }
      })
    })
  }, [nodes, selectedNodeId, setRfNodes])

  useEffect(() => {
    setRfEdges(
      edges.map((edge) => ({
        ...edge,
        type: 'default',
        animated: edge.data?.health === 'active' || edge.data?.health === 'healthy',
      })),
    )
  }, [edges, setRfEdges])

  // Animated viewport on level change (dive / pop) — replaces the old remount.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      fitView({
        padding: 0.16,
        maxZoom: 1,
        duration: prefersReducedMotion() ? 0 : 450,
        ease: m3Decel,
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [viewKey, fitView])

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={topologyNodeTypes}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onNodeDoubleClick={onNodeDoubleClick ? (_, node) => onNodeDoubleClick(node.id) : undefined}
      fitView
      fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.4}
      nodesDraggable
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      className="bg-[#060608]"
    >
      <Background variant={BackgroundVariant.Dots} color="#2a2a32" gap={22} size={1.6} />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap
        position="bottom-right"
        nodeColor={(node) => miniColor((node.data as TopologyNodeViewData).health)}
        maskColor="rgba(6, 6, 8, 0.78)"
        pannable
        zoomable
      />
      <Panel position="top-left">
        <div className="rounded-md border border-white/10 bg-black/80 px-3 py-1.5 text-[11px] text-zinc-400 shadow-lg">
          <span className="font-code text-zinc-600">{headerLabel ?? `采集管线 · ${rfNodes.length} stages`}</span>
        </div>
      </Panel>
    </ReactFlow>
  )
}

export function ReactFlowTopologyCanvas(props: ReactFlowTopologyCanvasProps) {
  return (
    <ReactFlowProvider>
      <ReactFlowTopologyCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function readDetailString(detail: Record<string, unknown> | undefined, key: string, fallback: string) {
  const value = detail?.[key]
  return typeof value === 'string' && value.length > 0 ? value : fallback
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

function handleColorClass(health: TopologyHealth) {
  const classes: Record<TopologyHealth, string> = {
    healthy: '!bg-emerald-400',
    active: '!bg-sky-400',
    warning: '!bg-amber-400',
    failed: '!bg-red-400',
    disabled: '!bg-slate-500',
    unknown: '!bg-zinc-500',
  }
  return classes[health]
}

function miniColor(health: TopologyHealth) {
  const colors: Record<TopologyHealth, string> = {
    healthy: '#34d399',
    active: '#38bdf8',
    warning: '#fbbf24',
    failed: '#f87171',
    disabled: '#64748b',
    unknown: '#a1a1aa',
  }
  return colors[health]
}
