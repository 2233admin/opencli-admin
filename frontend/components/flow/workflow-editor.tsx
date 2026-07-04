"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  SelectionMode,
  useReactFlow,
  useStore,
  type IsValidConnection,
  type Node,
  type OnBeforeDelete,
  type OnNodeDrag,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { useFlowStore } from "@/lib/flow/store"
import { useSettingsStore } from "@/lib/flow/settings-store"
import { validateConnection } from "@/lib/flow/graph"
import type { PaletteItem, WorkflowNode, WorkflowEdge, ToolMode } from "@/lib/flow/types"
import { Inspector } from "./inspector"
import { CommandStrip } from "./command-strip"
import { CommandPalette } from "./command-palette"
import { HelperLinesRenderer } from "./helper-lines-renderer"
import { WorkflowMotionRuntime } from "./workflow-motion-runtime"
import { DrawingLayer } from "./drawing-layer"
import { Collaboration } from "./collaboration"
import WorkflowNodeComp from "./nodes/workflow-node"
import NoteNode from "./nodes/note-node"
import GroupNode from "./nodes/group-node"
import ShapeNode from "./nodes/shape-node"
import MathNode from "./nodes/math-node"
import WorkflowEdge_ from "./edges/workflow-edge"
import EditableEdge from "./edges/editable-edge"
import RoutedEdge from "./edges/routed-edge"
import { InteractionSettingsPanel } from "./interaction-settings-panel"
import { ProjectSettingsPanel } from "./project-settings-panel"
import { RunTracePanel } from "./run-trace-panel"
import { AgentDrawer } from "./agent-drawer"
import { NodeManagementPanel } from "./node-management-panel"
import { acceptAgentProposal, type AgentProposal } from "@/lib/workflow/proposal"
import type { ProposalFocusTarget } from "@/lib/workflow/proposal-focus"
import { getWorkflowNodeCatalog, type WorkflowNodeCatalogItem } from "@/lib/workflow/node-catalog"
import { getWorkflowPrimitives, type WorkflowPrimitive } from "@/lib/workflow/node-primitives"
import { groupPrimitivesForNodeMenu } from "@/lib/workflow/node-menu"
import { localizeNodeText } from "@/lib/workflow/node-i18n"
import { getNodeVisualSignature } from "@/lib/workflow/node-visuals"
import { primitiveRuntimeCapability, runtimeStatusLabel, runtimeStatusTone } from "@/lib/workflow/capabilities"
import { useWorkflowCapabilities } from "@/lib/workflow/use-workflow-capabilities"
import { loadShareStateFromUrl } from "@/lib/flow/share-state"
import { cn } from "@/lib/utils"

const nodeTypes = {
  workflow: WorkflowNodeComp,
  note: NoteNode,
  group: GroupNode,
  shape: ShapeNode,
  math: MathNode,
}

const edgeTypes = {
  workflow: WorkflowEdge_,
  editable: EditableEdge,
  routed: RoutedEdge,
}

