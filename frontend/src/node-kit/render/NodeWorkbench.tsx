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
import { Boxes, Loader2, Network, Play, Sparkles, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  buildMacroDef,
  flattenForRun,
  getMacroDef,
  inlineMacro,
  listMacros,
  registerMacroSpec,
  saveMacro,
  type MacroDef,
} from '../macros'
import { instantiateGraph, type AgentGraph } from '../agent/graph'
import { getNode, instantiate, listNodes } from '../registry'
import { runGraph } from '../runtime/engine'
import { applyRunEvent, summarizeRun, toRunLogRows, EMPTY_RUN_STATE, type RunStateMap } from '../runtime/runLog'
import type { ConfigValues, NodeCategory, NodeSpec } from '../spec'
import { iconByName } from './atoms'
import { elkLayout } from './elkLayout'
import { NodeInspector } from './NodeInspector'
import { NodeSearchMenu } from './NodeSearchMenu'
import { nodeTypesForXyflow } from './nodeTypes'
import { RunLogPanel } from './RunLogPanel'

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

// Drop transient/runtime-only fields before a node goes into a saved macro so the
// def never carries collision ghost classes ('kit-collide') or stale selection.
function stripTransient(n: Node): Node {
  const { className: _c, selected: _s, dragging: _d, ...rest } = n
  return rest as Node
}

// Run log rows only carry a nodeId (the engine is React-free); resolve a
// human title from the live xyflow node list, falling back to the spec title
// for the node's type, then the raw id if the node was since deleted.
function nodeTitleFor(nodes: Node[], nodeId: string): string {
  const n = nodes.find((nn) => nn.id === nodeId)
  if (!n) return nodeId
  const spec = getNode(String(n.type))
  return spec?.title ?? String(n.type)
}

