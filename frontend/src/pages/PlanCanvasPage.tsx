// Collection Canvas — edit + observe lenses (Plan IR issue 07/08,
// docs/plan-ir-PRD.md ADR-0008). ONE canvas, two lenses (PageHeader toggle),
// no separate page/route:
//  - edit: palette -> Draft Source Node -> inspector (materialize/edit) ->
//    wire -> save through the Plans API (issue 02).
//  - observe (issue 08): source nodes get their existing per-source
//    ControlBadge/SensorCoverageBadge strip (stamping config.__entityId, the
//    same convention the main topology canvas uses — see node-kit/nodes/
//    sources.tsx SourceBody); shared nodes get Plan Health
//    (GET /plans/{id}/health, 15s poll, same precedent as
//    node-kit/render/controlState.tsx's CONTROL_STATE_POLL_MS); a Run button
//    dispatches POST /plans/{id}/run and projects the response (+ health
//    refetch) onto per-node execution state using KitNode's existing
//    running/success/error border convention (node-kit/render/KitNode.tsx
//    RUN_STATE_BORDER) — no new execution-state visuals invented here.
// Reuses node-kit's registry/KitNode/elkLayout, the existing ChannelConfigForm
// as the inspector's internals, ConfirmDialog for the detach-not-delete flow,
// and the existing i18n layer for every user-facing string. View-model logic
// (IR<->canvas projection, draft lifecycle, preset->param mapping, error
// anchoring, lens state, run-state projection) lives in
// lib/planCanvasModel.ts / lib/planRunModel.ts as framework-free functions
// with node --test coverage — this file only wires those pure functions to
// xyflow/React Query.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Boxes, ChevronLeft, Eye, Group, LayoutGrid, Network, Pencil, Play, Save, Ungroup, Workflow } from 'lucide-react'

import { getPlanHealth, createPlan, getPlan, runPlan, updatePlan } from '../api/endpoints'
import type { PlanEdge, PlanNode } from '../api/types'
import { CanvasToolbarButton } from '../components/CanvasToolbarButton'
import ConfirmDialog from '../components/ConfirmDialog'
import ErrorAlert from '../components/ErrorAlert'
import { PageLoader } from '../components/LoadingSpinner'
import PageHeader from '../components/PageHeader'
import NetworkPage from '../labs/topology/NetworkPage'
import { ALL_NODES, nodeTypesForXyflow, registerNodes } from '../node-kit'
import { CONTROL_STATE_POLL_MS } from '../node-kit/render/controlState'
import { elkLayout } from '../node-kit/render/elkLayout'
import type { RunStateMap } from '../node-kit/runtime/runLog'
import {
  anchorValidationErrors,
  buildSubnetView,
  canvasToPlanGraph,
  createDraftNodeFromPreset,
  createDraftSourceNode,
  deriveDraftAndRunnable,
  detachNode,
  extractPlanValidationErrors,
  fallbackPosition,
  listCanvasGroups,
  materializeDraftNode,
  planGraphToCanvas,
  readCanvasGroup,
  withCanvasGroup,
  type CanvasEdge,
  type CanvasGraph,
  type CanvasNode,
} from '../lib/planCanvasModel'
import {
  evaluateRunGate,
  markNodesRunning,
  mergeRunState,
  projectHealthOntoSharedNodes,
  projectPlanRunOntoNodes,
  sourceNodeIds,
  toggleLens,
  type PlanCanvasLens,
} from '../lib/planRunModel'
import { PlanCanvasInspector } from './PlanCanvasInspector'
import { PALETTE_DRAG_MIME, PlanCanvasPalette, parsePalettePayload, type PaletteDropPayload } from './PlanCanvasPalette'

const PLAN_IR_VERSION = '1.0.0'

registerNodes(ALL_NODES)

type FlowNode = Node<{
  config: Record<string, unknown>
  facts: Record<string, unknown>
  runState?: RunStateMap[string]
}>
type FlowEdge = Edge

function toFlowNode(
  n: CanvasNode,
  draft: boolean,
  errors: string[],
  opts: { observe: boolean; runState?: RunStateMap[string] },
): FlowNode {
  // Observe lens (issue 08): stamp config.__entityId with the real source id
  // so a materialized source node's SourceBody (node-kit/nodes/sources.tsx)
  // activates its existing ControlBadge/SensorCoverageBadge polling strip —
  // the exact convention the main topology canvas already uses. The edit
  // lens never stamps this, so editing never accidentally starts polling.
  const config =
    opts.observe && n.planNode.kind === 'source' && n.planNode.source_id
      ? { ...n.planNode.params, __entityId: n.planNode.source_id }
      : n.planNode.params
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      config,
      facts: { __draft: draft, __errors: errors },
      runState: opts.runState,
    },
  }
}

