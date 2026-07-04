"use client"

import { create } from "zustand"
import { nanoid } from "nanoid"
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react"
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeData,
  WorkflowEdgeData,
  FlowSnapshot,
  PaletteItem,
  FreehandStroke,
  ToolMode,
  GeneratedWorkflowSpec,
  ParameterInterface,
} from "./types"
import { applyHelperLines, type HelperLines } from "./helper-lines"
import { useSettingsStore } from "./settings-store"
import { resolveCollisions, findFreePosition, nodeRect, COLLISION_GAP } from "./collision"
import { connectedComponentEdges, findConnectedComponentForNode } from "./graph-components"
import { getLayoutedElements, type LayoutDirection, type LayoutEngine } from "./layout"
import { animateNodes } from "./animate"
import { NODE_PALETTE } from "./palette"
import { COLLECTION_WORKFLOW_PROJECT } from "../workflow/collection-pipeline"
import type { WorkflowProject } from "../workflow/schema"
import { parseWorkflowProject, type AdapterBinding, type WorkflowProfile, type WorkflowProjectNode } from "../workflow/schema"
import { workflowNodeToReactFlow, workflowProjectToReactFlow } from "../workflow/to-react-flow"
import { addCatalogNodeToWorkflowProject, type WorkflowNodeCatalogItem } from "../workflow/node-catalog"
import { getNodeInternals, type NodeInternalStep } from "../workflow/node-internals"
import { getPrimitiveByStepCapability, primitiveToNodeData, type WorkflowPrimitive } from "../workflow/node-primitives"
import { createParameterInterfaceFromInternals, setParameterInterfaceFieldValue } from "../workflow/parameter-interface"
import {
  catalogRuntimeCapability,
  type WorkflowCapabilitiesResponse,
  type WorkflowRuntimeCapability,
} from "../workflow/capabilities"
import type { AgentProposal } from "../workflow/proposal"
import type {
  WorkflowNodeRunEvent,
  WorkflowRunNodeState,
  WorkflowRunProjection,
  WorkflowRunStatus,
} from "../workflow/backend-runs"

export type { GeneratedWorkflowSpec } from "./types"

const HISTORY_LIMIT = 100
const STORAGE_KEY = "workflow-editor-state"
const initialWorkflowProject = COLLECTION_WORKFLOW_PROJECT
const initialWorkflowFlow = workflowProjectToReactFlow(initialWorkflowProject)

type FlowState = {
  workflowProject: WorkflowProject
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  networkStack: { nodeId: string; label: string; snapshot: FlowSnapshot }[]
  helperLines: HelperLines
  past: FlowSnapshot[]
  future: FlowSnapshot[]
  clipboard: FlowSnapshot | null
  selectedIds: string[]
  pendingAgentProposal: AgentProposal | null

  // freehand whiteboard
  drawings: FreehandStroke[]
  toolMode: ToolMode
  penColor: string
  penSize: number
  setToolMode: (mode: ToolMode) => void
  setPenColor: (color: string) => void
  setPenSize: (size: number) => void
  addStroke: (stroke: FreehandStroke) => void
  clearDrawings: () => void

  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void
  onConnect: (connection: Connection) => void

  takeSnapshot: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  addNodeFromPalette: (item: PaletteItem, position: XYPosition) => void
  addPrimitiveNode: (
    item: WorkflowPrimitive,
    position: XYPosition,
    runtimeCapability?: WorkflowRuntimeCapability,
  ) => void
  addWorkflowNodeFromCatalog: (item: WorkflowNodeCatalogItem, position: XYPosition) => void
  updateWorkflowNodeParams: (
    nodeId: string,
    paramsPatch: Record<string, unknown>,
    adapterPatch?: Partial<Pick<AdapterBinding, "mode" | "config">>,
  ) => void
  updateParameterInterfaceField: (nodeId: string, fieldId: string, value: unknown) => void
  updateNodeData: (id: string, data: Partial<WorkflowNodeData>) => void
  deleteSelected: () => void
  disconnectSelectedConnections: () => number
  disconnectNodeConnections: (nodeId: string) => number
  removeEdgesByIds: (edgeIds: string[]) => number
  selectConnectedComponent: (nodeId: string) => { nodeIds: string[]; edgeIds: string[] }
  duplicateSelected: () => void

  copy: () => void
  cut: () => void
  paste: (position?: XYPosition) => void

  autoLayout: (direction: LayoutDirection, engine?: LayoutEngine, animated?: boolean) => Promise<void>
  toggleGroupCollapse: (id: string) => void

  // grouping / parent-child
  groupSelection: () => void
  ungroupSelection: () => void
  attachToParent: (childId: string, parentId: string) => void
  detachFromParent: (childId: string) => void

  // editable edges
  updateEdgeWaypoints: (edgeId: string, waypoints: XYPosition[]) => void
  updateEdgeData: (edgeId: string, data: Partial<WorkflowEdgeData>) => void
  updateEdgeType: (edgeId: string, type: string) => void
  toggleEdgeAnimated: (edgeId: string) => void

  // dynamic layouting helpers
  addChildNode: (parentId: string) => void
  insertNodeOnEdge: (edgeId: string) => void
  enterNodeNetwork: (nodeId: string) => number
  exitNodeNetwork: () => boolean
  unlockNodeInternals: (nodeId: string) => number
  lockNodeInternals: (nodeId: string) => number

  // collision & group maintenance
  resolveNodeCollisions: (movedId: string) => void
  resizeGroupToFit: (groupId: string) => void

  setNodes: (updater: (nodes: WorkflowNode[]) => WorkflowNode[]) => void
  setSelectedIds: (ids: string[]) => void
  clearHelperLines: () => void

  save: () => void
  load: () => boolean
  reset: () => void
  importFlow: (snapshot: FlowSnapshot) => void
  importWorkflowProject: (project: WorkflowProject) => void
  applyWorkflowCapabilities: (capabilities: WorkflowCapabilitiesResponse) => void
  applyWorkflowNodeRunEvent: (event: WorkflowNodeRunEvent) => void
  applyWorkflowRunProjection: (projection: WorkflowRunProjection) => void
  updateWorkflowProfile: (profile: WorkflowProfile) => void
  queueAgentProposal: (proposal: AgentProposal) => void
  clearPendingAgentProposal: () => void
  focusProposalTargets: (nodeIds: string[], edgeIds?: string[]) => void
  clearProposalFocus: () => void
  applyGeneratedWorkflow: (spec: GeneratedWorkflowSpec) => void
}

function snapshot(state: Pick<FlowState, "nodes" | "edges" | "drawings">): FlowSnapshot {
  return {
    nodes: JSON.parse(JSON.stringify(state.nodes)),
    edges: JSON.parse(JSON.stringify(state.edges)),
    drawings: JSON.parse(JSON.stringify(state.drawings)),
  }
}

function uniqueWorkflowNodeId(prefix: string, nodes: WorkflowProject["nodes"]): string {
  const ids = new Set(nodes.map((node) => node.id))
  let candidate = prefix
  let i = 2
  while (ids.has(candidate)) {
    candidate = `${prefix}-${i}`
    i += 1
  }
  return candidate
}

