import {
  useCallback,
  type Dispatch,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from "react"
import type { IsValidConnection, Node, OnBeforeDelete, OnNodeDrag } from "@xyflow/react"

import { useFlowStore } from "@/lib/flow/store"
import type { CanvasSettings } from "@/lib/flow/settings-store"
import { validateConnection } from "@/lib/flow/graph"
import type { PaletteItem, WorkflowEdge, WorkflowNode } from "@/lib/flow/types"
import { edgeIdsAtScreenPoint, localPoint, type CanvasPoint } from "./workflow-canvas-geometry"

type WritableRef<T> = { current: T }
type ScreenToFlowPosition = (position: CanvasPoint) => CanvasPoint
type ShowToast = (message: string) => void

export type ShakeState = {
  lastX: number
  lastDirection: -1 | 0 | 1
  turns: number
  disconnected: boolean
}

export function usePaletteDrop(options: {
  addNodeFromPalette: (item: PaletteItem, position: CanvasPoint) => void
  screenToFlowPosition: ScreenToFlowPosition
}) {
  const { addNodeFromPalette, screenToFlowPosition } = options
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData("application/reactflow")
      if (!raw) return
      addNodeFromPalette(JSON.parse(raw) as PaletteItem, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    },
    [screenToFlowPosition, addNodeFromPalette],
  )

  return { onDragOver, onDrop }
}

export function useScissorCanvasHandlers(options: {
  cutRef: WritableRef<Set<string>>
  draggingRef: WritableRef<boolean>
  removeEdgesByIds: (ids: string[]) => number
  setTrail: Dispatch<SetStateAction<CanvasPoint[]>>
  showToast: ShowToast
  toolMode: string
  wrapperRef: RefObject<HTMLElement | null>
}) {
  const { cutRef, draggingRef, removeEdgesByIds, setTrail, showToast, toolMode, wrapperRef } = options
  const cutEdgesAtPoint = useCallback(
    (event: ReactMouseEvent) => {
      const hits = edgeIdsAtScreenPoint({ x: event.clientX, y: event.clientY })
      const fresh = hits.filter((id) => !cutRef.current.has(id))
      if (fresh.length === 0) return
      fresh.forEach((id) => cutRef.current.add(id))
      const removed = removeEdgesByIds(fresh)
      if (removed > 0) showToast(`已剪断 ${removed} 条连接`)
    },
    [cutRef, removeEdgesByIds, showToast],
  )

  const onCanvasMouseDownCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (toolMode !== "scissors" || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      draggingRef.current = true
      cutRef.current = new Set()
      setTrail([localPoint(wrapperRef.current, event)])
      cutEdgesAtPoint(event)
    },
    [cutEdgesAtPoint, cutRef, draggingRef, setTrail, toolMode, wrapperRef],
  )

  const onCanvasMouseMoveCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      event.preventDefault()
      event.stopPropagation()
      setTrail((trail) => {
        const next = [...trail, localPoint(wrapperRef.current, event)]
        return next.length > 80 ? next.slice(-80) : next
      })
      cutEdgesAtPoint(event)
    },
    [cutEdgesAtPoint, draggingRef, setTrail, wrapperRef],
  )

  const onCanvasMouseUpCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      event.preventDefault()
      event.stopPropagation()
      draggingRef.current = false
      cutRef.current = new Set()
      window.setTimeout(() => setTrail([]), 120)
    },
    [cutRef, draggingRef, setTrail],
  )

  return { onCanvasMouseDownCapture, onCanvasMouseMoveCapture, onCanvasMouseUpCapture }
}

