"use client"

import { memo, useMemo } from "react"
import { BaseEdge, EdgeLabelRenderer, useStore, type EdgeProps } from "@xyflow/react"
import { X } from "lucide-react"
import { useFlowStore } from "@/lib/flow/store"
import { routeOrthogonal, pointsToPath, type Rect } from "@/lib/flow/routing"
import type { WorkflowEdge } from "@/lib/flow/types"

function obstacleRectsEqual(left: Rect[], right: Rect[]) {
  if (left.length !== right.length) return false
  return left.every((rect, index) => {
    const other = right[index]
    return other !== undefined
      && rect.x === other.x
      && rect.y === other.y
      && rect.width === other.width
      && rect.height === other.height
  })
}

function RoutedEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
}: EdgeProps<WorkflowEdge>) {
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const takeSnapshot = useFlowStore((s) => s.takeSnapshot)

  // gather obstacle rects from all nodes except source/target
  const obstacles = useStore((s) => {
    const rects: Rect[] = []
    s.nodeLookup.forEach((n) => {
      if (n.id === source || n.id === target) return
      if (n.type === "group") return
      const w = n.measured?.width ?? 200
      const h = n.measured?.height ?? 90
      rects.push({ x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width: w, height: h })
    })
    return rects
  }, obstacleRectsEqual)

  const path = useMemo(() => {
    const pts = routeOrthogonal({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, obstacles)
    return pointsToPath(pts)
  }, [sourceX, sourceY, targetX, targetY, obstacles])

  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2

  const removeEdge = () => {
    takeSnapshot()
    onEdgesChange([{ id, type: "remove" }])
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className="workflow-edge-path"
        data-selected={selected ? "true" : "false"}
        data-draft={data?.internalOf ? "true" : "false"}
        style={{ strokeWidth: selected ? 1.5 : 1.25, stroke: selected ? "var(--foreground)" : "#3a3d42" }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)` }}
        >
          {data?.label ? (
            <span className="rounded-sm border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {data.label}
            </span>
          ) : null}
          {selected ? (
            <button
              type="button"
              onClick={removeEdge}
              className="flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-destructive"
              aria-label="删除连线"
            >
              <X className="size-2.5" />
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(RoutedEdgeComponent)
