import type { WorkflowNode } from "./types"

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

let currentFrame: number | null = null

/**
 * Smoothly tween node positions from their current values to the target layout.
 * Mirrors the React Flow Pro "Node Position Animation" (useAnimatedNodes) example.
 */
export function animateNodes(
  from: WorkflowNode[],
  to: WorkflowNode[],
  onFrame: (nodes: WorkflowNode[]) => void,
  duration = 400,
) {
  if (currentFrame !== null) cancelAnimationFrame(currentFrame)

  const targetMap = new Map(to.map((n) => [n.id, n]))
  const start = performance.now()

  const tick = (now: number) => {
    const elapsed = now - start
    const t = Math.min(1, elapsed / duration)
    const eased = easeInOutCubic(t)

    const frame = from.map((node) => {
      const target = targetMap.get(node.id)
      if (!target) return node
      return {
        ...target,
        position: {
          x: node.position.x + (target.position.x - node.position.x) * eased,
          y: node.position.y + (target.position.y - node.position.y) * eased,
        },
      }
    })

    onFrame(frame)

    if (t < 1) {
      currentFrame = requestAnimationFrame(tick)
    } else {
      currentFrame = null
      onFrame(to)
    }
  }

  currentFrame = requestAnimationFrame(tick)
}