const EDGE_STROKE = '#38bdf8'
const EDGE_STYLE = {
  type: 'smoothstep' as const,
  markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STROKE, width: 18, height: 18 },
  style: { stroke: EDGE_STROKE, strokeWidth: 1.75 },
}

function toFlowEdge(e: CanvasEdge): FlowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    ...EDGE_STYLE,
  }
}

// ── Subnet node (Houdini-style 功能层 placeholder) ───────────────────────────
// Collapsed representation of a function group at the top hierarchy level.
// Double-click dives into the group (handled by the page's onNodeDoubleClick);
// its handles are display-only anchors for aggregated boundary edges — real
// wiring always happens between atomic nodes inside the dive view.

const SUBNET_ID_PREFIX = '__subnet-'
const subnetFlowId = (groupId: string) => `${SUBNET_ID_PREFIX}${groupId}`
const groupIdFromSubnet = (flowId: string) =>
  flowId.startsWith(SUBNET_ID_PREFIX) ? flowId.slice(SUBNET_ID_PREFIX.length) : null

function SubnetFlowNode({ data, selected }: { data: FlowNode['data']; selected?: boolean }) {
  const label = typeof data.config.label === 'string' ? data.config.label : '功能组'
  const count = typeof data.config.count === 'number' ? data.config.count : 0
  return (
    <div
      className={`min-w-44 rounded-lg border-2 bg-ops-raised px-4 py-3 shadow-lg transition-colors ${
        selected ? 'border-primary-500' : 'border-dashed border-white/25 hover:border-white/45'
      }`}
    >
      <Handle type="target" id="in" position={Position.Left} isConnectable={false} className="!bg-zinc-500" />
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/8 text-zinc-300">
          <Boxes size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">{label}</p>
          <p className="font-telemetry text-3xs uppercase tracking-[0.14em] text-zinc-500">
            功能组 · {count} 个节点
          </p>
        </div>
      </div>
      <p className="mt-1.5 text-3xs text-zinc-600">双击进入</p>
      <Handle type="source" id="out" position={Position.Right} isConnectable={false} className="!bg-zinc-500" />
    </div>
  )
}

