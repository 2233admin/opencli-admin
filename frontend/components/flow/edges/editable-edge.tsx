"use client"

import { memo, useCallback, useRef } from "react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  type EdgeProps,
  type XYPosition,
} from "@xyflow/react"
import { X } from "lucide-react"
import { useFlowStore } from "@/lib/flow/store"
import type { WorkflowEdge } from "@/lib/flow/types"

/** Build a smooth catmull-rom-ish path through all points. */
function buildPath(points: XYPosition[]) {
  if (points.length < 2) return ""
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`
  }
  let d = `M ${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2]
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}

function EditableEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
}: EdgeProps<WorkflowEdge>) {
  const { screenToFlowPosition } = useReactFlow()
  const updateWaypoints = useFlowStore((s) => s.updateEdgeWaypoints)
  const takeSnapshot = useFlowStore((s) => s.takeSnapshot)
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const draggingRef = useRef<number | null>(null)

  const waypoints = data?.waypoints ?? []
  const points: XYPosition[] = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
  const path = buildPath(points)
  const labelPoint = points[Math.floor(points.length / 2)]
  const weight = typeof data?.weight === "number" ? Math.max(0, Math.min(1, data.weight)) : null
  const semantic = data?.semantic
  const semanticLabel = semantic?.relationship ?? data?.label
  const confidence = typeof semantic?.confidence === "number" ? Math.round(Math.max(0, Math.min(1, semantic.confidence)) * 100) : null
  const strokeWidth = selected ? 1.75 : weight ? 1.1 + weight * 2.6 : 1.25
  const stroke = selected ? "var(--foreground)" : semantic ? "#8bb6ff" : "#3a3d42"

  const onPointerDownWaypoint = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture(e.pointerId)
      draggingRef.current = index
      takeSnapshot()
    },
    [takeSnapshot],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current === null) return
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const next = waypoints.map((w, i) => (i === draggingRef.current ? flowPos : w))
      updateWaypoints(id, next)
    },
    [screenToFlowPosition, waypoints, updateWaypoints, id],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }, [])

  const addWaypoint = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      // insert new waypoint at nearest segment
      const all = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
      let bestIdx = 0
      let bestDist = Number.POSITIVE_INFINITY
      for (let i = 0; i < all.length - 1; i++) {
        const mid = { x: (all[i].x + all[i + 1].x) / 2, y: (all[i].y + all[i + 1].y) / 2 }
        const d = (mid.x - flowPos.x) ** 2 + (mid.y - flowPos.y) ** 2
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      const next = [...waypoints]
      next.splice(bestIdx, 0, flowPos)
      takeSnapshot()
      updateWaypoints(id, next)
    },
    [screenToFlowPosition, waypoints, sourceX, sourceY, targetX, targetY, id, updateWaypoints, takeSnapshot],
  )

  const removeWaypoint = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.stopPropagation()
      takeSnapshot()
      updateWaypoints(
        id,
        waypoints.filter((_, i) => i !== index),
      )
    },
    [waypoints, id, updateWaypoints, takeSnapshot],
  )

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
        style={{
          strokeWidth,
          stroke,
          strokeDasharray: data?.proposalState === "proposed" ? "5 4" : undefined,
        }}
      />
      {/* invisible wide hit area for double-click to add waypoint */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="nodrag nopan pointer-events-auto cursor-copy"
        onDoubleClick={addWaypoint}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <EdgeLabelRenderer>
        {selected
          ? waypoints.map((w, i) => (
              <div
                key={i}
                className="nodrag nopan pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-ring bg-background shadow active:cursor-grabbing"
                style={{ transform: `translate(-50%, -50%) translate(${w.x}px, ${w.y}px)` }}
                onPointerDown={onPointerDownWaypoint(i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={removeWaypoint(i)}
                title="拖动调整 / 双击删除控制点"
              />
            ))
          : null}
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)` }}
        >
          {semanticLabel ? (
            <span className="rounded-sm border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {semanticLabel}
              {confidence !== null ? <span className="ml-1 text-[#a8d8ff]">{confidence}%</span> : null}
              {weight !== null ? <span className="ml-1 text-[#ffb86b]">w{Math.round(weight * 100)}</span> : null}
            </span>
          ) : null}
          {data?.contractId ? (
            <span className="hidden rounded-sm border border-[#4ade80]/40 bg-background px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[#4ade80] md:inline-flex">
              contract
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

export default memo(EditableEdgeComponent)
