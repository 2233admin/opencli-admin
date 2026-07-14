import { nanoid } from "nanoid"
import type { StoreApi } from "zustand"
import { animateNodes } from "./animate"
import { nodeRect, resolveCollisions } from "./collision"
import { getLayoutedElements } from "./layout"
import type { FlowState } from "./store"
import { syncCanonicalNetworkNodePositions } from "./store-canonical-actions"
import type { WorkflowNode } from "./types"
import { parseWorkflowProject } from "../workflow/schema"

type FlowSet = StoreApi<FlowState>["setState"]
type FlowGet = StoreApi<FlowState>["getState"]

function withoutParent(node: WorkflowNode): WorkflowNode {
  const next = { ...node }
  delete next.parentId
  delete next.extent
  return next
}

export function createLayoutActions(
  set: FlowSet,
  get: FlowGet,
): Pick<
  FlowState,
  | "autoLayout"
  | "toggleGroupCollapse"
  | "groupSelection"
  | "ungroupSelection"
  | "attachToParent"
  | "detachFromParent"
  | "addChildNode"
  | "insertNodeOnEdge"
  | "resolveNodeCollisions"
  | "resizeGroupToFit"
> {
  return {
    autoLayout: async (direction, engine = "elk", animated = true) => {
      get().takeSnapshot()
      const state = get()
      const current = state.nodes
      const { nodes } = await getLayoutedElements(current, state.edges, direction, engine)
      const parentNetwork = state.networkStack.at(-1)
      const scopeId = parentNetwork?.nodeId ?? null
      const canonicalNodes = nodes.filter(
        (node) => scopeId !== null || typeof node.data.internalOf !== "string",
      )
      const workflowProject = parseWorkflowProject(
        syncCanonicalNetworkNodePositions(state.workflowProject, scopeId, canonicalNodes),
      )
      if (!animated || typeof window === "undefined") {
        set({ workflowProject, nodes })
        return
      }
      set({ workflowProject })
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

      const pad = 40
      const minX = Math.min(...selected.map((n) => n.position.x))
      const minY = Math.min(...selected.map((n) => n.position.y))
      const maxX = Math.max(...selected.map((n) => n.position.x + ((n.measured?.width ?? (n.width as number)) ?? 220)))
      const maxY = Math.max(...selected.map((n) => n.position.y + ((n.measured?.height ?? (n.height as number)) ?? 90)))

      const groupId = `group-${nanoid(6)}`
      const width = maxX - minX + pad * 2
      const height = maxY - minY + pad * 2
      const groupNode: WorkflowNode = {
        id: groupId,
        type: "group",
        position: { x: minX - pad, y: minY - pad },
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
          position: { x: n.position.x - (minX - pad), y: n.position.y - (minY - pad) },
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
            const rest = withoutParent(n)
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
          const rest = withoutParent(n)
          return { ...rest, position: { x: n.position.x + parent.position.x, y: n.position.y + parent.position.y } }
        }),
      })
    },

    // A React Flow parent/child is only a visual grouping primitive. It must not
    // masquerade as a canonical L2-L4 workflow network.
    addChildNode: () => {},

    // Inserting a canvas-only node would create an unsaved graph alongside the
    // canonical workflow. Re-enable only with a canonical node kind selected.
    insertNodeOnEdge: () => {},

    resolveNodeCollisions: (movedId) => {
      set((state) => ({ nodes: resolveCollisions(state.nodes, movedId) }))
    },

    resizeGroupToFit: (groupId) => {
      const { nodes } = get()
      const group = nodes.find((n) => n.id === groupId && n.type === "group")
      if (!group || group.data.collapsed) return
      const children = nodes.filter((n) => n.parentId === groupId && !n.hidden)
      if (children.length === 0) return

      const pad = 32
      const header = 44
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const child of children) {
        const rect = nodeRect(child)
        minX = Math.min(minX, rect.x)
        minY = Math.min(minY, rect.y)
        maxX = Math.max(maxX, rect.x + rect.width)
        maxY = Math.max(maxY, rect.y + rect.height)
      }

      const shiftX = Math.max(0, pad - minX)
      const shiftY = Math.max(0, header + pad - minY)
      const width = Math.max((group.width as number) ?? 320, maxX + shiftX + pad)
      const height = Math.max((group.height as number) ?? 220, maxY + shiftY + pad)

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
  }
}