function isWorkflowRuntimeCapability(value: unknown): value is WorkflowRuntimeCapability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === "string" && typeof record.status === "string"
}

function workflowNodeStatusFromRun(status: WorkflowRunStatus): WorkflowNodeData["status"] {
  switch (status) {
    case "queued":
      return "idle"
    case "running":
    case "partial":
      return "running"
    case "completed":
      return "success"
    case "blocked":
    case "failed":
      return "error"
    default:
      return "idle"
  }
}

function workflowNodeStatusFromEvent(eventType: WorkflowNodeRunEvent["eventType"]): WorkflowNodeData["status"] {
  switch (eventType) {
    case "queued":
      return "idle"
    case "started":
    case "partial":
    case "batch_ready":
      return "running"
    case "completed":
      return "success"
    case "blocked":
    case "failed":
      return "error"
    default:
      return "idle"
  }
}

function runStateForEvent(event: WorkflowNodeRunEvent): WorkflowRunNodeState {
  return {
    nodeId: event.nodeId,
    status:
      event.eventType === "queued"
        ? "queued"
        : event.eventType === "completed"
          ? "completed"
          : event.eventType === "blocked"
            ? "blocked"
            : event.eventType === "failed"
              ? "failed"
              : event.eventType === "batch_ready" || event.eventType === "partial"
                ? "partial"
                : "running",
    packageNodeId: event.packageNodeId,
    internalNodeId: event.internalNodeId,
    sourceGroups: event.sourceGroup ? [event.sourceGroup] : [],
    latestEventId: event.id,
    eventCount: 1,
    blockReasons: event.blockReason ? [event.blockReason] : [],
    batches: event.batch ? [event.batch] : [],
  }
}

function runtimeNodeIdCandidates(
  nodeId: string,
  packageNodeId?: string | null,
  internalNodeId?: string | null,
): string[] {
  const candidates = [nodeId]
  if (packageNodeId && internalNodeId) {
    candidates.push(scopedInternalId(packageNodeId, internalNodeId))
  }
  if (nodeId.includes("::")) {
    candidates.push(nodeId.replace("::", "__"))
  }
  return Array.from(new Set(candidates))
}

function runtimeStateByCanvasNodeId(projection: WorkflowRunProjection): Map<string, WorkflowRunNodeState> {
  const byCanvasNodeId = new Map<string, WorkflowRunNodeState>()
  for (const nodeState of projection.nodeStates) {
    for (const candidate of runtimeNodeIdCandidates(
      nodeState.nodeId,
      nodeState.packageNodeId,
      nodeState.internalNodeId,
    )) {
      byCanvasNodeId.set(candidate, nodeState)
    }
  }
  return byCanvasNodeId
}

function patchProjectNodeRunEvent(
  node: WorkflowProjectNode,
  event: WorkflowNodeRunEvent,
  runtimeRunState: WorkflowRunNodeState,
): WorkflowProjectNode {
  const matchesPackageNode = node.id === event.nodeId
  const matchesInternalNode = Boolean(event.packageNodeId === node.id && event.internalNodeId && node.internals)
  if (!matchesPackageNode && !matchesInternalNode) return node

  return {
    ...node,
    ...(matchesPackageNode
      ? {
          ui: {
            ...(node.ui ?? {}),
            runtimeRunState,
            runtimeLatestEvent: event,
          },
        }
      : {}),
    ...(matchesInternalNode && node.internals
      ? {
          internals: {
            ...node.internals,
            nodes: node.internals.nodes.map((internalNode) =>
              patchInternalRunEvent(internalNode, event, runtimeRunState),
            ),
          },
        }
      : {}),
  }
}

function patchProjectNodeRunProjection(
  node: WorkflowProjectNode,
  stateByCanvasNodeId: Map<string, WorkflowRunNodeState>,
): WorkflowProjectNode {
  const runtimeRunState = stateByCanvasNodeId.get(node.id)
  const hasInternalStates = Boolean(
    node.internals?.nodes.some((internalNode) =>
      stateByCanvasNodeId.has(scopedInternalId(node.id, readInternalNodeId(internalNode) ?? "")),
    ),
  )
  if (!runtimeRunState && !hasInternalStates) return node

  return {
    ...node,
    ...(runtimeRunState
      ? {
          ui: {
            ...(node.ui ?? {}),
            runtimeRunState,
          },
        }
      : {}),
    ...(node.internals
      ? {
          internals: {
            ...node.internals,
            nodes: node.internals.nodes.map((internalNode) =>
              patchInternalRunProjection(internalNode, node.id, stateByCanvasNodeId),
            ),
          },
        }
      : {}),
  }
}

function patchInternalRunEvent(
  value: unknown,
  event: WorkflowNodeRunEvent,
  runtimeRunState: WorkflowRunNodeState,
): unknown {
  if (!isWorkflowProjectNode(value) || value.id !== event.internalNodeId) return value
  return {
    ...value,
    ui: {
      ...(value.ui ?? {}),
      runtimeRunState,
      runtimeLatestEvent: event,
    },
  }
}

function patchInternalRunProjection(
  value: unknown,
  packageNodeId: string,
  stateByCanvasNodeId: Map<string, WorkflowRunNodeState>,
): unknown {
  if (!isWorkflowProjectNode(value)) return value
  const runtimeRunState = stateByCanvasNodeId.get(scopedInternalId(packageNodeId, value.id))
  if (!runtimeRunState) return value
  return {
    ...value,
    ui: {
      ...(value.ui ?? {}),
      runtimeRunState,
    },
  }
}

function readInternalNodeId(value: unknown): string | null {
  return isWorkflowProjectNode(value) ? value.id : null
}

function fieldsForInternalStep(stepItem: NodeInternalStep, parentNodeId?: string, parameterInterface?: ParameterInterface) {
  return [
    { id: "capability", label: "capability", value: stepItem.capability },
    { id: "evidence", label: "evidence", value: stepItem.evidence },
    ...(stepItem.exposedParams ?? []).map((param) => {
      const fieldId = param.binding?.fieldId ?? param.id
      const boundValue = parameterInterface?.fields.find(
        (field) => field.binding.nodeId === `${parentNodeId}__${stepItem.id}` && field.binding.fieldId === fieldId,
      )?.value
      return {
        id: fieldId,
        label: param.label,
        value: String(boundValue ?? param.value ?? ""),
      }
    }),
  ]
}

type InternalWorkflowEdge = {
  id: string
  source: string
  target: string
  sourcePort?: string
  targetPort?: string
  label?: string
  ui?: Record<string, unknown>
}

