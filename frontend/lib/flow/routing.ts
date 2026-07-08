import type { XYPosition } from "@xyflow/react"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const GRID = 20
const PADDING = 16

/**
 * Orthogonal A* path finding that routes an edge around node obstacles.
 * A lightweight stand-in for the React Flow Pro "Edge Routing" (libavoid) example.
 */
export function routeOrthogonal(
  source: XYPosition,
  target: XYPosition,
  obstacles: Rect[],
): XYPosition[] {
  const minX = Math.min(source.x, target.x, ...obstacles.map((o) => o.x)) - 80
  const minY = Math.min(source.y, target.y, ...obstacles.map((o) => o.y)) - 80
  const maxX = Math.max(source.x, target.x, ...obstacles.map((o) => o.x + o.width)) + 80
  const maxY = Math.max(source.y, target.y, ...obstacles.map((o) => o.y + o.height)) + 80

  const cols = Math.ceil((maxX - minX) / GRID)
  const rows = Math.ceil((maxY - minY) / GRID)
  if (cols <= 0 || rows <= 0 || cols * rows > 40000) {
    return [source, target]
  }

  const toCell = (p: XYPosition) => ({
    c: Math.round((p.x - minX) / GRID),
    r: Math.round((p.y - minY) / GRID),
  })

  const blocked = (c: number, r: number) => {
    const x = minX + c * GRID
    const y = minY + r * GRID
    return obstacles.some(
      (o) =>
        x >= o.x - PADDING && x <= o.x + o.width + PADDING && y >= o.y - PADDING && y <= o.y + o.height + PADDING,
    )
  }

  const start = toCell(source)
  const goal = toCell(target)
  const key = (c: number, r: number) => r * cols + c

  const open = new Set<number>([key(start.c, start.r)])
  const came = new Map<number, number>()
  const g = new Map<number, number>([[key(start.c, start.r), 0]])
  const h = (c: number, r: number) => Math.abs(c - goal.c) + Math.abs(r - goal.r)
  const f = new Map<number, number>([[key(start.c, start.r), h(start.c, start.r)]])

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]

  let found = false
  let guard = 0
  while (open.size > 0 && guard++ < 20000) {
    let cur = -1
    let best = Number.POSITIVE_INFINITY
    for (const k of open) {
      const fv = f.get(k) ?? Number.POSITIVE_INFINITY
      if (fv < best) {
        best = fv
        cur = k
      }
    }
    if (cur === -1) break
    const cc = cur % cols
    const cr = Math.floor(cur / cols)
    if (cc === goal.c && cr === goal.r) {
      found = true
      break
    }
    open.delete(cur)

    for (const [dc, dr] of dirs) {
      const nc = cc + dc
      const nr = cr + dr
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      if (blocked(nc, nr) && !(nc === goal.c && nr === goal.r)) continue
      const nk = key(nc, nr)
      // penalize turns to prefer straight lines
      const prev = came.get(cur)
      let turnCost = 0
      if (prev !== undefined) {
        const pc = prev % cols
        const pr = Math.floor(prev / cols)
        const lastDir = [cc - pc, cr - pr]
        if (lastDir[0] !== dc || lastDir[1] !== dr) turnCost = 2
      }
      const tentative = (g.get(cur) ?? Number.POSITIVE_INFINITY) + 1 + turnCost
      if (tentative < (g.get(nk) ?? Number.POSITIVE_INFINITY)) {
        came.set(nk, cur)
        g.set(nk, tentative)
        f.set(nk, tentative + h(nc, nr))
        open.add(nk)
      }
    }
  }

  if (!found) return [source, target]

  // reconstruct
  const cells: number[] = []
  let cur = key(goal.c, goal.r)
  cells.push(cur)
  while (came.has(cur)) {
    cur = came.get(cur)!
    cells.push(cur)
  }
  cells.reverse()

  // simplify collinear points
  const pts = cells.map((k) => ({ x: minX + (k % cols) * GRID, y: minY + Math.floor(k / cols) * GRID }))
  const simplified: XYPosition[] = []
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || i === pts.length - 1) {
      simplified.push(pts[i])
      continue
    }
    const prev = pts[i - 1]
    const next = pts[i + 1]
    const collinear = (prev.x === pts[i].x && pts[i].x === next.x) || (prev.y === pts[i].y && pts[i].y === next.y)
    if (!collinear) simplified.push(pts[i])
  }

  simplified[0] = source
  simplified[simplified.length - 1] = target
  return simplified
}

export function pointsToPath(points: XYPosition[]): string {
  if (points.length < 2) return ""
  const r = 8
  let d = `M ${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const prev = points[i - 1]
    const next = points[i + 1]
    const v1 = { x: p.x - prev.x, y: p.y - prev.y }
    const v2 = { x: next.x - p.x, y: next.y - p.y }
    const l1 = Math.hypot(v1.x, v1.y) || 1
    const l2 = Math.hypot(v2.x, v2.y) || 1
    const rr = Math.min(r, l1 / 2, l2 / 2)
    const a = { x: p.x - (v1.x / l1) * rr, y: p.y - (v1.y / l1) * rr }
    const b = { x: p.x + (v2.x / l2) * rr, y: p.y + (v2.y / l2) * rr }
    d += ` L ${a.x},${a.y} Q ${p.x},${p.y} ${b.x},${b.y}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x},${last.y}`
  return d
}
