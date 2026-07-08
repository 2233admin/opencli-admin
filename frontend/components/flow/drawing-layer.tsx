"use client"

import { useCallback, useRef, useState } from "react"
import { useReactFlow, useStore } from "@xyflow/react"
import { getStroke } from "perfect-freehand"
import { nanoid } from "nanoid"
import { useFlowStore } from "@/lib/flow/store"

function strokeToPath(points: number[][], size: number): string {
  const outline = getStroke(points, {
    size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
  })
  if (!outline.length) return ""
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ["M", ...outline[0], "Q"] as (string | number)[],
  )
  d.push("Z")
  return d.join(" ")
}

export function DrawingLayer() {
  const drawings = useFlowStore((s) => s.drawings)
  const addStroke = useFlowStore((s) => s.addStroke)
  const takeSnapshot = useFlowStore((s) => s.takeSnapshot)
  const toolMode = useFlowStore((s) => s.toolMode)
  const penColor = useFlowStore((s) => s.penColor)
  const penSize = useFlowStore((s) => s.penSize)

  const transform = useStore((s) => s.transform)
  const { screenToFlowPosition } = useReactFlow()
  const [current, setCurrent] = useState<number[][]>([])
  const drawingRef = useRef(false)

  const isDrawMode = toolMode === "draw"

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawMode || e.button !== 0) return
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      drawingRef.current = true
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setCurrent([[p.x, p.y, e.pressure || 0.5]])
    },
    [isDrawMode, screenToFlowPosition],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setCurrent((prev) => [...prev, [p.x, p.y, e.pressure || 0.5]])
    },
    [screenToFlowPosition],
  )

  const onPointerUp = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (current.length > 1) {
      takeSnapshot()
      addStroke({ id: nanoid(8), points: current, color: penColor, size: penSize })
    }
    setCurrent([])
  }, [current, addStroke, takeSnapshot, penColor, penSize])

  const [tx, ty, zoom] = transform

  return (
    <div
      className="absolute inset-0"
      style={{ zIndex: 5, pointerEvents: isDrawMode ? "auto" : "none", cursor: isDrawMode ? "crosshair" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <g transform={`translate(${tx},${ty}) scale(${zoom})`}>
          {drawings.map((s) => (
            <path key={s.id} d={strokeToPath(s.points, s.size)} fill={s.color} />
          ))}
          {current.length > 1 ? <path d={strokeToPath(current, penSize)} fill={penColor} /> : null}
        </g>
      </svg>
    </div>
  )
}
