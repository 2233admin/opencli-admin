import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Bell,
  CalendarClock,
  Database,
  Filter,
  Gauge,
  StickyNote,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { WF, workflowNodeTypes } from './WorkflowNodes'

/* Interactive xyops-style workflow editor on React Flow.
 * - drag a palette chip onto the canvas to add a node
 * - drag handle → handle to wire (onConnect), edges colored by source
 * - select + Backspace/Delete to remove nodes or edges
 * React Flow owns canvas / wiring / pan-zoom / minimap; we own the 7 node bodies. */

const DND_MIME = 'application/xyops-node'

interface PaletteItem {
  type: keyof typeof workflowNodeTypes
  label: string
  icon: LucideIcon
  color: string
}

const PALETTE: PaletteItem[] = [
  { type: 'wfTrigger', label: '触发器', icon: Zap, color: WF.orange },
  { type: 'wfJob', label: '任务', icon: Database, color: WF.blue },
  { type: 'wfEvent', label: '事件', icon: CalendarClock, color: WF.blue },
  { type: 'wfController', label: '分支', icon: Filter, color: WF.purple },
  { type: 'wfAction', label: '动作', icon: Bell, color: WF.green },
  { type: 'wfLimit', label: '限流', icon: Gauge, color: WF.cyan },
  { type: 'wfNote', label: '注释', icon: StickyNote, color: '#d99a3d' },
]

function defaultData(type: keyof typeof workflowNodeTypes) {
  switch (type) {
    case 'wfTrigger':
      return { label: 'trigger', icon: Zap }
    case 'wfJob':
      return { kind: 'job', title: '采集任务', pill: 'JOB', pillTone: 'cyan', icon: Database, state: 'idle', rows: [{ k: 'plugin', v: 'opencli.collect' }] }
    case 'wfEvent':
      return { kind: 'event', title: '事件节点', pill: 'EVENT', icon: CalendarClock, state: 'idle', rows: [{ k: 'event', v: 'normalize.v1' }] }
    case 'wfController':
      return { label: 'fan-out', icon: Filter }
    case 'wfAction':
      return { label: 'notify', icon: Bell }
    case 'wfLimit':
      return { label: 'limit 4' }
    case 'wfNote':
      return { text: '双击编辑注释…' }
    default:
      return {}
  }
}

const INITIAL_NODES: Node[] = [
  { id: 'trig-0', type: 'wfTrigger', position: { x: 24, y: 150 }, data: { label: 'schedule', icon: CalendarClock } },
  {
    id: 'job-0',
    type: 'wfJob',
    position: { x: 150, y: 118 },
    data: { kind: 'job', title: '采集任务 · binance-funding', pill: 'JOB', pillTone: 'cyan', icon: Database, state: 'running', rows: [{ k: 'plugin', v: 'opencli.collect' }, { k: 'target', v: 'coinglass' }] },
  },
  { id: 'limit-0', type: 'wfLimit', position: { x: 232, y: 330 }, data: { label: 'concurrency 4' } },
  { id: 'act-0', type: 'wfAction', position: { x: 470, y: 330 }, data: { label: 'notify', icon: Bell } },
  { id: 'ctrl-0', type: 'wfController', position: { x: 470, y: 140 }, data: { label: 'fan-out', icon: Filter } },
  {
    id: 'evt-0',
    type: 'wfEvent',
    position: { x: 660, y: 40 },
    data: { kind: 'event', title: '归一化处理器', pill: 'EVENT', icon: CalendarClock, state: 'success', rows: [{ k: 'event', v: 'normalize.v1' }, { k: 'agent', v: 'gpt-4o-mini' }] },
  },
  {
    id: 'evt-1',
    type: 'wfEvent',
    position: { x: 660, y: 250 },
    data: { kind: 'event', title: '存储 + 通知规则', pill: 'EVENT', icon: CalendarClock, state: 'warning', rows: [{ k: 'event', v: 'store.records' }, { k: 'rules', v: '7 active' }] },
  },
  { id: 'note-0', type: 'wfNote', position: { x: 24, y: 320 }, data: { text: '触发器→任务→分支→事件；动作与限流附着在任务上。拖左侧节点入画布，连 handle 建线。' } },
]

