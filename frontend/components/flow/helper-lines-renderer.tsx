"use client"

import { useEffect, useRef } from "react"
import { useStore, type ReactFlowState } from "@xyflow/react"
import type { HelperLines } from "@/lib/flow/helper-lines"

const selector = (state: ReactFlowState) => ({
  width: state.width,
  height: state.height,
  transform: state.transform,
})

export function HelperLinesRenderer({ lines }: { lines: HelperLines }) {
  const { width, height, transform } = useStore(selector)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tx, ty, scale] = transform

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const dpi = window.devicePixelRatio || 1
    canvas.width = width * dpi
    canvas.height = height * dpi
    ctx.scale(dpi, dpi)
    ctx.clearRect(0, 0, width, height)

    const style = getComputedStyle(document.documentElement)
    ctx.strokeStyle = style.getPropertyValue("--ring").trim() || "#3b82f6"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])

    if (lines.vertical !== undefined) {
      const x = lines.vertical * scale + tx
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    if (lines.horizontal !== undefined) {
      const y = lines.horizontal * scale + ty
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
  }, [width, height, transform, lines, tx, ty, scale])

  const interactionTargets = lines.interaction?.targets ?? []

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute left-0 top-0 z-10"
        style={{ width, height }}
      />
      {interactionTargets.length > 0 ? (
        <svg className="pointer-events-none absolute left-0 top-0 z-20" style={{ width, height }}>
          {interactionTargets.map((target) => (
            <rect
              key={target.id}
              className="workflow-proximity-ring"
              data-state={target.state}
              data-target-id={target.id}
              x={target.rect.x * scale + tx - 6}
              y={target.rect.y * scale + ty - 6}
              width={target.rect.width * scale + 12}
              height={target.rect.height * scale + 12}
              rx={6}
              ry={6}
            />
          ))}
        </svg>
      ) : null}
    </>
  )
}