type ShakeState = {
  lastX: number
  lastDirection: -1 | 0 | 1
  turns: number
  disconnected: boolean
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function edgeIdsAtScreenPoint(point: { x: number; y: number }, threshold = 10): string[] {
  const hits: string[] = []
  const edges = document.querySelectorAll<SVGGElement>(".react-flow__edge[data-id]")

  edges.forEach((edge) => {
    const id = edge.dataset.id
    const path = edge.querySelector<SVGPathElement>("path.react-flow__edge-path, path[id]")
    if (!id || !path) return
    const ctm = path.getScreenCTM()
    if (!ctm) return

    const total = path.getTotalLength()
    const steps = Math.max(16, Math.ceil(total / 18))
    for (let i = 0; i <= steps; i++) {
      const svgPoint = path.getPointAtLength((total * i) / steps)
      const screenPoint = new DOMPoint(svgPoint.x, svgPoint.y).matrixTransform(ctm)
      if (distance(point, screenPoint) <= threshold) {
        hits.push(id)
        return
      }
    }
  })

  return hits
}

function localPoint(element: HTMLElement | null, event: ReactMouseEvent) {
  const rect = element?.getBoundingClientRect()
  if (!rect) return { x: event.clientX, y: event.clientY }
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function minimapNodeColor(node: { selected?: boolean }) {
  return node.selected ? "#e8e8e6" : "#3a3d42"
}

/** Live zoom bridge so nodes can render at different detail levels. */
function ZoomProvider({ onZoom }: { onZoom: (z: number) => void }) {
  const zoom = useStore((s) => s.transform[2])
  useEffect(() => {
    onZoom(zoom)
  }, [zoom, onZoom])
  return null
}

function EditorCanvas() {
  const nodes = useFlowStore((s) => s.nodes)
  const edges = useFlowStore((s) => s.edges)
  const onNodesChange = useFlowStore((s) => s.onNodesChange)
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const onConnect = useFlowStore((s) => s.onConnect)
  const helperLines = useFlowStore((s) => s.helperLines)
  const takeSnapshot = useFlowStore((s) => s.takeSnapshot)
  const clearHelperLines = useFlowStore((s) => s.clearHelperLines)
  const addNodeFromPalette = useFlowStore((s) => s.addNodeFromPalette)
  const undo = useFlowStore((s) => s.undo)
  const redo = useFlowStore((s) => s.redo)
  const copy = useFlowStore((s) => s.copy)
  const paste = useFlowStore((s) => s.paste)
  const cut = useFlowStore((s) => s.cut)
  const duplicate = useFlowStore((s) => s.duplicateSelected)
  const deleteSelected = useFlowStore((s) => s.deleteSelected)
  const autoLayout = useFlowStore((s) => s.autoLayout)
  const disconnectNodeConnections = useFlowStore((s) => s.disconnectNodeConnections)
  const removeEdgesByIds = useFlowStore((s) => s.removeEdgesByIds)
  const selectConnectedComponent = useFlowStore((s) => s.selectConnectedComponent)
  const unlockNodeInternals = useFlowStore((s) => s.unlockNodeInternals)
  const lockNodeInternals = useFlowStore((s) => s.lockNodeInternals)
  const enterNodeNetwork = useFlowStore((s) => s.enterNodeNetwork)
  const exitNodeNetwork = useFlowStore((s) => s.exitNodeNetwork)
  const networkStack = useFlowStore((s) => s.networkStack)
  const groupSelection = useFlowStore((s) => s.groupSelection)
  const attachToParent = useFlowStore((s) => s.attachToParent)
  const detachFromParent = useFlowStore((s) => s.detachFromParent)
  const resolveNodeCollisions = useFlowStore((s) => s.resolveNodeCollisions)
  const resizeGroupToFit = useFlowStore((s) => s.resizeGroupToFit)
  const toolMode = useFlowStore((s) => s.toolMode)
  const save = useFlowStore((s) => s.save)
  const workflowProject = useFlowStore((s) => s.workflowProject)
  const importWorkflowProject = useFlowStore((s) => s.importWorkflowProject)
  const applyWorkflowCapabilities = useFlowStore((s) => s.applyWorkflowCapabilities)
  const updateWorkflowProfile = useFlowStore((s) => s.updateWorkflowProfile)
  const focusProposalTargets = useFlowStore((s) => s.focusProposalTargets)
  const clearProposalFocus = useFlowStore((s) => s.clearProposalFocus)
  const addWorkflowNodeFromCatalog = useFlowStore((s) => s.addWorkflowNodeFromCatalog)
  const addPrimitiveNode = useFlowStore((s) => s.addPrimitiveNode)

  const settings = useSettingsStore()
  const setToolMode = useFlowStore((s) => s.setToolMode)

  const { screenToFlowPosition, getInternalNode, setViewport, fitView } = useReactFlow<WorkflowNode, WorkflowEdge>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mousePos = useRef({ x: 0, y: 0 })
  const shakeRef = useRef<Map<string, ShakeState>>(new Map())
  const scissorDraggingRef = useRef(false)
  const scissorCutRef = useRef<Set<string>>(new Set())
  const yMomentaryModeRef = useRef<ToolMode | null>(null)
  const [scissorTrail, setScissorTrail] = useState<{ x: number; y: number }[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [runTraceOpen, setRunTraceOpen] = useState(false)
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const [nodeManagementOpen, setNodeManagementOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [compactViewport, setCompactViewport] = useState(false)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const { capabilities } = useWorkflowCapabilities(true)
  const dopNodeMenuItems = useMemo(
    () => getWorkflowNodeCatalog(workflowProject.profile, capabilities),
    [workflowProject.profile, capabilities],
  )
  const primitiveMenuGroups = useMemo(() => groupPrimitivesForNodeMenu(getWorkflowPrimitives()), [])

  const showToast = useCallback((msg: string) => setToast(msg), [])

  useEffect(() => {
    if (capabilities) applyWorkflowCapabilities(capabilities)
  }, [applyWorkflowCapabilities, capabilities, workflowProject.id])

  useEffect(() => {
    if (typeof window === "undefined") return
    const shared = loadShareStateFromUrl(window.location.href)
    if (!shared) return
    useFlowStore.setState({
      workflowProject: shared.workflowProject,
      nodes: shared.nodes,
      edges: shared.edges,
      drawings: shared.drawings ?? [],
      networkStack: [],
      helperLines: { snapPosition: {} },
    })
    showToast("已从分享 URL 恢复 workflow")
    window.setTimeout(() => void fitView({ padding: 0.24, duration: 220 }), 30)
  }, [fitView, showToast])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!nodeMenu) return
    const close = () => setNodeMenu(null)
    window.addEventListener("click", close)
    window.addEventListener("keydown", close)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("keydown", close)
    }
  }, [nodeMenu])

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)")
    const update = () => setCompactViewport(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    if (!compactViewport || nodes.length === 0) return
    const leftMost = Math.min(...nodes.map((node) => node.position.x))
    const topMost = Math.min(...nodes.map((node) => node.position.y))
    const zoom = 0.62
    const timer = window.setTimeout(() => {
      setViewport({ x: 18 - leftMost * zoom, y: 220 - topMost * zoom, zoom }, { duration: 0 })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [compactViewport, nodes.length, setViewport])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      if (!element) return false
      return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (isEditableTarget(e.target)) return

      if (e.key === "Tab" || e.key.toLowerCase() === "b") {
        if (!mod) {
          e.preventDefault()
          setPaletteOpen(true)
          return
        }
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault()
        save()
        showToast("已保存到本地")
      } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault()
        redo()
      } else if (mod && e.key.toLowerCase() === "c") {
        copy()
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault()
        paste(screenToFlowPosition(mousePos.current))
      } else if (mod && e.key.toLowerCase() === "x") {
        cut()
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault()
        duplicate()
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault()
        groupSelection()
      } else if (!mod && e.key.toLowerCase() === "o") {
        e.preventDefault()
        const next = !useSettingsStore.getState().showMiniMap
        settings.set("showMiniMap", next)
        showToast(next ? "节点缩略图已显示" : "节点缩略图已隐藏")
      } else if (!mod && e.key.toLowerCase() === "p") {
        e.preventDefault()
        if (settingsOpen || projectSettingsOpen) {
          setSettingsOpen(false)
          setProjectSettingsOpen(false)
          setInspectorOpen(true)
          showToast("Parameter Interface 已显示")
          return
        }
        setInspectorOpen((open) => {
          const next = !open
          showToast(next ? "Parameter Interface 已显示" : "Parameter Interface 已隐藏")
          return next
        })
      } else if (!mod && e.key.toLowerCase() === "h") {
        e.preventDefault()
        if (useFlowStore.getState().nodes.length === 0) return
        void fitView({ padding: 0.24, duration: 220 })
        showToast("已显示全部节点")
      } else if (!mod && e.key.toLowerCase() === "l") {
        e.preventDefault()
        if (useFlowStore.getState().nodes.length === 0) return
        showToast("正在自动排布节点")
        void autoLayout("TB", "elk", true).then(() => {
          showToast("已自动排布整体节点")
          window.setTimeout(() => void fitView({ padding: 0.24, duration: 260 }), 30)
        })
      } else if (!mod && (e.key === "Escape" || e.key === "Backspace") && useFlowStore.getState().networkStack.length > 0) {
        e.preventDefault()
        if (exitNodeNetwork()) {
          showToast("已返回上一层 Network")
          window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
        }
      } else if (!mod && e.key.toLowerCase() === "y") {
        e.preventDefault()
        if (e.repeat) return
        yMomentaryModeRef.current = useFlowStore.getState().toolMode
        setToolMode("scissors")
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.key.toLowerCase() !== "y") return
      if (yMomentaryModeRef.current === null) return
      e.preventDefault()
      const restoreMode = yMomentaryModeRef.current
      yMomentaryModeRef.current = null
      scissorDraggingRef.current = false
      scissorCutRef.current = new Set()
      setScissorTrail([])
      setToolMode(restoreMode)
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [
    undo,
    redo,
    copy,
    paste,
    cut,
    duplicate,
    deleteSelected,
    autoLayout,
    groupSelection,
    fitView,
    screenToFlowPosition,
    save,
    setToolMode,
    settings,
    settingsOpen,
    projectSettingsOpen,
    exitNodeNetwork,
    showToast,
  ])

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData("application/reactflow")
      if (!raw) return
      const item = JSON.parse(raw) as PaletteItem
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addNodeFromPalette(item, position)
    },
    [screenToFlowPosition, addNodeFromPalette],
  )

  const cutEdgesAtPoint = useCallback(
    (event: ReactMouseEvent) => {
      const hits = edgeIdsAtScreenPoint({ x: event.clientX, y: event.clientY })
      const fresh = hits.filter((id) => !scissorCutRef.current.has(id))
      if (fresh.length === 0) return
      fresh.forEach((id) => scissorCutRef.current.add(id))
      const removed = removeEdgesByIds(fresh)
      if (removed > 0) showToast(`已剪断 ${removed} 条连接`)
    },
    [removeEdgesByIds, showToast],
  )

  const onCanvasMouseDownCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (toolMode !== "scissors" || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      scissorDraggingRef.current = true
      scissorCutRef.current = new Set()
      setScissorTrail([localPoint(wrapperRef.current, event)])
      cutEdgesAtPoint(event)
    },
    [cutEdgesAtPoint, toolMode],
  )

  const onCanvasMouseMoveCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!scissorDraggingRef.current) return
      event.preventDefault()
      event.stopPropagation()
      setScissorTrail((trail) => {
        const next = [...trail, localPoint(wrapperRef.current, event)]
        return next.length > 80 ? next.slice(-80) : next
      })
      cutEdgesAtPoint(event)
    },
    [cutEdgesAtPoint],
  )

  const onCanvasMouseUpCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!scissorDraggingRef.current) return
    event.preventDefault()
    event.stopPropagation()
    scissorDraggingRef.current = false
    scissorCutRef.current = new Set()
    window.setTimeout(() => setScissorTrail([]), 120)
  }, [])

  const onNodeDrag: OnNodeDrag<WorkflowNode> = useCallback(
    (_e, node) => {
      const current = shakeRef.current.get(node.id) ?? {
        lastX: node.position.x,
        lastDirection: 0,
        turns: 0,
        disconnected: false,
      }
      const delta = node.position.x - current.lastX
      if (Math.abs(delta) < 14) {
        shakeRef.current.set(node.id, { ...current, lastX: node.position.x })
        return
      }
      const direction = delta > 0 ? 1 : -1
      const turns = current.lastDirection !== 0 && current.lastDirection !== direction ? current.turns + 1 : current.turns
      const next = {
        lastX: node.position.x,
        lastDirection: direction as -1 | 1,
        turns,
        disconnected: current.disconnected,
      }
      if (!next.disconnected && turns >= 4) {
        const removed = disconnectNodeConnections(node.id)
        if (removed > 0) {
          next.disconnected = true
          showToast(`已断开 ${removed} 条连接`)
        }
      }
      shakeRef.current.set(node.id, next)
    },
    [disconnectNodeConnections, showToast],
  )

  const unlockInternals = useCallback(
    (nodeId: string) => {
      const count = unlockNodeInternals(nodeId)
      showToast(count > 0 ? `已解锁 ${count} 个下层节点` : "这个节点没有可解锁的下层节点")
      setNodeMenu(null)
    },
    [showToast, unlockNodeInternals],
  )

  const diveIntoNetwork = useCallback(
    (nodeId: string) => {
      const count = enterNodeNetwork(nodeId)
      showToast(count > 0 ? `Dive into Network: ${count} nodes` : "这个节点没有下层 Network")
      setNodeMenu(null)
      if (count > 0) {
        window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
      }
    },
    [enterNodeNetwork, fitView, showToast],
  )

  const addDopNodeFromMenu = useCallback(
    (item: WorkflowNodeCatalogItem) => {
      if (!nodeMenu) return
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, settings.language)
      addWorkflowNodeFromCatalog(item, screenToFlowPosition({ x: nodeMenu.x + 26, y: nodeMenu.y + 26 }))
      showToast(`已添加 DOP 节点：${text.label}`)
      setNodeMenu(null)
    },
    [addWorkflowNodeFromCatalog, nodeMenu, screenToFlowPosition, settings.language, showToast],
  )

  const addPrimitiveFromMenu = useCallback(
    (item: WorkflowPrimitive, itemIndex: number) => {
      if (!nodeMenu) return
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, settings.language)
      const isInsideNetwork = useFlowStore.getState().networkStack.length > 0
      let position = screenToFlowPosition({ x: nodeMenu.x + 280, y: nodeMenu.y + 26 + itemIndex * 34 })

      if (!isInsideNetwork) {
        const count = enterNodeNetwork(nodeMenu.nodeId)
        if (count > 0) {
          position = { x: 780, y: 96 + itemIndex * 96 }
          window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
        } else {
          showToast("这个节点没有下层 Network，已在当前层添加 draft primitive")
        }
      }

      addPrimitiveNode(item, position, primitiveRuntimeCapability(capabilities, item.id))
      showToast(`已添加原子节点：${text.label}`)
      setNodeMenu(null)
    },
    [addPrimitiveNode, capabilities, enterNodeNetwork, fitView, nodeMenu, screenToFlowPosition, settings.language, showToast],
  )

  const lockInternals = useCallback(
    (nodeId: string) => {
      const count = lockNodeInternals(nodeId)
      showToast(count > 0 ? `已收回 ${count} 个下层节点` : "没有已解锁的下层节点")
      setNodeMenu(null)
    },
    [lockNodeInternals, showToast],
  )

  const selectComponentFromMenu = useCallback(
    (nodeId: string) => {
      const result = selectConnectedComponent(nodeId)
      showToast(`已选中组件：${result.nodeIds.length} 节点 / ${result.edgeIds.length} 连线`)
      setNodeMenu(null)
      if (result.nodeIds.length > 0) {
        window.setTimeout(() => void fitView({ nodes: result.nodeIds.map((id) => ({ id })), padding: 0.35, duration: 260 }), 20)
      }
    },
    [fitView, selectConnectedComponent, showToast],
  )

  const onNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      diveIntoNetwork(node.id)
    },
    [diveIntoNetwork],
  )

  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node) => {
    event.preventDefault()
    event.stopPropagation()
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY })
  }, [])

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      clearHelperLines()
      shakeRef.current.delete(node.id)
      if (node.type === "group") {
        resizeGroupToFit(node.id)
        return
      }
      const internal = getInternalNode(node.id)
      const abs = internal?.internals.positionAbsolute ?? node.position
      const w = node.measured?.width ?? 240
      const h = node.measured?.height ?? 96
      const cx = abs.x + w / 2
      const cy = abs.y + h / 2

      const wf = node as WorkflowNode
      const groups = useFlowStore
        .getState()
        .nodes.filter((n) => n.type === "group" && !n.data.collapsed && n.id !== node.id)
      const targetGroup = groups.find((g) => {
        const gw = (g.width as number) ?? g.measured?.width ?? 320
        const gh = (g.height as number) ?? g.measured?.height ?? 220
        return cx >= g.position.x && cx <= g.position.x + gw && cy >= g.position.y && cy <= g.position.y + gh
      })

      if (targetGroup && wf.parentId !== targetGroup.id) {
        attachToParent(node.id, targetGroup.id)
      } else if (!targetGroup && wf.parentId) {
        detachFromParent(node.id)
      } else if (targetGroup && wf.parentId === targetGroup.id) {
        resizeGroupToFit(targetGroup.id)
      }
      resolveNodeCollisions(node.id)
    },
    [clearHelperLines, getInternalNode, attachToParent, detachFromParent, resizeGroupToFit, resolveNodeCollisions],
  )

  // Prevent Cycles + Connection Limit + typed handles → isValidConnection
  const isValidConnection: IsValidConnection<WorkflowEdge> = useCallback(
    (connection) => {
      const conn = {
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      }
      const res = validateConnection(useFlowStore.getState().edges, conn, {
        preventCycles: settings.preventCycles,
        maxSourceConnections: settings.maxSourceConnections,
        maxTargetConnections: settings.maxTargetConnections,
        typedHandles: settings.typedHandles,
        nodes: useFlowStore.getState().nodes,
      })
      if (!res.ok) {
        showToast(res.reason)
        return false
      }
      return true
    },
    [settings.preventCycles, settings.maxSourceConnections, settings.maxTargetConnections, settings.typedHandles, showToast],
  )

  // Confirm Delete
  const onBeforeDelete: OnBeforeDelete<WorkflowNode, WorkflowEdge> = useCallback(
    async ({ nodes: toDelNodes, edges: toDelEdges }) => {
      if (!settings.confirmDelete) return { nodes: toDelNodes, edges: toDelEdges }
      const count = toDelNodes.length + toDelEdges.length
      if (count === 0) return false
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        `确认删除 ${toDelNodes.length} 个节点 / ${toDelEdges.length} 条连线？`,
      )
      if (!ok) return false
      return { nodes: toDelNodes, edges: toDelEdges }
    },
    [settings.confirmDelete],
  )

  const isDraw = toolMode === "draw"
  const isScissors = toolMode === "scissors"
  const networkLocked = networkStack.length > 0 && nodes.some((node) => node.data.internalLocked === true)
  const acceptProposal = useCallback(
    (proposal: AgentProposal) => {
      try {
        importWorkflowProject(acceptAgentProposal(useFlowStore.getState().workflowProject, proposal))
        showToast("Agent proposal accepted")
        setAgentDrawerOpen(false)
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Agent proposal failed")
      }
    },
    [importWorkflowProject, showToast],
  )

  const rejectProposal = useCallback(() => {
    showToast("Agent proposal rejected")
    clearProposalFocus()
    setAgentDrawerOpen(false)
  }, [clearProposalFocus, showToast])

  const focusProposalOperation = useCallback(
    (focus: ProposalFocusTarget) => {
      focusProposalTargets(focus.nodeIds, focus.edgeIds)
      if (focus.nodeIds.length > 0) {
        window.setTimeout(() => void fitView({ nodes: focus.nodeIds.map((id) => ({ id })), padding: 0.35, duration: 280 }), 20)
      }
    },
    [fitView, focusProposalTargets],
  )

  const touchProps = useMemo(
    () =>
      settings.touchMode
        ? { panOnDrag: [1, 2] as number[], selectionOnDrag: false, panOnScroll: true }
        : {},
    [settings.touchMode],
  )

  return (
    <div data-health="workflow-editor" className="flex h-full min-h-0 flex-1 flex-col">
      <CommandStrip
        onOpenPalette={() => setPaletteOpen(true)}
        onExported={showToast}
        collab={settings.collabProvider !== "off"}
        onToggleCollab={() =>
          settings.set(
            "collabProvider",
            settings.collabProvider === "off" ? "yjs" : "off",
          )
        }
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        projectSettingsOpen={projectSettingsOpen}
        onToggleProjectSettings={() => setProjectSettingsOpen((v) => !v)}
        runTraceOpen={runTraceOpen}
        onToggleRunTrace={() => setRunTraceOpen((v) => !v)}
        agentDrawerOpen={agentDrawerOpen}
        onToggleAgentDrawer={() => setAgentDrawerOpen((v) => !v)}
        nodeManagementOpen={nodeManagementOpen}
        onToggleNodeManagement={() => setNodeManagementOpen((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        <div
          ref={wrapperRef}
          className="relative min-w-0 flex-1"
          onMouseDownCapture={onCanvasMouseDownCapture}
          onMouseMoveCapture={onCanvasMouseMoveCapture}
          onMouseUpCapture={onCanvasMouseUpCapture}
          onMouseMove={(e) => {
            mousePos.current = { x: e.clientX, y: e.clientY }
          }}
          data-zoom-bucket={zoom < 0.5 ? "low" : zoom > 1.4 ? "high" : "mid"}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={takeSnapshot}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={onNodeContextMenu}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "workflow", animated: true }}
            fitView
            fitViewOptions={{ padding: compactViewport ? 0.24 : 0.15, minZoom: compactViewport ? 0.62 : 0.2 }}
            isValidConnection={isValidConnection}
            onBeforeDelete={onBeforeDelete}
            nodesDraggable={settings.nodesDraggable && !isDraw && !isScissors}
            nodesConnectable={settings.nodesConnectable && !isScissors}
            elementsSelectable={settings.elementsSelectable}
            zoomOnScroll={settings.zoomOnScroll}
            zoomOnPinch={settings.zoomOnPinch}
            zoomOnDoubleClick={settings.zoomOnDoubleClick}
            panOnScroll={settings.panOnScroll && !isDraw && !isScissors}
            panOnDrag={settings.panOnDrag && !isDraw && !isScissors ? [1, 2] : false}
            selectionOnDrag={settings.selectionOnDrag && !isDraw && !isScissors}
            selectionMode={SelectionMode.Partial}
            {...touchProps}
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={2}
            className={cn("bg-background", isScissors && "cursor-crosshair")}
            data-tool-mode={toolMode}
          >
            <ZoomProvider onZoom={setZoom} />
            {settings.showBackground ? (
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#26282c" />
            ) : null}
            {settings.showControls ? (
              <Controls className="!rounded-md !border !border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button:hover]:!bg-accent [&_button]:!fill-muted-foreground" />
            ) : null}
            {settings.showMiniMap ? (
              <MiniMap
                pannable
                zoomable
                nodeColor={minimapNodeColor}
                className="!rounded-md !border !border-border !bg-card"
                maskColor="rgb(10 10 10 / 0.75)"
              />
            ) : null}
            <HelperLinesRenderer lines={helperLines} />
            <WorkflowMotionRuntime interaction={helperLines.interaction} />
            <DrawingLayer />
            <Collaboration />
          </ReactFlow>

          {isScissors ? (
            <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
              {scissorTrail.length > 1 ? (
                <>
                  <polyline
                    points={scissorTrail.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="var(--background)"
                    strokeWidth={7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                  <polyline
                    points={scissorTrail.map((p) => `${p.x},${p.y}`).join(" ")}
                    className="workflow-scissor-trail"
                    fill="none"
                    stroke="#ff7a17"
                    strokeWidth={2}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : null}
            </svg>
          ) : null}

          {runTraceOpen ? (
            <div className={cn("workflow-floating-panel absolute top-3 z-40", nodeManagementOpen ? "left-[28.75rem]" : "left-3")}>
              <RunTracePanel />
            </div>
          ) : null}

          {nodeManagementOpen ? <NodeManagementPanel onClose={() => setNodeManagementOpen(false)} /> : null}

          {networkStack.length > 0 ? (
            <div className="workflow-floating-panel absolute left-3 top-3 z-40 flex items-center gap-2 rounded-md border bg-popover px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] shadow-lg">
              <button
                type="button"
                className="rounded-sm border border-border bg-background px-2 py-1 text-foreground transition-colors hover:bg-accent"
                onClick={() => {
                  if (exitNodeNetwork()) {
                    showToast("已返回上一层 Network")
                    window.setTimeout(() => void fitView({ padding: 0.24, duration: 180 }), 20)
                  }
                }}
              >
                ← Up
              </button>
              <span className="text-muted-foreground/60">/</span>
              <span className="text-muted-foreground">obj</span>
              {networkStack.map((entry) => (
                <span key={entry.nodeId} className="flex items-center gap-1">
                  <span className="text-muted-foreground/60">/</span>
                  <span className="text-foreground">{entry.label}</span>
                </span>
              ))}
              <span className={cn("rounded-sm border px-1.5 py-0.5", networkLocked ? "border-[#d97706]/50 text-[#d97706]" : "border-[#2f9e44]/50 text-[#2f9e44]")}>
                {networkLocked ? "LOCKED" : "DRAFT"}
              </span>
              <span className="ml-1 text-muted-foreground/60">Esc / Backspace</span>
            </div>
          ) : null}

          {nodeMenu ? (
            <div
              className="workflow-context-menu absolute z-50 min-w-64 rounded-sm border border-border bg-[#383838] py-1 text-xs text-[#d8d8d8] shadow-xl"
              style={{
                left: nodeMenu.x - (wrapperRef.current?.getBoundingClientRect().left ?? 0),
                top: nodeMenu.y - (wrapperRef.current?.getBoundingClientRect().top ?? 0),
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                onClick={() => diveIntoNetwork(nodeMenu.nodeId)}
              >
                <span>Dive into Network</span>
                <span className="text-[#a8a8a8]">Enter</span>
              </button>
              <div className="my-1 border-t border-[#626262]" />
              <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#a8a8a8]">
                DOP Operators
              </div>
              <div className="max-h-64 overflow-y-auto">
                {dopNodeMenuItems.map((item) => {
                  const text = localizeNodeText(item.id, { label: item.label, description: item.description }, settings.language)
                  const visual = getNodeVisualSignature({
                    label: item.label,
                    description: item.description,
                    nodeType: item.kind === "router" ? "condition" : item.kind === "schedule" ? "trigger" : item.kind === "source" ? "http" : "action",
                    category: item.category === "decision" ? "logic" : item.category === "trigger" ? "trigger" : item.category === "source" ? "data" : item.category === "output" ? "action" : "action",
                    icon: item.icon,
                    canonical: { catalogId: item.id, kind: item.kind, capability: item.capability },
                  })
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                      onClick={() => addDopNodeFromMenu(item)}
                    >
                      <span className="w-8 shrink-0 font-mono text-[9px] text-[#a8d8ff]">{visual.code}</span>
                      <span className="min-w-0 flex-1 truncate">{text.label}</span>
                      <span
                        className={cn(
                          "rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase",
                          runtimeStatusTone(item.runtimeCapability?.status),
                        )}
                        title={item.runtimeCapability?.reason ?? item.kind}
                      >
                        {runtimeStatusLabel(item.runtimeCapability?.status)}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="group/atoms relative">
                <div className="flex w-full items-center justify-between px-3 py-1.5 text-left font-semibold text-white hover:bg-[#4a4a4a]">
                  <span>Add Internal Primitive</span>
                  <span className="text-[#a8a8a8]">›</span>
                </div>
                <div className="pointer-events-none absolute left-full top-0 ml-1 hidden min-w-60 rounded-sm border border-border bg-[#383838] py-1 text-xs text-[#d8d8d8] shadow-xl group-hover/atoms:pointer-events-auto group-hover/atoms:block">
                  {primitiveMenuGroups.map((group) => (
                    <div key={group.category} className="group/atom-category relative">
                      <div className="flex items-center justify-between px-3 py-1.5 hover:bg-[#4a4a4a] hover:text-white">
                        <span>{group.label}</span>
                        <span className="text-[#a8a8a8]">›</span>
                      </div>
                      <div className="pointer-events-none absolute left-full top-0 ml-1 hidden min-w-64 rounded-sm border border-border bg-[#383838] py-1 text-xs text-[#d8d8d8] shadow-xl group-hover/atom-category:pointer-events-auto group-hover/atom-category:block">
                        {group.items.map((item, itemIndex) => {
                          const text = localizeNodeText(item.id, { label: item.label, description: item.description }, settings.language)
                          const runtimeCapability = primitiveRuntimeCapability(capabilities, item.id)
                          const visual = getNodeVisualSignature({
                            label: item.label,
                            description: item.description,
                            nodeType: item.nodeType,
                            category: item.nodeCategory,
                            icon: item.icon,
                            primitiveId: item.id,
                            primitiveCategory: item.category,
                          })
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                              onClick={() => addPrimitiveFromMenu(item, itemIndex)}
                            >
                              <span className="w-8 shrink-0 font-mono text-[9px] text-[#a8d8ff]">{visual.code}</span>
                              <span className="min-w-0 flex-1 truncate">{text.label}</span>
                              <span
                                className={cn(
                                  "rounded-[3px] border px-1 py-0.5 font-mono text-[8px] uppercase",
                                  runtimeStatusTone(runtimeCapability?.status ?? "design_only"),
                                )}
                                title={runtimeCapability?.reason ?? item.category}
                              >
                                {runtimeStatusLabel(runtimeCapability?.status ?? "design_only")}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="my-1 border-t border-[#626262]" />
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                onClick={() => selectComponentFromMenu(nodeMenu.nodeId)}
              >
                <span>Select Connected Component</span>
                <span className="text-[#a8a8a8]">Strudel</span>
              </button>
              <div className="my-1 border-t border-[#626262]" />
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                onClick={() => {
                  setNodeMenu(null)
                  setInspectorOpen(true)
                  showToast("Parameter Interface 已显示")
                }}
              >
                <span>Parameters and Channels</span>
                <span className="text-[#a8a8a8]">›</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                onClick={() => {
                  setNodeMenu(null)
                  showToast("Node information is in Parameter Interface")
                }}
              >
                <span>Show Node Information...</span>
              </button>
              <div className="my-1 border-t border-[#626262]" />
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                onClick={() => unlockInternals(nodeMenu.nodeId)}
              >
                <span>Unlock Package in Current Network</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[#4a4a4a] hover:text-white"
                onClick={() => lockInternals(nodeMenu.nodeId)}
              >
                <span>Lock Package</span>
              </button>
              <div className="my-1 border-t border-[#626262]" />
              <div className="px-3 py-1.5 text-[#cfcfcf]">Help...</div>
            </div>
          ) : null}

          {projectSettingsOpen ? (
            <div className="workflow-floating-panel absolute bottom-3 right-3 top-3 z-40">
              <ProjectSettingsPanel profile={workflowProject.profile} onProfileChange={updateWorkflowProfile} />
            </div>
          ) : settingsOpen ? (
            <div className="workflow-floating-panel contents">
              <InteractionSettingsPanel />
            </div>
          ) : inspectorOpen ? (
            <div className="workflow-floating-panel contents">
              <Inspector />
            </div>
          ) : null}

          <AgentDrawer
            open={agentDrawerOpen}
            onAccept={acceptProposal}
            onReject={rejectProposal}
            onFocusOperation={focusProposalOperation}
            onClose={() => setAgentDrawerOpen(false)}
          />

          {toast ? (
            <div className="workflow-toast pointer-events-none absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-popover px-4 py-2 font-mono text-xs shadow-lg">
              {toast}
            </div>
          ) : null}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onMessage={showToast}
        getAnchor={() => screenToFlowPosition(mousePos.current)}
      />
    </div>
  )
}

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorCanvas />
    </ReactFlowProvider>
  )
}