function styledEdge(params: Edge | Connection, sourceType: string | undefined): Edge {
  const color =
    params.sourceHandle === 'limit'
      ? WF.cyan
      : sourceType === 'wfTrigger'
        ? WF.orange
        : sourceType === 'wfController'
          ? WF.purple
          : sourceType === 'wfAction'
            ? WF.green
            : WF.blue
  return {
    ...(params as Edge),
    id: `e-${params.source}${params.sourceHandle ?? ''}-${params.target}${params.targetHandle ?? ''}`,
    type: 'default',
    animated: color === WF.orange || color === WF.blue,
    style: { stroke: color, strokeWidth: 1.8 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  }
}

const INITIAL_EDGES: Edge[] = [
  styledEdge({ source: 'trig-0', target: 'job-0', sourceHandle: 'out', targetHandle: 'in' } as Connection, 'wfTrigger'),
  styledEdge({ source: 'job-0', target: 'ctrl-0', sourceHandle: 'out', targetHandle: 'in' } as Connection, 'wfJob'),
  styledEdge({ source: 'job-0', target: 'act-0', sourceHandle: 'out', targetHandle: 'in' } as Connection, 'wfJob'),
  styledEdge({ source: 'job-0', target: 'limit-0', sourceHandle: 'limit', targetHandle: 'up' } as Connection, 'wfJob'),
  styledEdge({ source: 'ctrl-0', target: 'evt-0', sourceHandle: 'out', targetHandle: 'in' } as Connection, 'wfController'),
  styledEdge({ source: 'ctrl-0', target: 'evt-1', sourceHandle: 'out', targetHandle: 'in' } as Connection, 'wfController'),
]

function miniColor(node: Node): string {
  switch (node.type) {
    case 'wfTrigger': return WF.orange
    case 'wfAction': return WF.green
    case 'wfController': return WF.purple
    case 'wfLimit': return WF.cyan
    case 'wfNote': return '#d99a3d'
    default: return WF.blue
  }
}

function EditorInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES)
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES)
  const { screenToFlowPosition } = useReactFlow()
  const idRef = useRef(1)
  const [selected, setSelected] = useState<{ nodes: number; edges: number }>({ nodes: 0, edges: 0 })

  const nodeTypes = useMemo(() => workflowNodeTypes, [])

  const onConnect = useCallback(
    (params: Connection) => {
      const sourceType = nodes.find((n) => n.id === params.source)?.type
      setEdges((eds: Edge[]) => addEdge(styledEdge(params, sourceType), eds))
    },
    [nodes, setEdges],
  )

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData(DND_MIME) as keyof typeof workflowNodeTypes
      if (!type || !(type in workflowNodeTypes)) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const id = `${type}-${idRef.current++}`
      setNodes((nds: Node[]) => [...nds, { id, type, position, data: defaultData(type) }])
    },
    [screenToFlowPosition, setNodes],
  )

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: { nodes: Node[]; edges: Edge[] }) => {
    setSelected({ nodes: ns.length, edges: es.length })
  }, [])

  const clearGraph = () => {
    setNodes([])
    setEdges([])
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onSelectionChange={onSelectionChange}
      nodeTypes={nodeTypes}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.4}
      maxZoom={1.6}
      nodesDraggable
      nodesConnectable
      proOptions={{ hideAttribution: true }}
      className="bg-ops-black"
    >
      <Background variant={BackgroundVariant.Dots} color="#2a2a32" gap={22} size={1.6} />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap position="bottom-right" nodeColor={miniColor} maskColor="rgba(5,7,8,0.78)" pannable zoomable />

      {/* node palette — drag chips onto canvas */}
      <Panel position="top-left">
        <div className="border border-white/12 bg-black/85 p-2 backdrop-blur-sm">
          <p className="mb-2 px-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500">拖拽添加节点</p>
          <div className="grid gap-1.5">
            {PALETTE.map((item) => (
              <div
                key={item.type}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DND_MIME, item.type)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                className="flex cursor-grab items-center gap-2 border border-white/10 bg-white/3 px-2 py-1.5 text-2xs text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.07] active:cursor-grabbing"
              >
                <item.icon size={13} style={{ color: item.color }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {/* toolbar — selection + clear */}
      <Panel position="top-right">
        <div className="flex items-center gap-2 border border-white/12 bg-black/85 px-2.5 py-1.5 font-mono text-3xs text-zinc-400 backdrop-blur-sm">
          <span>{nodes.length} 节点 · {edges.length} 连线</span>
          {(selected.nodes > 0 || selected.edges > 0) && (
            <span className="text-zinc-200">选中 {selected.nodes}N/{selected.edges}E · Del 删除</span>
          )}
          <button
            type="button"
            onClick={clearGraph}
            className="ml-1 inline-flex items-center gap-1 border border-white/12 px-1.5 py-0.5 text-zinc-300 transition hover:border-red-400/40 hover:text-red-200"
          >
            <Trash2 size={11} /> 清空
          </button>
        </div>
      </Panel>
    </ReactFlow>
  )
}

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  )
}