function PlanCanvasInner() {
  const { t } = useTranslation()
  const { planId: routePlanId } = useParams<{ planId?: string }>()
  // The /plans/new route matches :planId literally as "new" — treat that (or
  // an absent param) as "no existing Plan to load", never as a real id.
  const planId = routePlanId && routePlanId !== 'new' ? routePlanId : undefined
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isNew = !planId

  const planQuery = useQuery({
    queryKey: ['plan-canvas', 'plan', planId],
    queryFn: () => getPlan(planId as string),
    enabled: Boolean(planId),
  })

  const [planName, setPlanName] = useState('')
  const [planNodes, setPlanNodes] = useState<PlanNode[]>([])
  const [planEdges, setPlanEdges] = useState<PlanEdge[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detachTarget, setDetachTarget] = useState<string | null>(null)
  const [errorsByNode, setErrorsByNode] = useState<Map<string, string[]>>(new Map())
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const [laying, setLaying] = useState(false)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const seq = useRef(0)

  // ── Observe lens (issue 08) ────────────────────────────────────────────────
  const [lens, setLens] = useState<PlanCanvasLens>('edit')
  const isObserve = lens === 'observe'
  const [runState, setRunState] = useState<RunStateMap>({})

  // Plan Health for shared nodes — same 15s poll precedent as the source
  // control-state strip (node-kit/render/controlState.tsx CONTROL_STATE_POLL_MS).
  // Only polls once there's a saved Plan (a brand-new unsaved Plan has no
  // health rows to fetch) and only while the observe lens is showing.
  const planHealthQuery = useQuery({
    queryKey: ['plan-canvas', 'plan-health', planId],
    queryFn: () => getPlanHealth(planId as string),
    enabled: Boolean(planId) && isObserve,
    refetchInterval: isObserve ? CONTROL_STATE_POLL_MS : false,
  })

  // Merge Plan Health (shared nodes) under whatever the last run projected —
  // a run's own response is fresher than a subsequent poll landing later,
  // but a poll after the run completes should still refresh Plan Health, so
  // this recomputes the shared-node half of runState on every health fetch
  // without touching the source-node half.
  useEffect(() => {
    if (!planHealthQuery.data) return
    const healthState = projectHealthOntoSharedNodes(planNodes, planHealthQuery.data.data)
    setRunState((prev) => mergeRunState(prev, healthState))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planHealthQuery.data])

  const { draft: planDraftFlag, runnable: planRunnableFlag } = deriveDraftAndRunnable(planNodes)
  const runGate = evaluateRunGate({ draft: planDraftFlag, runnable: planRunnableFlag })

  const runMut = useMutation({
    mutationFn: async () => {
      const ids = sourceNodeIds(planNodes)
      setRunState((prev) => mergeRunState(prev, markNodesRunning(ids)))
      return runPlan(planId as string)
    },
    onSuccess: (result) => {
      setRunState((prev) => mergeRunState(prev, projectPlanRunOntoNodes(planNodes, result)))
      qc.invalidateQueries({ queryKey: ['plan-canvas', 'plan-health', planId] })
      if (result.success) {
        toast.success(t('planCanvas.run.success'))
      } else {
        toast.error(result.error ? t('planCanvas.run.partialFailure', { error: result.error }) : t('planCanvas.run.failed'))
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('planCanvas.run.failed'))
    },
  })

  const nodeTypes = useMemo(() => ({ ...nodeTypesForXyflow(), __subnet: SubnetFlowNode }), [])

  // ── 三层节点层级 (项目→功能→实现, Houdini-style dive) ─────────────────────
  // null = 功能层 (groups collapsed to subnet nodes); a group id = 实现层 dive.
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const planGroups = useMemo(() => listCanvasGroups(planNodes), [planNodes])
  const activeGroupInfo = activeGroup ? planGroups.find((g) => g.id === activeGroup) ?? null : null

  // Diving into a group refits the viewport onto its members.
  useEffect(() => {
    const handle = setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup])

  // Load an existing Plan's graph onto the canvas (round-trip fidelity: the
  // same PlanGraph this page later saves is what a re-fetch reprojects).
  useEffect(() => {
    if (!planQuery.data) return
    setPlanName(planQuery.data.name)
    setPlanNodes(planQuery.data.graph.nodes)
    setPlanEdges(planQuery.data.graph.edges)
  }, [planQuery.data])

  useEffect(() => {
    if (isNew) {
      setPlanName(t('planCanvas.namePlaceholder'))
    }
  }, [isNew, t])

  const currentGraph: CanvasGraph = useMemo(
    () => planGraphToCanvas({ ir_version: PLAN_IR_VERSION, draft: false, nodes: planNodes, edges: planEdges }),
    [planNodes, planEdges],
  )

  // Sync the pure-model graph -> xyflow controlled state, filtered through the
  // active hierarchy level (buildSubnetView). Positions come from whatever the
  // operator last dragged to (preserved via rfNodes lookup), falling back to
  // the model's projected position for a brand-new node.
  const subnetView = useMemo(() => buildSubnetView(currentGraph, activeGroup), [currentGraph, activeGroup])

  useEffect(() => {
    setRfNodes((prev) => {
      const posById = new Map(prev.map((n) => [n.id, n.position]))
      const atomic = subnetView.nodes.map((n, index) => {
        const draft = n.planNode.kind === 'source' && n.planNode.draft === true && !n.planNode.source_id
        const errors = errorsByNode.get(n.id) ?? []
        const flow = toFlowNode(n, draft, errors, { observe: isObserve, runState: runState[n.id] })
        return { ...flow, position: posById.get(n.id) ?? n.position ?? fallbackPosition(index) }
      })
      const subnets: FlowNode[] = subnetView.subnets.map((s) => ({
        id: subnetFlowId(s.group.id),
        type: '__subnet',
        position: posById.get(subnetFlowId(s.group.id)) ?? s.position,
        data: { config: { label: s.group.label, count: s.memberCount }, facts: {} },
      }))
      return [...atomic, ...subnets]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subnetView, errorsByNode, isObserve, runState])

  useEffect(() => {
    setRfEdges(subnetView.edges.map(toFlowEdge))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subnetView])

  const selectedPlanNode = selectedId ? planNodes.find((n) => n.id === selectedId) ?? null : null

  const addNode = useCallback((node: PlanNode, position: { x: number; y: number }) => {
    setPlanNodes((prev) => [...prev, { ...node, params: { ...node.params, __canvas_position: position } }])
  }, [])

  const dropAt = useCallback(
    (payload: PaletteDropPayload, position: { x: number; y: number }): string => {
      const id = `n-${Date.now()}-${seq.current++}`
      // While dived into a function group, everything dropped belongs to it —
      // the same rule Houdini applies to nodes created inside a subnet.
      const stamp = (n: PlanNode): PlanNode => (activeGroupInfo ? withCanvasGroup(n, activeGroupInfo) : n)
      if (payload.kind === 'preset') {
        addNode(stamp(createDraftNodeFromPreset(payload.preset, position, id)), position)
      } else if (payload.kind === 'draft-channel') {
        addNode(stamp(createDraftSourceNode(payload.channelType, position, id)), position)
      } else {
        addNode(
          stamp({
            id,
            kind: payload.nodeKind,
            type: payload.nodeKind,
            label: undefined,
            params: {},
            required_params: [],
            inputs: payload.nodeKind === 'merge' ? [{ name: 'a', type: 'any' }, { name: 'b', type: 'any' }] : [{ name: 'in', type: 'any' }],
            outputs: payload.nodeKind === 'sink' ? [] : [{ name: 'out', type: 'any' }],
            source_id: undefined,
            draft: false,
          }),
          position,
        )
      }
      return id
    },
    [addNode, activeGroupInfo],
  )

  // ── 功能组操作: 组合 / 解散 / 重命名 / 钻入 ────────────────────────────────
  const selectedAtomicIds = useMemo(
    () => rfNodes.filter((n) => n.selected && !n.id.startsWith(SUBNET_ID_PREFIX)).map((n) => n.id),
    [rfNodes],
  )

  const groupSelection = useCallback(() => {
    if (selectedAtomicIds.length < 2) return
    const ids = new Set(selectedAtomicIds)
    const gid = `g-${Date.now()}`
    const label = `功能组 ${planGroups.length + 1}`
    setPlanNodes((prev) => prev.map((n) => (ids.has(n.id) ? withCanvasGroup(n, { id: gid, label }) : n)))
    toast.success(`已组合 ${ids.size} 个节点为「${label}」，双击子网节点进入`)
  }, [selectedAtomicIds, planGroups.length])

  const dissolveActiveGroup = useCallback(() => {
    if (!activeGroup) return
    setPlanNodes((prev) => prev.map((n) => (readCanvasGroup(n)?.id === activeGroup ? withCanvasGroup(n, null) : n)))
    setActiveGroup(null)
  }, [activeGroup])

  const renameActiveGroup = useCallback(
    (label: string) => {
      if (!activeGroup || !label.trim()) return
      setPlanNodes((prev) =>
        prev.map((n) =>
          readCanvasGroup(n)?.id === activeGroup ? withCanvasGroup(n, { id: activeGroup, label: label.trim() }) : n,
        ),
      )
    },
    [activeGroup],
  )

  const onPaletteClickPick = useCallback(
    (payload: PaletteDropPayload) => {
      const position = { x: 80 + (seq.current % 5) * 200, y: 60 + Math.floor(seq.current / 5) * 160 }
      dropAt(payload, position)
    },
    [dropAt],
  )

  // Reject connections that can't make sense before they're ever created: no
  // self-loops, and no duplicate wire between the exact same port pair (xyflow
  // already prevents output→output / input→input via handle types).
  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      if (!conn.source || !conn.target) return false
      if (conn.source === conn.target) return false
      return !planEdges.some(
        (e) =>
          e.source_node === conn.source &&
          e.target_node === conn.target &&
          (e.source_port ?? 'out') === (conn.sourceHandle ?? 'out') &&
          (e.target_port ?? 'in') === (conn.targetHandle ?? 'in'),
      )
    },
    [planEdges],
  )

  const onConnect = useCallback(
    (params: Connection) => {
      const id = `e-${params.source}-${params.sourceHandle}-${params.target}-${params.targetHandle}`
      setPlanEdges((prev) => [
        ...prev,
        {
          id,
          source_node: params.source ?? '',
          source_port: params.sourceHandle ?? 'out',
          target_node: params.target ?? '',
          target_port: params.targetHandle ?? 'in',
        },
      ])
      // Keep the rf edge id aligned with the plan edge id (and styled like the
      // rest) so the two stay in sync for later selection / deletion.
      setRfEdges((eds) => addEdge({ ...params, id, ...EDGE_STYLE }, eds))
    },
    [setRfEdges],
  )

  // "Add node on edge drop" (ReactFlow official pattern): dropping a
  // connection line on empty canvas opens an in-place picker; choosing a kind
  // creates the node at the drop point and wires it to the dragged-from port.
  const [edgeDropMenu, setEdgeDropMenu] = useState<{
    client: { x: number; y: number }
    flow: { x: number; y: number }
    fromNodeId: string
    fromHandle: string
  } | null>(null)

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: { isValid: boolean | null; fromNode: { id: string } | null; fromHandle: { id?: string | null } | null }) => {
      if (connectionState.isValid || !connectionState.fromNode) return
      const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event
      setEdgeDropMenu({
        client: { x: clientX, y: clientY },
        flow: screenToFlowPosition({ x: clientX, y: clientY }),
        fromNodeId: connectionState.fromNode.id,
        fromHandle: connectionState.fromHandle?.id ?? 'out',
      })
    },
    [screenToFlowPosition],
  )

  const insertNodeFromEdgeDrop = useCallback(
    (nodeKind: 'transform' | 'merge' | 'sink') => {
      if (!edgeDropMenu) return
      const newId = dropAt({ kind: 'graph-node', nodeKind }, edgeDropMenu.flow)
      const targetPort = nodeKind === 'merge' ? 'a' : 'in'
      const edgeId = `e-${edgeDropMenu.fromNodeId}-${edgeDropMenu.fromHandle}-${newId}-${targetPort}`
      setPlanEdges((prev) => [
        ...prev,
        {
          id: edgeId,
          source_node: edgeDropMenu.fromNodeId,
          source_port: edgeDropMenu.fromHandle,
          target_node: newId,
          target_port: targetPort,
        },
      ])
      setEdgeDropMenu(null)
    },
    [edgeDropMenu, dropAt],
  )

  // Deleting a wire on the canvas must also drop it from planEdges (the source
  // of truth the graph re-projects from) — otherwise a deleted edge silently
  // reappears on the next re-render and gets saved back. Match by endpoints so
  // it works regardless of how the edge id was generated.
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    setPlanEdges((prev) =>
      prev.filter(
        (pe) =>
          !deleted.some(
            (d) =>
              d.source === pe.source_node &&
              d.target === pe.target_node &&
              (d.sourceHandle ?? 'out') === (pe.source_port ?? 'out') &&
              (d.targetHandle ?? 'in') === (pe.target_port ?? 'in'),
          ),
      ),
    )
  }, [])

  const requestDetach = useCallback((nodeId: string) => setDetachTarget(nodeId), [])

  const confirmDetach = useCallback(() => {
    if (!detachTarget) return
    const next = detachNode(currentGraph, detachTarget)
    setPlanNodes(next.nodes.map((n) => n.planNode))
    setPlanEdges(next.edges.map((e) => e.planEdge))
    if (selectedId === detachTarget) setSelectedId(null)
    setDetachTarget(null)
  }, [detachTarget, currentGraph, selectedId])

  const updateSelectedParams = useCallback(
    (params: Record<string, unknown>) => {
      if (!selectedId) return
      setPlanNodes((prev) => prev.map((n) => (n.id === selectedId ? { ...n, params } : n)))
    },
    [selectedId],
  )

  const materializeSelected = useCallback(
    (sourceId: string) => {
      if (!selectedId) return
      setPlanNodes((prev) =>
        prev.map((n) => {
          if (n.id !== selectedId) return n
          const materialized = materializeDraftNode(n, sourceId)
          return materialized
        }),
      )
    },
    [selectedId],
  )

  const saveMut = useMutation({
    mutationFn: async () => {
      const graphMeta = { irVersion: PLAN_IR_VERSION, name: planName, draft: planDraftFlag }
      const graph = canvasToPlanGraph(currentGraph, graphMeta)
      if (isNew) {
        return createPlan({ name: planName || t('planCanvas.namePlaceholder'), graph })
      }
      return updatePlan(planId as string, { name: planName, graph })
    },
    onSuccess: (saved) => {
      setErrorsByNode(new Map())
      qc.invalidateQueries({ queryKey: ['plan-canvas', 'plan'] })
      toast.success(t('planCanvas.saved'))
      if (isNew) navigate(`/plans/${saved.id}`, { replace: true })
    },
    onError: (err) => {
      const items = extractPlanValidationErrors(err)
      if (items.length > 0) {
        const anchored = anchorValidationErrors(items)
        const byNode = new Map<string, string[]>()
        for (const [nodeId, errs] of anchored.byNode) byNode.set(nodeId, errs.map((e) => e.message))
        setErrorsByNode(byNode)
        toast.error(t('planCanvas.validationFailed'))
      } else {
        toast.error(err instanceof Error ? err.message : t('planCanvas.saveFailed'))
      }
    },
  })

  const runAutoLayout = useCallback(async () => {
    if (rfNodes.length === 0) return
    setLaying(true)
    try {
      const laidOut = await elkLayout(rfNodes, rfEdges)
      setRfNodes(laidOut as FlowNode[])
      requestAnimationFrame(() => fitView({ padding: 0.16, duration: 400 }))
    } finally {
      setLaying(false)
    }
  }, [rfNodes, rfEdges, setRfNodes, fitView])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(PALETTE_DRAG_MIME)
      if (!raw) return
      e.preventDefault()
      const payload = parsePalettePayload(raw)
      if (!payload) return
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      dropAt(payload, position)
    },
    [dropAt, screenToFlowPosition],
  )

  if (planId && planQuery.isLoading) return <PageLoader />
  if (planId && planQuery.error) {
    return <ErrorAlert error={planQuery.error as Error} onRetry={() => planQuery.refetch()} />
  }

  const selectedErrors = selectedId ? errorsByNode.get(selectedId) ?? [] : []

  return (
    <div className="space-y-3">
      <PageHeader
        title={t('planCanvas.title')}
        description={t('planCanvas.subtitle')}
        action={
          <div className="flex items-center gap-2">
            <input
              aria-label={t('planCanvas.nameLabel')}
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder={t('planCanvas.namePlaceholder')}
              className="h-8 w-52 rounded-md border border-white/12 bg-black/40 px-2.5 text-xs text-zinc-200 outline-hidden focus:border-primary-500/60"
            />
            {planDraftFlag && (
              <span className="rounded-xs border border-amber-400/35 bg-amber-400/10 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-amber-200">
                {t('planCanvas.draftBadge')}
              </span>
            )}
            {planRunnableFlag && (
              <span className="rounded-xs border border-emerald-400/35 bg-emerald-400/10 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-emerald-200">
                {t('planCanvas.runnableBadge')}
              </span>
            )}

            <div className="flex items-center rounded-md border border-white/12 bg-black/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLens('edit')}
                aria-pressed={lens === 'edit'}
                className={`inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 font-semibold transition ${
                  lens === 'edit' ? 'bg-primary-500/20 text-primary-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Pencil className="h-3 w-3" />
                {t('planCanvas.lensEdit')}
              </button>
              <button
                type="button"
                onClick={() => setLens(toggleLens('edit'))}
                aria-pressed={lens === 'observe'}
                className={`inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 font-semibold transition ${
                  lens === 'observe' ? 'bg-primary-500/20 text-primary-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Eye className="h-3 w-3" />
                {t('planCanvas.lensObserve')}
              </button>
            </div>

            {isObserve && (
              <CanvasToolbarButton
                tone="affirmative"
                disabled={!runGate.canRun || isNew || runMut.isPending}
                title={
                  isNew
                    ? t('planCanvas.run.blockedUnsaved')
                    : runGate.reason
                      ? t(`planCanvas.run.blocked.${runGate.reason}`)
                      : undefined
                }
                onClick={() => runMut.mutate()}
                icon={<Play className="h-3.5 w-3.5" />}
              >
                {runMut.isPending ? t('planCanvas.run.running') : t('planCanvas.run.action')}
              </CanvasToolbarButton>
            )}

            <CanvasToolbarButton
              tone="accent"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate()}
              icon={<Save className="h-3.5 w-3.5" />}
            >
              {saveMut.isPending ? t('planCanvas.saving') : t('planCanvas.save')}
            </CanvasToolbarButton>
          </div>
        }
      />

      {isObserve && !runGate.canRun && !isNew && (
        <div className="rounded-md border border-amber-400/25 bg-amber-400/6 px-3 py-2 text-2xs text-amber-200">
          {t(`planCanvas.run.blocked.${runGate.reason}`)}
        </div>
      )}

      <div className="relative flex h-[74vh] min-h-[560px] overflow-hidden rounded-md border border-white/10 bg-black">
        <PlanCanvasPalette onPick={onPaletteClickPick} />

        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(PALETTE_DRAG_MIME)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onEdgesDelete={onEdgesDelete}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onNodeDoubleClick={(_, node) => {
              const gid = groupIdFromSubnet(node.id)
              if (gid) {
                setActiveGroup(gid)
                setSelectedId(null)
              }
            }}
            onPaneClick={() => {
              setSelectedId(null)
              setEdgeDropMenu(null)
            }}
            onNodesDelete={(deleted) => {
              // Subnet placeholders are virtual — deleting one must never
              // detach its member nodes; dissolve is the explicit action.
              for (const n of deleted) {
                if (!groupIdFromSubnet(n.id)) requestDetach(n.id)
              }
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            // Figma-style selection: left-drag on empty canvas draws a
            // selection box (no modifier key needed); pan with middle/right
            // button or the usual scroll/pinch gestures.
            selectionOnDrag
            panOnDrag={[1, 2]}
            selectionMode={SelectionMode.Partial}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: EDGE_STROKE, strokeWidth: 2 }}
            connectionRadius={32}
            snapToGrid
            snapGrid={[16, 16]}
            fitView
            minZoom={0.3}
            maxZoom={1.6}
            nodesDraggable
            nodesConnectable
            proOptions={{ hideAttribution: true }}
            className="bg-ops-black"
          >
            <Background variant={BackgroundVariant.Dots} color="#2a2a32" gap={22} size={1.6} />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap position="bottom-right" maskColor="rgba(6,6,8,0.78)" pannable zoomable />
            {/* 三层层级面包屑: 项目(功能层) / 功能组(实现层) — Houdini-style dive nav */}
            <Panel position="top-left">
              <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-ops-panel/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
                {activeGroup ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveGroup(null)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-telemetry text-2xs font-semibold uppercase tracking-[0.12em] text-zinc-400 transition-colors hover:bg-white/6 hover:text-zinc-100"
                    >
                      <ChevronLeft size={13} />
                      功能层
                    </button>
                    <span className="text-zinc-600">/</span>
                    <input
                      value={activeGroupInfo?.label ?? ''}
                      onChange={(e) => renameActiveGroup(e.target.value)}
                      aria-label="功能组名称"
                      className="w-32 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs font-semibold text-zinc-100 outline-none transition-colors focus:border-primary-500/60 focus:bg-black/30"
                    />
                    <button
                      type="button"
                      onClick={dissolveActiveGroup}
                      title="解散功能组（节点回到功能层）"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-telemetry text-2xs text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Ungroup size={13} />
                      解散
                    </button>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 font-telemetry text-2xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
                      <Boxes size={13} />
                      功能层
                    </span>
                    {selectedAtomicIds.length >= 2 && (
                      <button
                        type="button"
                        onClick={groupSelection}
                        className="inline-flex items-center gap-1.5 rounded-md border border-primary-500/50 bg-primary-500/15 px-2.5 py-1 text-xs font-medium text-primary-300 transition-colors hover:bg-primary-500/25"
                      >
                        <Group size={13} />
                        组合为功能组 ({selectedAtomicIds.length})
                      </button>
                    )}
                    {planGroups.length === 0 && selectedAtomicIds.length < 2 && (
                      <span className="px-2 py-1 text-3xs text-zinc-600">在空白处拖拽框选多个节点，可组合成功能组</span>
                    )}
                  </>
                )}
              </div>
            </Panel>
            <Panel position="top-right">
              <CanvasToolbarButton
                tone="accent"
                onClick={runAutoLayout}
                disabled={laying}
                className="shadow-lg"
                icon={<Network className="h-3.5 w-3.5" />}
              >
                {laying ? '…' : '自动布局'}
              </CanvasToolbarButton>
            </Panel>
          </ReactFlow>

          {edgeDropMenu && (
            <div
              className="fixed z-50 w-44 overflow-hidden rounded-lg border border-white/12 bg-ops-raised shadow-2xl"
              style={{ left: edgeDropMenu.client.x + 4, top: edgeDropMenu.client.y + 4 }}
              role="menu"
              aria-label="添加下游节点"
            >
              <p className="border-b border-white/8 px-3 py-1.5 font-telemetry text-3xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                添加下游节点
              </p>
              {(
                [
                  { kind: 'transform' as const, label: '变换', hint: 'dedupe / map / filter' },
                  { kind: 'merge' as const, label: '合并', hint: '合并多个分支' },
                  { kind: 'sink' as const, label: '汇', hint: '写入存储' },
                ]
              ).map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  role="menuitem"
                  onClick={() => insertNodeFromEdgeDrop(item.kind)}
                  className="flex w-full flex-col items-start gap-0 px-3 py-2 text-left transition-colors hover:bg-white/6"
                >
                  <span className="text-xs font-medium text-zinc-200">{item.label}</span>
                  <span className="text-3xs text-zinc-600">{item.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedPlanNode && (
          <PlanCanvasInspector
            node={selectedPlanNode}
            errors={selectedErrors}
            onClose={() => setSelectedId(null)}
            onDetach={() => requestDetach(selectedPlanNode.id)}
            onMaterialized={materializeSelected}
            onParamsChange={updateSelectedParams}
          />
        )}
      </div>

      <ConfirmDialog
        open={Boolean(detachTarget)}
        onOpenChange={(open) => {
          if (!open) setDetachTarget(null)
        }}
        title={t('planCanvas.detachConfirmTitle')}
        description={t('planCanvas.detachConfirmDescription')}
        confirmLabel={t('planCanvas.detachConfirmAction')}
        onConfirm={confirmDetach}
      />
    </div>
  )
}

function PlanEditorView() {
  return (
    <ReactFlowProvider>
      <PlanCanvasInner />
    </ReactFlowProvider>
  )
}

type CanvasView = 'overview' | 'plan'

/** Header segment control switching between the two lenses this single
 * Collection Canvas surface exposes (ADR-0008): the global topology overview
 * (former /labs/topology NetworkPage) and the per-plan edit/observe editor
 * (former /plans/new PlanCanvasPage). Kept tiny and route-driven so deep
 * links (/plans, /plans/new, /plans/:planId) keep working — switching tabs
 * just navigates, it never hides unsaved state behind a client-only toggle. */
function ViewSwitch({ view }: { view: CanvasView }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="flex items-center rounded-md border border-white/12 bg-black/40 p-0.5 text-xs">
      <button
        type="button"
        onClick={() => navigate('/plans')}
        aria-pressed={view === 'overview'}
        className={`inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 font-semibold transition ${
          view === 'overview' ? 'bg-primary-500/20 text-primary-100' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <LayoutGrid className="h-3 w-3" />
        {t('planCanvas.viewOverview')}
      </button>
      <button
        type="button"
        // Already on a plan route (/plans/new or /plans/:planId)? Stay put —
        // forcing /plans/new here would discard whatever plan is loaded.
        // Only coming FROM the overview needs somewhere to land, and "new" is
        // the only sensible default when no plan is selected yet.
        onClick={() => { if (view !== 'plan') navigate('/plans/new') }}
        aria-pressed={view === 'plan'}
        className={`inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 font-semibold transition ${
          view === 'plan' ? 'bg-primary-500/20 text-primary-100' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Workflow className="h-3 w-3" />
        {t('planCanvas.viewPlan')}
      </button>
    </div>
  )
}

// Collection Canvas host (ADR-0008): ONE canvas entry in nav/routes, two
// views selected by this segment control — 总览 (global topology, reused
// verbatim from labs/topology/NetworkPage) and 当前 Plan (this file's
// edit/observe editor). /plans is the overview default; /plans/new and
// /plans/:planId keep deep-linking straight into the plan editor.
export default function PlanCanvasPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const view: CanvasView = location.pathname === '/plans' ? 'overview' : 'plan'

  // D18-B #7 chrome dedup: 总览's own toolbar row (breadcrumb chip · sync)
  // already reads as the page's one header line — stacking this file's
  // telemetry-label + ViewSwitch row above it repeated the same "总览" label
  // twice. Overview passes ViewSwitch into NetworkPage's row instead of
  // rendering a second row; 当前 Plan keeps its existing standalone header
  // (that lens still needs its own title/name-input/badges row).
  if (view === 'overview') {
    return <NetworkPage headerExtra={<ViewSwitch view={view} />} />
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="telemetry-label">{t('planCanvas.title')}</p>
        <ViewSwitch view={view} />
      </div>
      <PlanEditorView />
    </div>
  )
}
