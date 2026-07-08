import { nanoid } from "nanoid"
import { addEdge, applyEdgeChanges, applyNodeChanges } from "@xyflow/react"
import type { StoreApi } from "zustand"
import { applyHelperLines } from "./helper-lines"
import { useSettingsStore } from "./settings-store"
import { connectedComponentEdges, findConnectedComponentForNode } from "./graph-components"
import type { FlowState } from "./store"
import { HISTORY_LIMIT, snapshot } from "./store-utils"

type FlowSet = StoreApi<FlowState>["setState"]
type FlowGet = StoreApi<FlowState>["getState"]

export function createWhiteboardActions(
  set: FlowSet,
  get: FlowGet,
): Pick<FlowState, "setToolMode" | "setPenColor" | "setPenSize" | "addStroke" | "clearDrawings"> {
  return {
    setToolMode: (mode) => set({ toolMode: mode }),
    setPenColor: (color) => set({ penColor: color }),
    setPenSize: (size) => set({ penSize: size }),
    addStroke: (stroke) => set((state) => ({ drawings: [...state.drawings, stroke] })),
    clearDrawings: () => {
      get().takeSnapshot()
      set({ drawings: [] })
    },
  }
}

export function createCanvasChangeActions(
  set: FlowSet,
  get: FlowGet,
): Pick<FlowState, "onNodesChange" | "onEdgesChange" | "onConnect" | "setNodes" | "setSelectedIds" | "clearHelperLines"> {
  return {
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

    setNodes: (updater) => set((state) => ({ nodes: updater(state.nodes) })),
    setSelectedIds: (ids) => set({ selectedIds: ids }),
    clearHelperLines: () => set({ helperLines: { snapPosition: {} } }),
  }
}

export function createHistoryActions(
  set: FlowSet,
  get: FlowGet,
): Pick<FlowState, "takeSnapshot" | "undo" | "redo" | "canUndo" | "canRedo"> {
  return {
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
  }
}

export function createSelectionActions(
  set: FlowSet,
  get: FlowGet,
): Pick<
  FlowState,
  | "deleteSelected"
  | "disconnectSelectedConnections"
  | "disconnectNodeConnections"
  | "removeEdgesByIds"
  | "selectConnectedComponent"
  | "duplicateSelected"
  | "copy"
  | "cut"
  | "paste"
> {
  return {
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
      const clones = selected.map((n) => ({
        ...n,
        id: nanoid(8),
        selected: true,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        data: JSON.parse(JSON.stringify(n.data)),
      }))
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
  }
}

export function createEdgeActions(
  set: FlowSet,
  get: FlowGet,
): Pick<FlowState, "updateEdgeWaypoints" | "updateEdgeData" | "updateEdgeType" | "toggleEdgeAnimated"> {
  return {
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
  }
}