function materializeProjectInternals(
  projectNode: WorkflowProjectNode | undefined,
  parentNode: WorkflowNode,
  mode: "network" | "unlock",
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } | undefined {
  const rawNodes = projectNode?.internals?.nodes.filter(isWorkflowProjectNode) ?? []
  if (!projectNode || rawNodes.length === 0) return undefined

  const explicitEdges = projectNode.internals?.edges.filter(isInternalWorkflowEdge) ?? []
  const rawEdges = explicitEdges.length > 0 ? explicitEdges : inferNormalizeFanoutEdges(rawNodes)
  const parentId = projectNode.id
  const parentRect = nodeRect(parentNode)
  const origin =
    mode === "network"
      ? { x: 520, y: 80 }
      : { x: parentRect.x, y: parentRect.y + parentRect.height + 110 }
  const title = typeof projectNode.ui?.label === "string" ? projectNode.ui.label : parentId

  const internalNodes = rawNodes.map((internalNode, index) => {
    const normalizedNode: WorkflowProjectNode = { ...internalNode, params: internalNode.params ?? {} }
    const reactNode = workflowNodeToReactFlow(normalizedNode, index)
    const relativePosition = readInternalPosition(normalizedNode, index)
    return {
      ...reactNode,
      id: scopedInternalId(parentId, normalizedNode.id),
      type: "workflow" as const,
      draggable: mode === "network" ? false : reactNode.draggable,
      connectable: reactNode.connectable,
      position: {
        x: origin.x + relativePosition.x,
        y: origin.y + relativePosition.y,
      },
      data: {
        ...reactNode.data,
        status: mode === "network" ? "success" : reactNode.data.status,
        internalOf: parentId,
        internalStepId: normalizedNode.id,
        internalStatus: "ready",
        internalLocked: mode === "network",
        ...(mode === "network"
          ? { networkTitle: title }
          : { internalDraft: true, packageDraft: true }),
      },
    }
  })

  const nodeIds = new Set(rawNodes.map((node) => node.id))
  const internalEdges = rawEdges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: `e-${parentId}__${edge.id}`,
      source: scopedInternalId(parentId, edge.source),
      target: scopedInternalId(parentId, edge.target),
      sourceHandle: edge.sourcePort,
      targetHandle: edge.targetPort,
      label: edge.label,
      type: "workflow" as const,
      animated: true,
      data: {
        label: edge.label,
        internalOf: parentId,
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
        ...(edge.ui ?? {}),
      },
    }))

  return { nodes: internalNodes, edges: internalEdges }
}

function scopedInternalId(parentId: string, internalId: string): string {
  return `${parentId}__${internalId}`
}

function readInternalPosition(node: WorkflowProjectNode, index: number): XYPosition {
  const value = node.ui?.position
  if (!value || typeof value !== "object" || Array.isArray(value)) return { x: 0, y: index * 140 }
  const position = value as { x?: unknown; y?: unknown }
  if (typeof position.x !== "number" || typeof position.y !== "number") return { x: 0, y: index * 140 }
  return { x: position.x, y: position.y }
}

function isWorkflowProjectNode(value: unknown): value is WorkflowProjectNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const node = value as Partial<WorkflowProjectNode>
  return (
    typeof node.id === "string" &&
    typeof node.kind === "string" &&
    typeof node.capability === "string" &&
    (!("params" in node) || Boolean(node.params && typeof node.params === "object" && !Array.isArray(node.params)))
  )
}

function isInternalWorkflowEdge(value: unknown): value is InternalWorkflowEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const edge = value as Partial<InternalWorkflowEdge>
  return typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string"
}

function inferNormalizeFanoutEdges(nodes: WorkflowProjectNode[]): InternalWorkflowEdge[] {
  const normalize = nodes.find((node) => node.id === "internal-normalize")
  if (!normalize) return []
  return nodes
    .filter((node) => node.id !== normalize.id)
    .map((node) => ({
      id: `${node.id}-normalize`,
      source: node.id,
      target: normalize.id,
    }))
}

function scheduleNetworkInternalEdges(
  getState: () => FlowState,
  setState: (state: Partial<FlowState>) => void,
  parentId: string,
  nodeIds: string[],
  edges: WorkflowEdge[],
) {
  if (edges.length === 0 || typeof window === "undefined") return
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const state = getState()
      const stillInNetwork = nodeIds.every((id) => state.nodes.some((node) => node.id === id && node.data.internalOf === parentId))
      if (!stillInNetwork) return
      setState({ edges })
    })
  })
}

function scheduleUnlockedInternalEdges(
  getState: () => FlowState,
  setState: (updater: Partial<FlowState>) => void,
  parentId: string,
  nodeIds: string[],
  edges: WorkflowEdge[],
) {
  if (edges.length === 0 || typeof window === "undefined") return
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const state = getState()
      const stillUnlocked = nodeIds.every((id) => state.nodes.some((node) => node.id === id && node.data.internalOf === parentId))
      if (!stillUnlocked) return
      const existingEdgeIds = new Set(state.edges.map((edge) => edge.id))
      const missingEdges = edges.filter((edge) => !existingEdgeIds.has(edge.id))
      if (missingEdges.length === 0) return
      setState({ edges: [...state.edges, ...missingEdges] })
    })
  })
}

function writeBoundValueToNode(
  node: WorkflowNode,
  source: "params" | "adapter" | "data",
  fieldId: string,
  value: unknown,
): WorkflowNode {
  if (source === "params" || source === "adapter") {
    const nextValue = String(value ?? "")
    const fields = node.data.fields ?? []
    const hasField = fields.some((field) => field.id === fieldId)
    return {
      ...node,
      data: {
        ...node.data,
        fields: hasField
          ? fields.map((field) => (field.id === fieldId ? { ...field, value: nextValue } : field))
          : [...fields, { id: fieldId, label: fieldId, value: nextValue }],
      },
    }
  }
  if (source === "data") return { ...node, data: { ...node.data, [fieldId]: value } }
  return node
}