export function useWorkflowNodeDragHandlers(options: {
  attachToParent: (nodeId: string, parentId: string) => void
  clearHelperLines: () => void
  detachFromParent: (nodeId: string) => void
  disconnectNodeConnections: (nodeId: string) => number
  getInternalNode: (nodeId: string) => { internals?: { positionAbsolute?: CanvasPoint } } | undefined
  resizeGroupToFit: (nodeId: string) => void
  resolveNodeCollisions: (nodeId: string) => void
  shakeRef: WritableRef<Map<string, ShakeState>>
  showToast: ShowToast
}) {
  const {
    attachToParent,
    clearHelperLines,
    detachFromParent,
    disconnectNodeConnections,
    getInternalNode,
    resizeGroupToFit,
    resolveNodeCollisions,
    shakeRef,
    showToast,
  } = options

  const onNodeDrag: OnNodeDrag<WorkflowNode> = useCallback(
    (_event, node) => {
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
      const next = { lastX: node.position.x, lastDirection: direction as -1 | 1, turns, disconnected: current.disconnected }
      if (!next.disconnected && turns >= 4) {
        const removed = disconnectNodeConnections(node.id)
        if (removed > 0) {
          next.disconnected = true
          showToast(`已断开 ${removed} 条连接`)
        }
      }
      shakeRef.current.set(node.id, next)
    },
    [disconnectNodeConnections, shakeRef, showToast],
  )

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      clearHelperLines()
      shakeRef.current.delete(node.id)
      if (node.type === "group") {
        resizeGroupToFit(node.id)
        return
      }

      const internal = getInternalNode(node.id)
      const abs = internal?.internals?.positionAbsolute ?? node.position
      const width = node.measured?.width ?? 240
      const height = node.measured?.height ?? 96
      const center = { x: abs.x + width / 2, y: abs.y + height / 2 }
      const workflowNode = node as WorkflowNode
      const targetGroup = useFlowStore.getState().nodes.find((candidate) => {
        if (candidate.type !== "group" || candidate.data.collapsed || candidate.id === node.id) return false
        const groupWidth = (candidate.width as number) ?? candidate.measured?.width ?? 320
        const groupHeight = (candidate.height as number) ?? candidate.measured?.height ?? 220
        return center.x >= candidate.position.x && center.x <= candidate.position.x + groupWidth && center.y >= candidate.position.y && center.y <= candidate.position.y + groupHeight
      })

      if (targetGroup && workflowNode.parentId !== targetGroup.id) attachToParent(node.id, targetGroup.id)
      else if (!targetGroup && workflowNode.parentId) detachFromParent(node.id)
      else if (targetGroup && workflowNode.parentId === targetGroup.id) resizeGroupToFit(targetGroup.id)
      resolveNodeCollisions(node.id)
    },
    [attachToParent, clearHelperLines, detachFromParent, getInternalNode, resizeGroupToFit, resolveNodeCollisions, shakeRef],
  )

  return { onNodeDrag, onNodeDragStop }
}

export function useConnectionGuards(options: {
  settings: Pick<CanvasSettings, "confirmDelete" | "maxSourceConnections" | "maxTargetConnections" | "preventCycles" | "typedHandles">
  showToast: ShowToast
}) {
  const { settings, showToast } = options
  const isValidConnection: IsValidConnection<WorkflowEdge> = useCallback(
    (connection) => {
      const res = validateConnection(useFlowStore.getState().edges, {
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      }, {
        preventCycles: settings.preventCycles,
        maxSourceConnections: settings.maxSourceConnections,
        maxTargetConnections: settings.maxTargetConnections,
        typedHandles: settings.typedHandles,
        nodes: useFlowStore.getState().nodes,
      })
      if (res.ok) return true
      showToast(res.reason)
      return false
    },
    [settings.maxSourceConnections, settings.maxTargetConnections, settings.preventCycles, settings.typedHandles, showToast],
  )

  const onBeforeDelete: OnBeforeDelete<WorkflowNode, WorkflowEdge> = useCallback(
    async ({ nodes, edges }) => {
      if (!settings.confirmDelete) return { nodes, edges }
      const count = nodes.length + edges.length
      if (count === 0) return false
      return window.confirm(`确认删除 ${nodes.length} 个节点 / ${edges.length} 条连线？`) ? { nodes, edges } : false
    },
    [settings.confirmDelete],
  )

  return { isValidConnection, onBeforeDelete }
}

export function useCanvasViewportCompaction(options: {
  compactViewport: boolean
  nodes: WorkflowNode[]
  setViewport: (viewport: { x: number; y: number; zoom: number }, options?: { duration?: number }) => void
}) {
  const { compactViewport, nodes, setViewport } = options
  const applyCompactViewport = useCallback(() => {
    if (!compactViewport || nodes.length === 0) return undefined
    const leftMost = Math.min(...nodes.map((node) => node.position.x))
    const topMost = Math.min(...nodes.map((node) => node.position.y))
    const zoom = 0.62
    return window.setTimeout(() => {
      setViewport({ x: 18 - leftMost * zoom, y: 220 - topMost * zoom, zoom }, { duration: 0 })
    }, 120)
  }, [compactViewport, nodes, setViewport])
  return applyCompactViewport
}
