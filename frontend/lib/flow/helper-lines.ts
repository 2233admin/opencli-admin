import type { NodeChange, NodePositionChange, XYPosition } from "@xyflow/react"
import type { WorkflowNode } from "./types"

export type HelperLines = {
  horizontal?: number
  vertical?: number
  snapPosition: Partial<XYPosition>
  interaction?: NodeInteractionProbe
}

export type NodeInteractionProbe = {
  draggedId: string
  targets: Array<{
    id: string
    state: "near" | "overlap"
    rect: Rect
    distance: number
  }>
}

type Rect = { x: number; y: number; width: number; height: number }

function nodeRect(node: WorkflowNode): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? (node.width as number) ?? 220,
    height: node.measured?.height ?? (node.height as number) ?? 90,
  }
}

function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  )
}

function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0)
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0)
  return Math.hypot(dx, dy)
}

export function getNodeInteractionProbe(
  change: NodePositionChange,
  nodes: WorkflowNode[],
  nearDistance = 44,
): NodeInteractionProbe | undefined {
  const nodeA = nodes.find((n) => n.id === change.id)
  if (!nodeA || !change.position) return undefined

  const a: Rect = {
    ...nodeRect(nodeA),
    x: change.position.x,
    y: change.position.y,
  }

  const targets = nodes
    .filter((nodeB) => nodeB.id !== nodeA.id && nodeB.parentId === nodeA.parentId)
    .map((nodeB) => {
      const rect = nodeRect(nodeB)
      const overlap = rectsOverlap(a, rect, 0)
      const distance = overlap ? 0 : rectDistance(a, rect)
      return {
        id: nodeB.id,
        state: overlap ? ("overlap" as const) : ("near" as const),
        rect,
        distance,
      }
    })
    .filter((target) => target.state === "overlap" || target.distance <= nearDistance)
    .sort((aTarget, bTarget) => aTarget.distance - bTarget.distance)
    .slice(0, 6)

  return targets.length > 0 ? { draggedId: nodeA.id, targets } : undefined
}

/**
 * Computes alignment helper lines between the dragged node and all other nodes.
 * Returns the snapped position when the node is close enough to an edge/center.
 */
export function getHelperLines(
  change: NodePositionChange,
  nodes: WorkflowNode[],
  distance = 6,
): HelperLines {
  const nodeA = nodes.find((n) => n.id === change.id)

  if (!nodeA || !change.position) {
    return { snapPosition: { x: undefined, y: undefined } }
  }

  const a: Rect = {
    ...nodeRect(nodeA),
    x: change.position.x,
    y: change.position.y,
  }

  const aBounds = {
    left: a.x,
    right: a.x + a.width,
    top: a.y,
    bottom: a.y + a.height,
    centerX: a.x + a.width / 2,
    centerY: a.y + a.height / 2,
  }

  let horizontalDistance = distance
  let verticalDistance = distance

  const result: HelperLines = {
    horizontal: undefined,
    vertical: undefined,
    snapPosition: { x: undefined, y: undefined },
  }

  for (const nodeB of nodes) {
    if (nodeB.id === nodeA.id || nodeB.parentId !== nodeA.parentId) continue

    const b = nodeRect(nodeB)
    const bBounds = {
      left: b.x,
      right: b.x + b.width,
      top: b.y,
      bottom: b.y + b.height,
      centerX: b.x + b.width / 2,
      centerY: b.y + b.height / 2,
    }

    // vertical alignments (x axis)
    const vChecks: Array<[number, number, number]> = [
      [Math.abs(aBounds.left - bBounds.left), bBounds.left, bBounds.left],
      [Math.abs(aBounds.right - bBounds.right), bBounds.right - a.width, bBounds.right],
      [Math.abs(aBounds.left - bBounds.right), bBounds.right, bBounds.right],
      [Math.abs(aBounds.right - bBounds.left), bBounds.left - a.width, bBounds.left],
      [Math.abs(aBounds.centerX - bBounds.centerX), bBounds.centerX - a.width / 2, bBounds.centerX],
    ]

    for (const [dist, snapX, line] of vChecks) {
      if (dist < verticalDistance) {
        result.snapPosition.x = snapX
        result.vertical = line
        verticalDistance = dist
      }
    }

    // horizontal alignments (y axis)
    const hChecks: Array<[number, number, number]> = [
      [Math.abs(aBounds.top - bBounds.top), bBounds.top, bBounds.top],
      [Math.abs(aBounds.bottom - bBounds.bottom), bBounds.bottom - a.height, bBounds.bottom],
      [Math.abs(aBounds.top - bBounds.bottom), bBounds.bottom, bBounds.bottom],
      [Math.abs(aBounds.bottom - bBounds.top), bBounds.top - a.height, bBounds.top],
      [Math.abs(aBounds.centerY - bBounds.centerY), bBounds.centerY - a.height / 2, bBounds.centerY],
    ]

    for (const [dist, snapY, line] of hChecks) {
      if (dist < horizontalDistance) {
        result.snapPosition.y = snapY
        result.horizontal = line
        horizontalDistance = dist
      }
    }
  }

  return result
}

export function applyHelperLines(
  changes: NodeChange<WorkflowNode>[],
  nodes: WorkflowNode[],
  enabled = true,
): { changes: NodeChange<WorkflowNode>[]; helperLines: HelperLines } {
  let helperLines: HelperLines = { snapPosition: {} }

  const positionChange = changes.find(
    (c): c is NodePositionChange => c.type === "position" && c.dragging === true && !!c.position,
  )

  if (!positionChange) {
    return { changes, helperLines }
  }

  const interaction = getNodeInteractionProbe(positionChange, nodes)

  if (!enabled) {
    return { changes, helperLines: { ...helperLines, interaction } }
  }

  helperLines = { ...getHelperLines(positionChange, nodes), interaction }

  const nextChanges = changes.map((c) => {
    if (c.type === "position" && c.id === positionChange.id && c.position) {
      return {
        ...c,
        position: {
          x: helperLines.snapPosition.x ?? c.position.x,
          y: helperLines.snapPosition.y ?? c.position.y,
        },
      }
    }
    return c
  })

  return { changes: nextChanges, helperLines }
}