export const useFlowStore = create<FlowState>((set, get) => ({
  workflowProject: initialWorkflowProject,
  nodes: initialWorkflowFlow.nodes,
  edges: initialWorkflowFlow.edges,
  networkStack: [],
  helperLines: { snapPosition: {} },
  past: [],
  future: [],
  clipboard: null,
  selectedIds: [],
  pendingAgentProposal: null,
  drawings: [],
  toolMode: "select",
  penColor: "var(--chart-1)",
  penSize: 4,

  setToolMode: (mode) => set({ toolMode: mode }),
  setPenColor: (color) => set({ penColor: color }),
  setPenSize: (size) => set({ penSize: size }),
  addStroke: (stroke) => set((state) => ({ drawings: [...state.drawings, stroke] })),
  clearDrawings: () => {
    get().takeSnapshot()
    set({ drawings: [] })
  },

  onNodesChange: (changes) => {
    const { changes: nextChanges, helperLines } = applyHelperLines(
      changes,
      get().nodes,
      useSettingsStore.getState().snapToHelperLines,
    )
    set({
      nodes: applyNodeChanges(nextChanges, get().nodes),
      helperLines,
    })
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) })
  },

  onConnect: (connection) => {
    get().takeSnapshot()
    set({
      edges: addEdge(
        {
          ...connection,
          type: "workflow",
          animated: true,
        },
        get().edges,
      ),
    })
  },

  takeSnapshot: () => {
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: [],
    }))
  },

  undo: () => {
    const { past } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    set((state) => ({
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, HISTORY_LIMIT),
      nodes: previous.nodes,
      edges: previous.edges,
      drawings: previous.drawings ?? [],
      helperLines: { snapPosition: {} },
    }))
  },

  redo: () => {
    const { future } = get()
    if (future.length === 0) return
    const next = future[0]
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      nodes: next.nodes,
      edges: next.edges,
      drawings: next.drawings ?? [],
      helperLines: { snapPosition: {} },
    }))
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  addNodeFromPalette: (item, position) => {
    get().takeSnapshot()
    const id = nanoid(8)
    const isGroup = item.nodeType === "group"
    const isShape = item.nodeType === "shape"
    const rfType =
      item.nodeType === "group"
        ? "group"
        : item.nodeType === "note"
          ? "note"
          : item.nodeType === "shape"
            ? "shape"
            : "workflow"
    const size = isGroup ? { width: 320, height: 220 } : isShape ? { width: 140, height: 100 } : { width: 240, height: 96 }
    const freePos = isGroup ? position : findFreePosition(get().nodes, position, size)
    const newNode: WorkflowNode = {
      id,
      type: rfType,
      position: freePos,
      data: {
        label: item.label,
        nodeType: item.nodeType,
        category: item.category,
        icon: item.icon,
        color: item.color,
        status: "idle",
        ...(item.shape ? { shape: item.shape } : {}),
        ...item.defaultData,
      },
      ...(isGroup ? { width: 320, height: 220, style: { width: 320, height: 220 } } : {}),
      ...(isShape ? { width: 140, height: 100, style: { width: 140, height: 100 } } : {}),
    }
    // 分组容器必须排在数组最前，保证 React Flow 的 parent-before-child 顺序
    set((state) => ({ nodes: isGroup ? [newNode, ...state.nodes] : [...state.nodes, newNode] }))
  },

  addPrimitiveNode: (item, position, runtimeCapability) => {
    get().takeSnapshot()
    const { nodes, networkStack } = get()
    const id = `${item.idPrefix}-${nanoid(6)}`
    const freePos = findFreePosition(nodes, position, { width: 196, height: 78 })
    const parentNetwork = networkStack.at(-1)
    const newNode: WorkflowNode = {
      id,
      type: "workflow",
      position: freePos,
      data: {
        ...primitiveToNodeData(item, runtimeCapability),
        ...(parentNetwork ? { internalOf: parentNetwork.nodeId, packageDraft: true } : { packageDraft: true }),
      },
    }
    set({ nodes: [...nodes.map((node) => ({ ...node, selected: false })), { ...newNode, selected: true }] })
  },

  addWorkflowNodeFromCatalog: (item, position) => {
    get().takeSnapshot()
    const { workflowProject, nodes } = get()
    const id = uniqueWorkflowNodeId(item.idPrefix, workflowProject.nodes)
    const project = addCatalogNodeToWorkflowProject(workflowProject, item, id, position)
    const node = project.nodes.find((candidate) => candidate.id === id)
    if (!node) return
    set({
      workflowProject: project,
      nodes: [...nodes.map((candidate) => ({ ...candidate, selected: false })), { ...workflowNodeToReactFlow(node, nodes.length), selected: true }],
    })
  },

  updateWorkflowNodeParams: (nodeId, paramsPatch, adapterPatch) => {
    get().takeSnapshot()
    set((state) => {
      const target = state.workflowProject.nodes.find((node) => node.id === nodeId)
      if (!target) return {}

      const nextProject = parseWorkflowProject({
        ...state.workflowProject,
        adapters: state.workflowProject.adapters.map((adapter) => {
          if (!target.adapter || adapter.id !== target.adapter || !adapterPatch) return adapter
          return {
            ...adapter,
            ...(adapterPatch.mode ? { mode: adapterPatch.mode } : {}),
            ...(adapterPatch.config ? { config: { ...adapter.config, ...adapterPatch.config } } : {}),
          }
        }),
        nodes: state.workflowProject.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                params: { ...node.params, ...paramsPatch },
              }
            : node,
        ),
      })
      const nextNode = nextProject.nodes.find((node) => node.id === nodeId)
      if (!nextNode) return { workflowProject: nextProject }
      const projected = workflowNodeToReactFlow(nextNode, state.nodes.findIndex((node) => node.id === nodeId))
      return {
        workflowProject: nextProject,
        nodes: state.nodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  fields: projected.data.fields,
                  condition:
                    nextNode.capability === "route" && typeof nextNode.params.expression === "string"
                      ? nextNode.params.expression
                      : node.data.condition,
                  canonical: projected.data.canonical,
                },
              }
            : node,
        ),
      }
    })
  },

  updateParameterInterfaceField: (nodeId, fieldId, value) => {
    get().takeSnapshot()
    set((state) => {
      const parentNode = state.nodes.find((node) => node.id === nodeId)
      const parentProjectNode = state.workflowProject.nodes.find((node) => node.id === nodeId)
      const parameterInterface =
        parentProjectNode?.parameterInterface ??
        parentNode?.data.parameterInterface ??
        createParameterInterfaceFromInternals(nodeId, getNodeInternals(parentProjectNode))
      const targetField = parameterInterface?.fields.find((field) => field.id === fieldId)
      if (!parameterInterface || !targetField || targetField.readonly) return {}

      const nextParameterInterface = setParameterInterfaceFieldValue(parameterInterface, fieldId, value)
      const binding = targetField.binding
      const boundProjectNode = state.workflowProject.nodes.find((node) => node.id === binding.nodeId)
      const backingNodeId = boundProjectNode ? binding.nodeId : nodeId
      const backingProjectNode = boundProjectNode ?? parentProjectNode

      const nextProject = parseWorkflowProject({
        ...state.workflowProject,
        adapters: state.workflowProject.adapters.map((adapter) => {
          if (binding.source !== "adapter" || backingProjectNode?.adapter !== adapter.id) return adapter
          if (binding.fieldId === "mode") return { ...adapter, mode: value }
          return { ...adapter, config: { ...adapter.config, [binding.fieldId]: value } }
        }),
        nodes: state.workflowProject.nodes.map((node) => {
          const withParentInterface = node.id === nodeId ? { ...node, parameterInterface: nextParameterInterface } : node
          if (node.id !== backingNodeId) return withParentInterface
          if (binding.source === "params") {
            return { ...withParentInterface, params: { ...withParentInterface.params, [binding.fieldId]: value } }
          }
          if (binding.source === "data") {
            return { ...withParentInterface, ui: { ...withParentInterface.ui, [binding.fieldId]: value } }
          }
          return withParentInterface
        }),
      })

      return {
        workflowProject: nextProject,
        nodes: state.nodes.map((node) => {
          const withParentInterface =
            node.id === nodeId
              ? { ...node, data: { ...node.data, parameterInterface: nextParameterInterface } }
              : node
          if (node.id === binding.nodeId) {
            return writeBoundValueToNode(withParentInterface, binding.source, binding.fieldId, value)
          }
          return node.id === backingNodeId && binding.nodeId !== backingNodeId
            ? writeBoundValueToNode(withParentInterface, binding.source, binding.fieldId, value)
            : withParentInterface
        }),
      }
    })
  },

  updateNodeData: (id, data) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
    }))
  },

  deleteSelected: () => {
    const { nodes, edges } = get()
    const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id))
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return
    get().takeSnapshot()
    set({
      nodes: nodes.filter((n) => !selectedNodeIds.has(n.id)),
      edges: edges.filter(
        (e) => !selectedEdgeIds.has(e.id) && !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target),
      ),
    })
  },

  disconnectSelectedConnections: () => {
    const { nodes, edges } = get()
    const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id))
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return 0
    const nextEdges = edges.filter(
      (e) => !selectedEdgeIds.has(e.id) && !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target),
    )
    const removed = edges.length - nextEdges.length
    if (removed === 0) return 0
    get().takeSnapshot()
    set({ edges: nextEdges })
    return removed
  },

  disconnectNodeConnections: (nodeId) => {
    const { edges } = get()
    const nextEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
    const removed = edges.length - nextEdges.length
    if (removed === 0) return 0
    get().takeSnapshot()
    set({ edges: nextEdges })
    return removed
  },

  removeEdgesByIds: (edgeIds) => {
    const ids = new Set(edgeIds)
    if (ids.size === 0) return 0
    const { edges } = get()
    const nextEdges = edges.filter((e) => !ids.has(e.id))
    const removed = edges.length - nextEdges.length
    if (removed === 0) return 0
    get().takeSnapshot()
    set({ edges: nextEdges })
    return removed
  },

  selectConnectedComponent: (nodeId) => {
    const { nodes, edges } = get()
    const nodeIds = findConnectedComponentForNode(nodeId, nodes, edges)
    const edgeIds = connectedComponentEdges(nodeIds, edges)
    const selectedNodes = new Set(nodeIds)
    const selectedEdges = new Set(edgeIds)
    set({
      nodes: nodes.map((node) => ({ ...node, selected: selectedNodes.has(node.id) })),
      edges: edges.map((edge) => ({ ...edge, selected: selectedEdges.has(edge.id) })),
    })
    return { nodeIds, edgeIds }
  },

  duplicateSelected: () => {
    const { nodes } = get()
    const selected = nodes.filter((n) => n.selected)
    if (selected.length === 0) return
    get().takeSnapshot()
    const idMap = new Map<string, string>()
    const clones = selected.map((n) => {
      const newId = nanoid(8)
      idMap.set(n.id, newId)
      return {
        ...n,
        id: newId,
        selected: true,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        data: JSON.parse(JSON.stringify(n.data)),
      }
    })
    set({
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...clones],
    })
  },

  copy: () => {
    const { nodes, edges } = get()
    const selectedNodes = nodes.filter((n) => n.selected)
    if (selectedNodes.length === 0) return
    const ids = new Set(selectedNodes.map((n) => n.id))
    const internalEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    set({
      clipboard: {
        nodes: JSON.parse(JSON.stringify(selectedNodes)),
        edges: JSON.parse(JSON.stringify(internalEdges)),
      },
    })
  },

  cut: () => {
    get().copy()
    get().deleteSelected()
  },

  paste: (position) => {
    const { clipboard, nodes } = get()
    if (!clipboard || clipboard.nodes.length === 0) return
    get().takeSnapshot()

    const idMap = new Map<string, string>()
    // anchor offset
    const minX = Math.min(...clipboard.nodes.map((n) => n.position.x))
    const minY = Math.min(...clipboard.nodes.map((n) => n.position.y))
    const offsetX = position ? position.x - minX : 48
    const offsetY = position ? position.y - minY : 48

    const newNodes = clipboard.nodes.map((n) => {
      const newId = nanoid(8)
      idMap.set(n.id, newId)
      return {
        ...n,
        id: newId,
        selected: true,
        position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
        data: JSON.parse(JSON.stringify(n.data)),
      }
    })

    const newEdges = clipboard.edges.map((e) => ({
      ...e,
      id: `e-${nanoid(6)}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
      selected: false,
    }))

    set((state) => ({
      nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...newNodes],
      edges: [...state.edges, ...newEdges],
    }))
  },

  autoLayout: async (direction, engine = "elk", animated = true) => {
    get().takeSnapshot()
    const current = get().nodes
    const { nodes } = await getLayoutedElements(current, get().edges, direction, engine)
    if (!animated || typeof window === "undefined") {
      set({ nodes })
      return
    }
    animateNodes(current, nodes, (frame) => set({ nodes: frame }))
  },

  toggleGroupCollapse: (id) => {
    get().takeSnapshot()
    set((state) => {
      const target = state.nodes.find((n) => n.id === id)
      if (!target) return {}
      const collapsed = !target.data.collapsed
      const expandedHeight = (target.data.expandedHeight as number) ?? (target.height as number) ?? 220
      return {
        nodes: state.nodes.map((n) => {
          if (n.id === id) {
            return {
              ...n,
              data: { ...n.data, collapsed, expandedHeight },
              height: collapsed ? 56 : expandedHeight,
              style: {
                ...n.style,
                width: (n.width as number) ?? 320,
                height: collapsed ? 56 : expandedHeight,
              },
            }
          }
          if (n.parentId === id) {
            return { ...n, hidden: collapsed }
          }
          return n
        }),
      }
    })
  },

  groupSelection: () => {
    const { nodes } = get()
    const selected = nodes.filter((n) => n.selected && !n.parentId && n.type !== "group")
    if (selected.length < 1) return
    get().takeSnapshot()

    const PAD = 40
    const minX = Math.min(...selected.map((n) => n.position.x))
    const minY = Math.min(...selected.map((n) => n.position.y))
    const maxX = Math.max(...selected.map((n) => n.position.x + ((n.measured?.width ?? (n.width as number)) ?? 220)))
    const maxY = Math.max(...selected.map((n) => n.position.y + ((n.measured?.height ?? (n.height as number)) ?? 90)))

    const groupId = `group-${nanoid(6)}`
    const width = maxX - minX + PAD * 2
    const height = maxY - minY + PAD * 2
    const groupNode: WorkflowNode = {
      id: groupId,
      type: "group",
      position: { x: minX - PAD, y: minY - PAD },
      width,
      height,
      style: { width, height },
      data: {
        label: "分组",
        nodeType: "group",
        category: "logic",
        icon: "Group",
        color: "var(--muted-foreground)",
      },
    }

    const selectedIds = new Set(selected.map((n) => n.id))
    const updated = nodes.map((n) => {
      if (!selectedIds.has(n.id)) return { ...n, selected: false }
      return {
        ...n,
        parentId: groupId,
        selected: false,
        position: { x: n.position.x - (minX - PAD), y: n.position.y - (minY - PAD) },
      }
    })

    set({ nodes: [groupNode, ...updated] })
  },

  ungroupSelection: () => {
    const { nodes } = get()
    const groups = nodes.filter((n) => n.selected && n.type === "group")
    if (groups.length === 0) return
    get().takeSnapshot()
    const groupIds = new Set(groups.map((g) => g.id))
    const groupPos = new Map(groups.map((g) => [g.id, g.position]))

    const detached = nodes
      .filter((n) => !groupIds.has(n.id))
      .map((n) => {
        if (n.parentId && groupIds.has(n.parentId)) {
          const gp = groupPos.get(n.parentId)!
          const { parentId, extent, ...rest } = n
          return { ...rest, position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
        }
        return n
      })

    set({ nodes: detached })
  },

  attachToParent: (childId, parentId) => {
    const { nodes } = get()
    const child = nodes.find((n) => n.id === childId)
    const parent = nodes.find((n) => n.id === parentId)
    if (!child || !parent || child.parentId === parentId) return
    get().takeSnapshot()

    const attached = nodes.map((n) =>
      n.id === childId
        ? {
            ...n,
            parentId,
            position: { x: n.position.x - parent.position.x, y: n.position.y - parent.position.y },
          }
        : n,
    )
    // React Flow 要求 parent 必须出现在 child 之前，否则子节点渲染异常（"消失"）
    const parentIdx = attached.findIndex((n) => n.id === parentId)
    const childIdx = attached.findIndex((n) => n.id === childId)
    if (childIdx < parentIdx) {
      const [childNode] = attached.splice(childIdx, 1)
      const newParentIdx = attached.findIndex((n) => n.id === parentId)
      attached.splice(newParentIdx + 1, 0, childNode)
    }
    set({ nodes: attached })
    get().resizeGroupToFit(parentId)
  },

  detachFromParent: (childId) => {
    const { nodes } = get()
    const child = nodes.find((n) => n.id === childId)
    if (!child || !child.parentId) return
    const parent = nodes.find((n) => n.id === child.parentId)
    if (!parent) return
    get().takeSnapshot()
    set({
      nodes: nodes.map((n) => {
        if (n.id !== childId) return n
        const { parentId, extent, ...rest } = n
        return { ...rest, position: { x: n.position.x + parent.position.x, y: n.position.y + parent.position.y } }
      }),
    })
  },

  updateEdgeWaypoints: (edgeId, waypoints) => {
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, type: "editable", data: { ...e.data, waypoints } } : e,
      ),
    }))
  },

  updateEdgeData: (edgeId, data) => {
    set((state) => ({
      edges: state.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, ...data } } : e)),
    }))
  },

  updateEdgeType: (edgeId, type) => {
    get().takeSnapshot()
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId
          ? { ...e, type, data: { ...e.data, ...(type === "editable" ? {} : { waypoints: undefined }) } }
          : e,
      ),
    }))
  },

  toggleEdgeAnimated: (edgeId) => {
    set((state) => ({
      edges: state.edges.map((e) => (e.id === edgeId ? { ...e, animated: !e.animated } : e)),
    }))
  },

  addChildNode: (parentId) => {
    const { nodes, edges } = get()
    const parent = nodes.find((n) => n.id === parentId)
    if (!parent) return
    get().takeSnapshot()
    const id = nanoid(8)
    const parentRect = nodeRect(parent)
    const size = { width: 240, height: 96 }
    // 端口在上下两侧 → 子节点放在父节点下方，同层不重叠（不做全图重排）
    const childCount = edges.filter((e) => e.source === parentId).length
    const desired = {
      x: parentRect.x + childCount * (size.width + COLLISION_GAP),
      y: parentRect.y + parentRect.height + 96,
    }
    const freePos = findFreePosition(nodes, desired, size, parent.parentId)
    const newNode: WorkflowNode = {
      id,
      type: "workflow",
      position: freePos,
      ...(parent.parentId ? { parentId: parent.parentId } : {}),
      data: {
        label: "新节点",
        nodeType: "action",
        category: "action",
        icon: "Zap",
        color: "var(--chart-1)",
        status: "idle",
      },
    }
    const newEdge: WorkflowEdge = {
      id: `e-${nanoid(6)}`,
      source: parentId,
      target: id,
      type: "workflow",
      animated: true,
    }
    set({ nodes: [...nodes, newNode], edges: [...edges, newEdge] })
  },

  insertNodeOnEdge: (edgeId) => {
    const { nodes, edges } = get()
    const edge = edges.find((e) => e.id === edgeId)
    if (!edge) return
    get().takeSnapshot()
    const source = nodes.find((n) => n.id === edge.source)
    const target = nodes.find((n) => n.id === edge.target)
    if (!source || !target) return

    const id = nanoid(8)
    const newNode: WorkflowNode = {
      id,
      type: "workflow",
      position: {
        x: (source.position.x + target.position.x) / 2,
        y: (source.position.y + target.position.y) / 2,
      },
      data: {
        label: "插入节点",
        nodeType: "action",
        category: "action",
        icon: "Zap",
        color: "var(--chart-1)",
        status: "idle",
      },
    }
    const newEdges = edges.filter((e) => e.id !== edgeId)
    newEdges.push(
      { id: `e-${nanoid(6)}`, source: edge.source, target: id, type: "workflow", animated: true },
      { id: `e-${nanoid(6)}`, source: id, target: edge.target, type: "workflow", animated: true },
    )
    // 插入点保持原位，把周围节点推开，避免全图重排
    set({ nodes: resolveCollisions([...nodes, newNode], id), edges: newEdges })
  },

  enterNodeNetwork: (nodeId) => {
    const { workflowProject, nodes, edges, drawings, networkStack } = get()
    const node = nodes.find((candidate) => candidate.id === nodeId)
    const projectNode = workflowProject.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return 0

    const projectInternals = materializeProjectInternals(projectNode, node, "network")
    if (projectInternals) {
      const internalNodeIds = projectInternals.nodes.map((internalNode) => internalNode.id)
      set({
        networkStack: [
          ...networkStack,
          {
            nodeId,
            label: String(node.data.label ?? nodeId),
            snapshot: snapshot({ nodes, edges, drawings }),
          },
        ],
        nodes: projectInternals.nodes,
        edges: [],
        drawings: [],
        helperLines: { snapPosition: {} },
      })
      scheduleNetworkInternalEdges(get, set, nodeId, internalNodeIds, projectInternals.edges)
      return projectInternals.nodes.length
    }

    const internals = getNodeInternals(projectNode)
    if (!internals || internals.steps.length === 0) return 0

    const internalNodes: WorkflowNode[] = internals.steps.map((stepItem, index) => ({
      ...(() => {
        const primitiveItem = getPrimitiveByStepCapability(stepItem.capability)
        return {
          data: {
            ...primitiveToNodeData(primitiveItem),
            label: stepItem.label,
            description: stepItem.description,
            status: stepItem.status === "future" ? "idle" : "success",
            fields: fieldsForInternalStep(stepItem, nodeId, node.data.parameterInterface ?? projectNode?.parameterInterface),
            internalOf: nodeId,
            internalStepId: stepItem.id,
            internalStatus: stepItem.status,
            internalLocked: true,
            networkTitle: internals.title,
          },
        }
      })(),
      id: `${nodeId}__${stepItem.id}`,
      type: "workflow",
      draggable: false,
      connectable: false,
      position: { x: 520, y: 80 + index * 140 },
    }))

    const internalEdges: WorkflowEdge[] = internalNodes.slice(0, -1).map((internalNode, index) => ({
      id: `e-${nodeId}__${internals.steps[index].id}-${internals.steps[index + 1].id}`,
      source: internalNode.id,
      target: internalNodes[index + 1].id,
      type: "workflow",
      animated: true,
      data: { internalOf: nodeId },
    }))

    set({
      networkStack: [
        ...networkStack,
        {
          nodeId,
          label: String(node.data.label ?? nodeId),
          snapshot: snapshot({ nodes, edges, drawings }),
        },
      ],
      nodes: internalNodes,
      edges: internalEdges,
      drawings: [],
      helperLines: { snapPosition: {} },
    })
    return internalNodes.length
  },

  exitNodeNetwork: () => {
    const { networkStack } = get()
    const previous = networkStack[networkStack.length - 1]
    if (!previous) return false
    set({
      networkStack: networkStack.slice(0, -1),
      nodes: previous.snapshot.nodes,
      edges: previous.snapshot.edges,
      drawings: previous.snapshot.drawings ?? [],
      helperLines: { snapPosition: {} },
    })
    return true
  },

  unlockNodeInternals: (nodeId) => {
    const { workflowProject, nodes, edges } = get()
    const node = nodes.find((candidate) => candidate.id === nodeId)
    const projectNode = workflowProject.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return 0

    const existingInternalIds = new Set(
      nodes.filter((candidate) => candidate.data.internalOf === nodeId).map((candidate) => candidate.id),
    )
    if (existingInternalIds.size > 0) return 0

    const projectInternals = materializeProjectInternals(projectNode, node, "unlock")
    if (projectInternals) {
      get().takeSnapshot()
      const internalNodeIds = projectInternals.nodes.map((internalNode) => internalNode.id)
      const nextNodes = nodes.map((candidate) =>
        candidate.id === nodeId
          ? { ...candidate, data: { ...candidate.data, internalsUnlocked: true } }
          : candidate,
      )
      set({
        nodes: resolveCollisions([...nextNodes, ...projectInternals.nodes], projectInternals.nodes[0]?.id ?? nodeId),
        edges,
      })
      scheduleUnlockedInternalEdges(get, set, nodeId, internalNodeIds, projectInternals.edges)
      return projectInternals.nodes.length
    }

    const internals = getNodeInternals(projectNode)
    if (!internals || internals.steps.length === 0) return 0

    get().takeSnapshot()
    const parentRect = nodeRect(node)
    const startX = parentRect.x
    const startY = parentRect.y + parentRect.height + 110
    const internalNodes: WorkflowNode[] = internals.steps.map((stepItem, index) => ({
      ...(() => {
        const primitiveItem = getPrimitiveByStepCapability(stepItem.capability)
        return {
          data: {
            ...primitiveToNodeData(primitiveItem),
            label: stepItem.label,
            description: stepItem.description,
            status: stepItem.status === "future" ? "idle" : "success",
            fields: fieldsForInternalStep(stepItem, nodeId, node.data.parameterInterface ?? projectNode?.parameterInterface),
            internalOf: nodeId,
            internalStepId: stepItem.id,
            internalStatus: stepItem.status,
            internalLocked: false,
            internalDraft: true,
            packageDraft: true,
          },
        }
      })(),
      id: `${nodeId}__${stepItem.id}`,
      type: "workflow",
      position: { x: startX, y: startY + index * 112 },
    }))

    const internalEdges: WorkflowEdge[] = internalNodes.slice(0, -1).map((internalNode, index) => ({
      id: `e-${nodeId}__${internals.steps[index].id}-${internals.steps[index + 1].id}`,
      source: internalNode.id,
      target: internalNodes[index + 1].id,
      type: "workflow",
      animated: true,
      data: { internalOf: nodeId },
    }))

    const nextNodes = nodes.map((candidate) =>
      candidate.id === nodeId
        ? { ...candidate, data: { ...candidate.data, internalsUnlocked: true } }
        : candidate,
    )

    set({
      nodes: resolveCollisions([...nextNodes, ...internalNodes], internalNodes[0]?.id ?? nodeId),
      edges: [...edges, ...internalEdges],
    })
    return internalNodes.length
  },

  lockNodeInternals: (nodeId) => {
    const { nodes, edges } = get()
    const internalIds = new Set(nodes.filter((node) => node.data.internalOf === nodeId).map((node) => node.id))
    if (internalIds.size === 0) return 0
    get().takeSnapshot()
    set({
      nodes: nodes
        .filter((node) => !internalIds.has(node.id))
        .map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, internalsUnlocked: false } }
            : node,
        ),
      edges: edges.filter(
        (edge) =>
          !internalIds.has(edge.source) &&
          !internalIds.has(edge.target) &&
          edge.data?.internalOf !== nodeId,
      ),
    })
    return internalIds.size
  },

  resolveNodeCollisions: (movedId) => {
    set((state) => ({ nodes: resolveCollisions(state.nodes, movedId) }))
  },

  resizeGroupToFit: (groupId) => {
    const { nodes } = get()
    const group = nodes.find((n) => n.id === groupId && n.type === "group")
    if (!group || group.data.collapsed) return
    const children = nodes.filter((n) => n.parentId === groupId && !n.hidden)
    if (children.length === 0) return

    const PAD = 32
    const HEADER = 44
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const c of children) {
      const r = nodeRect(c)
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.width)
      maxY = Math.max(maxY, r.y + r.height)
    }

    // 子节点相对坐标可能为负（拖到分组左/上侧）→ 平移分组原点并修正所有子节点
    const shiftX = Math.max(0, PAD - minX)
    const shiftY = Math.max(0, HEADER + PAD - minY)
    const width = Math.max((group.width as number) ?? 320, maxX + shiftX + PAD)
    const height = Math.max((group.height as number) ?? 220, maxY + shiftY + PAD)

    set({
      nodes: nodes.map((n) => {
        if (n.id === groupId) {
          return {
            ...n,
            position: { x: n.position.x - shiftX, y: n.position.y - shiftY },
            width,
            height,
            style: { ...n.style, width, height },
          }
        }
        if (n.parentId === groupId) {
          return { ...n, position: { x: n.position.x + shiftX, y: n.position.y + shiftY } }
        }
        return n
      }),
    })
  },

  setNodes: (updater) => set((state) => ({ nodes: updater(state.nodes) })),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearHelperLines: () => set({ helperLines: { snapPosition: {} } }),

  save: () => {
    const { nodes, edges, drawings } = get()
    if (typeof window === "undefined") return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, drawings }))
  },

  load: () => {
    if (typeof window === "undefined") return false
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    try {
      const parsed = JSON.parse(raw) as FlowSnapshot
      get().takeSnapshot()
      set({ nodes: parsed.nodes, edges: parsed.edges, drawings: parsed.drawings ?? [] })
      return true
    } catch {
      return false
    }
  },

  reset: () => {
    get().takeSnapshot()
    set({
      workflowProject: initialWorkflowProject,
      nodes: initialWorkflowFlow.nodes,
      edges: initialWorkflowFlow.edges,
      drawings: [],
      networkStack: [],
    })
  },

  importFlow: (snapshotData) => {
    get().takeSnapshot()
    set({ nodes: snapshotData.nodes, edges: snapshotData.edges, drawings: snapshotData.drawings ?? [], networkStack: [] })
  },

  importWorkflowProject: (project) => {
    const flow = workflowProjectToReactFlow(project)
    get().takeSnapshot()
    set({ workflowProject: project, nodes: flow.nodes, edges: flow.edges, drawings: [], networkStack: [] })
  },

  applyWorkflowCapabilities: (capabilities) => {
    set((state) => {
      const projectNodes = state.workflowProject.nodes.map((node) => {
        const catalogId = typeof node.ui?.catalogId === "string" ? node.ui.catalogId : null
        const runtimeCapability = catalogId ? catalogRuntimeCapability(capabilities, catalogId) : undefined
        if (!runtimeCapability) return node
        return {
          ...node,
          ui: {
            ...(node.ui ?? {}),
            runtimeCapability,
          },
        }
      })
      const workflowProject = parseWorkflowProject({
        ...state.workflowProject,
        nodes: projectNodes,
      })
      const runtimeByNodeId = new Map<string, WorkflowRuntimeCapability>()
      for (const node of workflowProject.nodes) {
        const runtimeCapability = node.ui?.runtimeCapability
        if (isWorkflowRuntimeCapability(runtimeCapability)) {
          runtimeByNodeId.set(node.id, runtimeCapability)
        }
      }
      return {
        workflowProject,
        nodes: state.nodes.map((node) => {
          const runtimeCapability = runtimeByNodeId.get(node.id)
          if (!runtimeCapability || typeof runtimeCapability !== "object") return node
          return {
            ...node,
            data: {
              ...node.data,
              runtimeCapability,
            },
          }
        }),
      }
    })
  },

  applyWorkflowNodeRunEvent: (event) => {
    set((state) => {
      const runtimeRunState = runStateForEvent(event)
      const canvasNodeIds = new Set(
        runtimeNodeIdCandidates(event.nodeId, event.packageNodeId, event.internalNodeId),
      )
      const nextProject = parseWorkflowProject({
        ...state.workflowProject,
        nodes: state.workflowProject.nodes.map((node) =>
          patchProjectNodeRunEvent(node, event, runtimeRunState),
        ),
      })
      return {
        workflowProject: nextProject,
        nodes: state.nodes.map((node) =>
          canvasNodeIds.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: workflowNodeStatusFromEvent(event.eventType),
                  runtimeRunState,
                  runtimeLatestEvent: event,
                  runtimePreview: {
                    ...(node.data.runtimePreview ?? {}),
                    status: event.eventType,
                    runId: event.workflowRunId,
                    traceId: event.traceId,
                    sourceGroups: event.sourceGroup ? [event.sourceGroup] : node.data.runtimePreview?.sourceGroups,
                    diagnostic: event.message ?? event.blockReason?.message ?? node.data.runtimePreview?.diagnostic,
                  },
                },
              }
            : node,
        ),
      }
    })
  },

  applyWorkflowRunProjection: (projection) => {
    set((state) => {
      const stateByCanvasNodeId = runtimeStateByCanvasNodeId(projection)
      const nextProject = parseWorkflowProject({
        ...state.workflowProject,
        nodes: state.workflowProject.nodes.map((node) =>
          patchProjectNodeRunProjection(node, stateByCanvasNodeId),
        ),
      })
      return {
        workflowProject: nextProject,
        nodes: state.nodes.map((node) => {
          const runtimeRunState = stateByCanvasNodeId.get(node.id)
          if (!runtimeRunState) return node
          const latestBlock = runtimeRunState.blockReasons.at(-1)
          return {
            ...node,
            data: {
              ...node.data,
              status: workflowNodeStatusFromRun(runtimeRunState.status),
              runtimeRunState,
              runtimePreview: {
                ...(node.data.runtimePreview ?? {}),
                status: runtimeRunState.status,
                runId: projection.runId,
                traceId: projection.traceId,
                sourceGroups: runtimeRunState.sourceGroups,
                diagnostic: latestBlock?.message ?? node.data.runtimePreview?.diagnostic,
              },
            },
          }
        }),
      }
    })
  },

  updateWorkflowProfile: (profile) => {
    get().takeSnapshot()
    set((state) => ({ workflowProject: parseWorkflowProject({ ...state.workflowProject, profile }) }))
  },

  queueAgentProposal: (proposal) => set({ pendingAgentProposal: proposal }),
  clearPendingAgentProposal: () => set({ pendingAgentProposal: null }),

  focusProposalTargets: (nodeIds, edgeIds = []) => {
    const focusedNodes = new Set(nodeIds)
    const focusedEdges = new Set(edgeIds)
    set((state) => ({
      nodes: state.nodes.map((node) => ({
        ...node,
        selected: focusedNodes.has(node.id),
        data: {
          ...node.data,
          proposalFocused: focusedNodes.has(node.id),
        },
      })),
      edges: state.edges.map((edge) => ({
        ...edge,
        selected: focusedEdges.has(edge.id),
        data: {
          ...edge.data,
          proposalFocused: focusedEdges.has(edge.id),
        },
      })),
    }))
  },

  clearProposalFocus: () => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.data.proposalFocused ? { ...node, data: { ...node.data, proposalFocused: false } } : node,
      ),
      edges: state.edges.map((edge) =>
        edge.data?.proposalFocused ? { ...edge, data: { ...edge.data, proposalFocused: false } } : edge,
      ),
    }))
  },

  applyGeneratedWorkflow: (spec) => {
    get().takeSnapshot()

    const nodes: WorkflowNode[] = spec.nodes.map((n, i) => {
      const item = NODE_PALETTE.find((p) => p.nodeType === n.type && p.nodeType !== "shape") ?? NODE_PALETTE[0]
      const rfType = n.type === "note" ? "note" : "workflow"
      const data: WorkflowNodeData = {
        label: n.label,
        description: n.description,
        nodeType: item.nodeType,
        category: item.category,
        icon: item.icon,
        color: item.color,
        status: "idle",
      }
      if (n.type === "condition") {
        data.condition = n.config || "value > 0"
      } else if (n.config) {
        const base = item.defaultData?.fields
        data.fields =
          base && base.length > 0
            ? [{ ...base[0], value: n.config }, ...base.slice(1)]
            : [{ id: "value", label: "参数", value: n.config }]
      } else if (item.defaultData) {
        Object.assign(data, JSON.parse(JSON.stringify(item.defaultData)))
      }
      return {
        id: n.id,
        type: rfType,
        position: { x: (i % 3) * 260, y: Math.floor(i / 3) * 160 },
        data,
      }
    })

    const validIds = new Set(nodes.map((n) => n.id))
    const edges: WorkflowEdge[] = spec.edges
      .filter((e) => validIds.has(e.source) && validIds.has(e.target))
      .map((e) => ({
        id: `e-${nanoid(6)}`,
        source: e.source,
        target: e.target,
        type: "workflow" as const,
        animated: true,
        ...(e.label ? { label: e.label, data: { label: e.label } } : {}),
      }))

    set({ nodes, edges, drawings: [], networkStack: [] })
    // 端口在上下两侧 → 纵向 TB 布局
    void get().autoLayout("TB", "elk", true)
  },
}))
