import type { MouseEvent as ReactMouseEvent } from "react"

export type CanvasPoint = { x: number; y: number }

function distance(a: CanvasPoint, b: CanvasPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function edgeIdsAtScreenPoint(point: CanvasPoint, threshold = 10): string[] {
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

export function localPoint(element: HTMLElement | null, event: ReactMouseEvent): CanvasPoint {
  const rect = element?.getBoundingClientRect()
  if (!rect) return { x: event.clientX, y: event.clientY }
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