function centroid(ns: Node[]): { x: number; y: number } {
  if (ns.length === 0) return { x: 0, y: 0 }
  const sum = ns.reduce(
    (acc, n) => ({ x: acc.x + (n.position?.x ?? 0), y: acc.y + (n.position?.y ?? 0) }),
    { x: 0, y: 0 },
  )
  return { x: sum.x / ns.length, y: sum.y / ns.length }
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
  // registryVersion makes nodeTypes/palette re-derive when a macro is registered
  // IN-SESSION (组成宏). Boot-time saved macros are already registered before mount;
  // this covers the create-now case the empty-dep memos would otherwise miss.
  const [registryVersion, setRegistryVersion] = useState(0)
  const nodeTypes = useMemo(() => nodeTypesForXyflow(), [registryVersion])
  const palette = useMemo(() => listNodes(), [registryVersion])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(seed?.nodes ?? [])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed?.edges ?? [])
  const { screenToFlowPosition, getIntersectingNodes, fitView, updateNodeData } = useReactFlow()
  // xyflow writes node.selected into state via onNodesChange, so read selection
  // straight off the nodes array — no onSelectionChange plumbing needed.
  const selected = useMemo(() => nodes.filter((n) => n.selected), [nodes])
  const selectedOne = selected.length === 1 ? selected[0] : null
  const seq = useRef(1)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const mouse = useRef({ cx: 0, cy: 0 })
  const [search, setSearch] = useState<{ rx: number; ry: number; cx: number; cy: number } | null>(null)
  const [dragType, setDragType] = useState<string | null>(null)
  const [laying, setLaying] = useState(false)
  const [running, setRunning] = useState(false)
  const [runState, setRunState] = useState<RunStateMap>(EMPTY_RUN_STATE)
  // Ref mirror of runState for the run observer: events arrive from async
  // engine code, and accumulating on the ref lets us call xyflow's
  // updateNodeData OUTSIDE the setState updater (calling it inside the
  // updater is a setState-during-render violation against BatchProvider).
  const runStateRef = useRef<RunStateMap>(EMPTY_RUN_STATE)
  const runSeq = useRef(0)
  const abortRef = useRef<{ aborted: boolean } | null>(null)

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

  // ── Macro: collapse a multi-node selection into one reusable node ───────────
  const groupIntoMacro = useCallback(() => {
    if (selected.length < 2) return
    // Nested macros are out of MVP scope — refuse if any selected node is a macro.
    if (selected.some((n) => getMacroDef(String(n.type)))) {
      toast.error('暂不支持把宏再组成宏')
      return
    }
    const name = window.prompt('宏名称', `宏 ${listMacros().length + 1}`)?.trim()
    if (!name) return

    const ids = new Set(selected.map((n) => n.id))
    const subNodes = selected.map(stripTransient)
    const internalEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    const crossingIn = edges.filter((e) => !ids.has(e.source) && ids.has(e.target))
    const crossingOut = edges.filter((e) => ids.has(e.source) && !ids.has(e.target))

    const def = buildMacroDef(name, subNodes, internalEdges)
    saveMacro(def)
    registerMacroSpec(def)
    // bump so the (empty-dep) nodeTypes/palette memos re-derive and the new macro
    // type both renders on canvas and shows in the left palette.
    setRegistryVersion((v) => v + 1)

    const macroNode: Node = {
      id: `${def.id}#1`,
      type: def.id,
      position: centroid(selected),
      data: { config: { __macro: true } },
    }
    // Rewrite crossing edges onto the macro's synthetic ports
    // (port id === innerNodeId:innerHandle, which buildMacroDef guarantees exists).
    const rewired: Edge[] = [
      ...edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      ...crossingIn.map((e) => ({
        ...e,
        target: macroNode.id,
        targetHandle: `${e.target}:${e.targetHandle ?? 'in'}`,
      })),
      ...crossingOut.map((e) => ({
        ...e,
        source: macroNode.id,
        sourceHandle: `${e.source}:${e.sourceHandle ?? 'out'}`,
      })),
    ]
    setNodes((nds) => [...nds.filter((n) => !ids.has(n.id)), macroNode])
    setEdges(rewired)
    toast.success(`已组成宏「${name}」· ${subNodes.length} 节点（双击展开）`)
  }, [selected, edges, setNodes, setEdges])

  // ── Macro: double-click a macro node to expand it back into its subgraph ─────
  const expandMacroNode = useCallback(
    (macroNode: Node, def: MacroDef) => {
      // Compute once from the current closure (nodes+edges both in deps) and set
      // atomically — two inlineMacro calls with split snapshots tear the graph.
      const next = inlineMacro(nodes, edges, macroNode, def)
      setNodes(next.nodes)
      setEdges(next.edges)
    },
    [nodes, edges, setNodes, setEdges],
  )

  const onNodeDoubleClick = useCallback(
    (_: ReactMouseEvent, node: Node) => {
      const def = getMacroDef(String(node.type))
      if (!def) return // only macro nodes expand
      expandMacroNode(node, def)
    },
    [expandMacroNode],
  )

  // Push the latest runState entry for one node onto its xyflow node.data so
  // KitNode can render it — mirrors how config edits already flow (updateNodeData).
  const pushRunStateToNode = useCallback(
    (nodeId: string, map: RunStateMap) => {
      updateNodeData(nodeId, { runState: map[nodeId] })
    },
    [updateNodeData],
  )

  // run the graph through the self-built P0 runtime, observing per-node state
  // transitions into runState (drives KitNode borders + the run log panel).
  const runNow = useCallback(async () => {
    if (nodes.length === 0) {
      toast.message('画布为空，先加几个节点')
      return
    }
    if (running) return
    // Flatten macros → atoms before running; the engine is macro-blind by design.
    const flat = flattenForRun(nodes, edges)
    const rn = flat.nodes.map((n) => ({
      id: n.id,
      type: String(n.type),
      config: ((n.data as { config?: ConfigValues })?.config ?? {}) as ConfigValues,
    }))
    const re = flat.edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle }))

    // fresh run: clear the panel + every node's stale border before starting
    runStateRef.current = EMPTY_RUN_STATE
    setRunState(EMPTY_RUN_STATE)
    for (const n of rn) pushRunStateToNode(n.id, EMPTY_RUN_STATE)
    runSeq.current = 0
    const signal = { aborted: false }
    abortRef.current = signal
    setRunning(true)

    try {
      const res = await runGraph(rn, re, {
        signal,
        observer: (nodeId, state, detail) => {
          const seq = runSeq.current++
          const next = applyRunEvent(runStateRef.current, nodeId, state, detail, seq)
          runStateRef.current = next
          setRunState(next)
          pushRunStateToNode(nodeId, next)
        },
      })
      const errCount = Object.keys(res.errors).length
      if (signal.aborted) toast.message('运行已停止')
      else if (errCount) toast.error(`运行完成 · ${errCount} 个节点出错`)
      else toast.success(`运行完成 · ${res.order.length} 节点 · artifact ${Object.keys(res.artifact).length} 项`)
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [nodes, edges, running, pushRunStateToNode])

  const stopRun = useCallback(() => {
    if (abortRef.current) abortRef.current.aborted = true
  }, [])

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

  // Property-panel edit → write back to the selected node's data.config.
  const setSelectedField = useCallback(
    (key: string, value: unknown) => {
      if (!selectedOne) return
      updateNodeData(selectedOne.id, {
        config: { ...((selectedOne.data as { config?: ConfigValues })?.config ?? {}), [key]: value },
      })
    },
    [updateNodeData, selectedOne],
  )

  // AI graph authoring: paste an agent-emitted {nodes,edges} JSON → validate →
  // load onto the canvas, surfacing every validation problem to console + toast.
  const importAgentGraph = useCallback(() => {
    const raw = window.prompt('粘贴 AI 产出的图 JSON：{"nodes":[{"type":"value","config":{}}],"edges":[]}')
    if (!raw) return
    let parsed: AgentGraph
    try {
      parsed = JSON.parse(raw) as AgentGraph
    } catch {
      toast.error('JSON 解析失败')
      return
    }
    const res = instantiateGraph(parsed)
    if (res.errors.length) console.warn('[node-kit instantiateGraph]', res.errors)
    if (res.nodes.length === 0) {
      toast.error(`产图失败：${res.errors[0] ?? '无有效节点'}`)
      return
    }
    setNodes(res.nodes)
    setEdges(res.edges)
    requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 400 }))
    if (res.errors.length) toast.warning(`产图完成 · ${res.nodes.length} 节点，${res.errors.length} 个告警（看 console）`)
    else toast.success(`产图完成 · ${res.nodes.length} 节点 · ${res.edges.length} 边`)
  }, [setNodes, setEdges, fitView])

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
            onNodeDoubleClick={onNodeDoubleClick}
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
              onClick={groupIntoMacro}
              disabled={selected.length < 2}
              title="把选中的多个节点折叠成一个可复用宏（双击展开）"
              className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-40"
            >
              <Boxes size={12} /> 组成宏{selected.length >= 2 ? ` (${selected.length})` : ''}
            </button>
            <button
              type="button"
              onClick={importAgentGraph}
              title="粘贴 AI 产出的节点图 JSON，校验后落到画布"
              className="inline-flex items-center gap-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/20"
            >
              <Sparkles size={12} /> AI 产图
            </button>
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
              disabled={running}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {running ? '运行中…' : '运行'}
            </button>
            {running && (
              <button
                type="button"
                onClick={stopRun}
                title="在当前节点执行完后停止后续节点"
                className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-100 transition hover:bg-red-500/20"
              >
                <Square size={12} /> 停止
              </button>
            )}
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

          <RunLogPanel runState={runState} titleFor={(id) => nodeTitleFor(nodes, id)} />
        </div>
        {selectedOne && <NodeInspector node={selectedOne} onField={setSelectedField} />}
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
