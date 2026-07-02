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
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Eye, LayoutGrid, Network, Pencil, Play, Save, Workflow } from 'lucide-react'

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
  canvasToPlanGraph,
  createDraftNodeFromPreset,
  createDraftSourceNode,
  deriveDraftAndRunnable,
  detachNode,
  extractPlanValidationErrors,
  fallbackPosition,
  materializeDraftNode,
  planGraphToCanvas,
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

function toFlowEdge(e: CanvasEdge): FlowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'default',
  }
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

  const nodeTypes = useMemo(() => nodeTypesForXyflow(), [])

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

  // Sync the pure-model graph -> xyflow controlled state. Positions come from
  // whatever the operator last dragged to (preserved via rfNodes lookup),
  // falling back to the model's projected position for a brand-new node.
  useEffect(() => {
    setRfNodes((prev) => {
      const posById = new Map(prev.map((n) => [n.id, n.position]))
      return currentGraph.nodes.map((n, index) => {
        const draft = n.planNode.kind === 'source' && n.planNode.draft === true && !n.planNode.source_id
        const errors = errorsByNode.get(n.id) ?? []
        const flow = toFlowNode(n, draft, errors, { observe: isObserve, runState: runState[n.id] })
        return { ...flow, position: posById.get(n.id) ?? n.position ?? fallbackPosition(index) }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGraph, errorsByNode, isObserve, runState])

  useEffect(() => {
    setRfEdges(currentGraph.edges.map(toFlowEdge))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGraph])

  const selectedPlanNode = selectedId ? planNodes.find((n) => n.id === selectedId) ?? null : null

  const addNode = useCallback((node: PlanNode, position: { x: number; y: number }) => {
    setPlanNodes((prev) => [...prev, { ...node, params: { ...node.params, __canvas_position: position } }])
  }, [])

  const dropAt = useCallback(
    (payload: PaletteDropPayload, position: { x: number; y: number }) => {
      const id = `n-${Date.now()}-${seq.current++}`
      if (payload.kind === 'preset') {
        addNode(createDraftNodeFromPreset(payload.preset, position, id), position)
      } else if (payload.kind === 'draft-channel') {
        addNode(createDraftSourceNode(payload.channelType, position, id), position)
      } else {
        addNode(
          {
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
          },
          position,
        )
      }
    },
    [addNode],
  )

  const onPaletteClickPick = useCallback(
    (payload: PaletteDropPayload) => {
      const position = { x: 80 + (seq.current % 5) * 200, y: 60 + Math.floor(seq.current / 5) * 160 }
      dropAt(payload, position)
    },
    [dropAt],
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
      setRfEdges((eds) => addEdge({ ...params, type: 'default' }, eds))
    },
    [setRfEdges],
  )

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
              <span className="rounded-xs border border-amber-400/35 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                {t('planCanvas.draftBadge')}
              </span>
            )}
            {planRunnableFlag && (
              <span className="rounded-xs border border-emerald-400/35 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                {t('planCanvas.runnableBadge')}
              </span>
            )}

            <div className="flex items-center rounded-md border border-white/12 bg-black/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLens('edit')}
                aria-pressed={lens === 'edit'}
                className={`inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 font-semibold transition ${
                  lens === 'edit' ? 'bg-sky-500/20 text-sky-100' : 'text-zinc-400 hover:text-zinc-200'
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
                  lens === 'observe' ? 'bg-sky-500/20 text-sky-100' : 'text-zinc-400 hover:text-zinc-200'
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
        <div className="rounded-md border border-amber-400/25 bg-amber-400/6 px-3 py-2 text-[11px] text-amber-200">
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
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodesDelete={(deleted) => {
              for (const n of deleted) requestDetach(n.id)
            }}
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
          view === 'overview' ? 'bg-sky-500/20 text-sky-100' : 'text-zinc-400 hover:text-zinc-200'
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
          view === 'plan' ? 'bg-sky-500/20 text-sky-100' : 'text-zinc-400 hover:text-zinc-200'
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="telemetry-label">{view === 'overview' ? t('planCanvas.viewOverview') : t('planCanvas.title')}</p>
        <ViewSwitch view={view} />
      </div>
      {view === 'overview' ? <NetworkPage /> : <PlanEditorView />}
    </div>
  )
}
