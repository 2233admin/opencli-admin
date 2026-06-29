// NodeWorkbench — ComfyUI-style node composition surface for @opencli/node-kit.
// - LEFT palette: drag (dnd-kit) or click an atomic node onto the canvas.
// - SEARCH popup (ComfyUI): double-click canvas / Tab / Ctrl+A → searchable menu.
// - COLLISION: dragging a node highlights + shakes overlapping nodes via xyflow's
//   getIntersectingNodes (right wheel for canvas nodes; dnd-kit handles only the
//   palette→canvas drag, where it doesn't fight xyflow's own drag system).
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
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
import { Network, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { instantiate, listNodes } from '../registry'
import { runGraph } from '../runtime/engine'
import type { ConfigValues, NodeCategory, NodeSpec } from '../spec'
import { iconByName } from './atoms'
import { elkLayout } from './elkLayout'
import { NodeSearchMenu } from './NodeSearchMenu'
import { nodeTypesForXyflow } from './nodeTypes'

const CATEGORY_LABEL: Record<NodeCategory, string> = {
  source: '源', transform: '变换', sink: '汇', control: '控制', display: '展示', agent: '智能体', custom: '其它',
}
const CATEGORY_COLOR: Record<NodeCategory, string> = {
  source: '#34d399', transform: '#38bdf8', sink: '#f59e0b', control: '#a78bfa', display: '#22d3ee', agent: '#f472b6', custom: '#a1a1aa',
}

function makeNode(type: string, position: { x: number; y: number }, seq: number): Node | null {
  const made = instantiate({ type, id: `${type}-${seq}`, config: {}, position })
  if (!made) return null
  return { id: made.instance.id, type, position, data: { config: made.instance.config } }
}

function PaletteChip({ spec, color, onClick }: { spec: NodeSpec; color: string; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${spec.type}`,
    data: { type: spec.type },
  })
  const Icon = iconByName(spec.icon)
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      {...listeners}
      {...attributes}
      className={`flex w-full cursor-grab items-center gap-2 px-3 py-1.5 text-left text-[12px] text-zinc-300 transition hover:bg-white/[0.05] hover:text-white active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      <span className="truncate">{spec.title}</span>
    </button>
  )
}

export interface WorkbenchSeed {
  nodes: Node[]
  edges: Edge[]
}

function WorkbenchInner({ seed }: { seed?: WorkbenchSeed }) {
  const nodeTypes = useMemo(() => nodeTypesForXyflow(), [])
  const palette = useMemo(() => listNodes(), [])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(seed?.nodes ?? [])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed?.edges ?? [])
  const { screenToFlowPosition, getIntersectingNodes, fitView } = useReactFlow()
  const seq = useRef(1)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const mouse = useRef({ cx: 0, cy: 0 })
  const [search, setSearch] = useState<{ rx: number; ry: number; cx: number; cy: number } | null>(null)
  const [dragType, setDragType] = useState<string | null>(null)
  const [laying, setLaying] = useState(false)

  const { setNodeRef: setDropRef } = useDroppable({ id: 'canvas' })
  const setWrap = useCallback(
    (el: HTMLDivElement | null) => {
      wrapRef.current = el
      setDropRef(el)
    },
    [setDropRef],
  )

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const add = useCallback(
    (type: string, position: { x: number; y: number }) => {
      const n = makeNode(type, position, seq.current++)
      if (n) setNodes((nds) => [...nds, n])
    },
    [setNodes],
  )

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, type: 'default', animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges],
  )

  const openSearch = useCallback((cx: number, cy: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    setSearch({ rx: cx - (rect?.left ?? 0), ry: cy - (rect?.top ?? 0), cx, cy })
  }, [])

  const pick = useCallback(
    (type: string) => {
      if (search) add(type, screenToFlowPosition({ x: search.cx, y: search.cy }))
      setSearch(null)
    },
    [search, add, screenToFlowPosition],
  )

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragType(null)
      const type = e.active.data.current?.type as string | undefined
      if (!type || e.over?.id !== 'canvas') return
      const ae = e.activatorEvent as PointerEvent
      add(type, screenToFlowPosition({ x: ae.clientX + e.delta.x, y: ae.clientY + e.delta.y }))
    },
    [add, screenToFlowPosition],
  )

  // keyboard: Tab / Ctrl+A open the search popup at the last cursor position
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'Tab' || (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        openSearch(mouse.current.cx || 300, mouse.current.cy || 200)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch])

  // collision: highlight nodes the dragged one overlaps (xyflow intersection)
  const onNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      const hits = new Set(getIntersectingNodes(node).map((n) => n.id))
      setNodes((nds) => nds.map((n) => ({ ...n, className: hits.has(n.id) ? 'kit-collide' : '' })))
    },
    [getIntersectingNodes, setNodes],
  )
  const onNodeDragStop = useCallback(() => {
    setNodes((nds) => nds.map((n) => (n.className ? { ...n, className: '' } : n)))
  }, [setNodes])

  // run the graph through the self-built P0 runtime
  const runNow = useCallback(async () => {
    if (nodes.length === 0) {
      toast.message('画布为空，先加几个节点')
      return
    }
    const rn = nodes.map((n) => ({
      id: n.id,
      type: String(n.type),
      config: ((n.data as { config?: ConfigValues })?.config ?? {}) as ConfigValues,
    }))
    const re = edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle }))
    const res = await runGraph(rn, re)
    const errCount = Object.keys(res.errors).length
    if (errCount) toast.error(`运行完成 · ${errCount} 个节点出错（看 console）`)
    else toast.success(`运行完成 · ${res.order.length} 节点 · artifact ${Object.keys(res.artifact).length} 项`)
    console.log('[node-kit runGraph]', res)
  }, [nodes, edges])

  // ELK auto-layout: snap the scattered graph into a clean left→right dataflow.
  const tidy = useCallback(async () => {
    if (nodes.length === 0) {
      toast.message('画布为空，先加几个节点')
      return
    }
    setLaying(true)
    try {
      const next = await elkLayout(nodes, edges)
      setNodes(next)
      requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 400 }))
    } catch (err) {
      console.error('[node-kit elkLayout]', err)
      toast.error('自动布局失败（看 console）')
    } finally {
      setLaying(false)
    }
  }, [nodes, edges, setNodes, fitView])

  const groups = useMemo(() => {
    const m = new Map<NodeCategory, NodeSpec[]>()
    for (const s of palette) {
      const g = m.get(s.category) ?? []
      g.push(s)
      m.set(s.category, g)
    }
    return [...m.entries()]
  }, [palette])

  const dragSpec = dragType ? palette.find((s) => s.type === dragType) : null

  return (
    <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragType((e.active.data.current?.type as string) ?? null)} onDragEnd={onDragEnd}>
      <div className="flex h-full overflow-hidden rounded-md border border-white/[0.1] bg-black">
        {/* LEFT palette — ComfyUI-style, dnd-kit draggable */}
        <div className="w-44 shrink-0 overflow-auto border-r border-white/[0.1] bg-[#0b0c0e] py-2">
          <p className="px-3 pb-1 font-telemetry text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            节点 · 拖入或点按
          </p>
          {groups.map(([cat, specs]) => (
            <div key={cat} className="mt-1.5">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: CATEGORY_COLOR[cat] }}>
                {CATEGORY_LABEL[cat]}
              </p>
              {specs.map((s) => (
                <PaletteChip
                  key={s.type}
                  spec={s}
                  color={CATEGORY_COLOR[cat]}
                  onClick={() => add(s.type, { x: 80 + (seq.current % 5) * 170, y: 60 + Math.floor(seq.current / 5) * 140 })}
                />
              ))}
            </div>
          ))}
        </div>

        {/* canvas */}
        <div
          ref={setWrap}
          className="relative flex-1"
          onMouseMove={(e: ReactMouseEvent<HTMLDivElement>) => {
            mouse.current = { cx: e.clientX, cy: e.clientY }
          }}
          onDoubleClick={(e: ReactMouseEvent<HTMLDivElement>) => {
            const t = e.target as HTMLElement
            if (t.closest('.react-flow__node')) return
            openSearch(e.clientX, e.clientY)
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            minZoom={0.3}
            maxZoom={1.6}
            nodesDraggable
            nodesConnectable
            proOptions={{ hideAttribution: true }}
            className="bg-[#060608]"
          >
            <Background variant={BackgroundVariant.Dots} color="#2a2a32" gap={22} size={1.6} />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap position="bottom-right" maskColor="rgba(6,6,8,0.78)" pannable zoomable />
          </ReactFlow>

          {nodes.length === 0 && !search && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="text-center text-xs text-zinc-600">
                双击画布 / Tab / Ctrl+A 搜索加节点 · 或从左侧拖入
                <br />连 handle 组合功能
              </p>
            </div>
          )}

          {search && (
            <NodeSearchMenu x={search.rx} y={search.ry} specs={palette} onPick={pick} onClose={() => setSearch(null)} />
          )}

          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={tidy}
              disabled={laying}
              title="按数据流自动排版 (ELK)"
              className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:opacity-50"
            >
              <Network size={12} /> {laying ? '布局中…' : '自动布局'}
            </button>
            <button
              type="button"
              onClick={runNow}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
            >
              <Play size={12} /> 运行
            </button>
            <button
              type="button"
              onClick={() => {
                setNodes([])
                setEdges([])
              }}
              className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-black/80 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-red-400/40 hover:text-red-200"
            >
              <Trash2 size={12} /> 清空
            </button>
          </div>
        </div>
      </div>

      {/* dnd-kit drag ghost */}
      <DragOverlay dropAnimation={null}>
        {dragSpec ? (
          <div className="flex items-center gap-2 rounded-md border border-sky-500/50 bg-[#0c0d10] px-3 py-1.5 text-[12px] text-zinc-100 shadow-xl">
            {(() => {
              const Icon = iconByName(dragSpec.icon)
              return <Icon className="h-3.5 w-3.5 text-sky-300" />
            })()}
            {dragSpec.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export function NodeWorkbench({ seed }: { seed?: WorkbenchSeed }) {
  return (
    <ReactFlowProvider>
      <WorkbenchInner seed={seed} />
    </ReactFlowProvider>
  )
}
