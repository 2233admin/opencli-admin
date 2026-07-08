"use client"

import { memo } from "react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react"
import { Plus, X } from "lucide-react"
import { useFlowStore } from "@/lib/flow/store"
import type { WorkflowEdge } from "@/lib/flow/types"

function WorkflowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  selected,
  markerEnd,
}: EdgeProps<WorkflowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const takeSnapshot = useFlowStore((s) => s.takeSnapshot)
  const insertNodeOnEdge = useFlowStore((s) => s.insertNodeOnEdge)
  const weight = typeof data?.weight === "number" ? Math.max(0, Math.min(1, data.weight)) : null
  const semantic = data?.semantic
  const semanticLabel = semantic?.relationship ?? (typeof data?.label === "string" ? data.label : undefined)
  const confidence = typeof semantic?.confidence === "number" ? Math.round(Math.max(0, Math.min(1, semantic.confidence)) * 100) : null
  const edgeLabel = semanticLabel ?? label
  const strokeWidth = selected ? 1.75 : weight ? 1.1 + weight * 2.6 : 1.25
  const stroke = selected ? "var(--foreground)" : semantic ? "#8bb6ff" : "#3a3d42"

  const removeEdge = () => {
    takeSnapshot()
    onEdgesChange([{ id, type: "remove" }])
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className="workflow-edge-path"
        data-selected={selected ? "true" : "false"}
        style={{
          strokeWidth,
          stroke,
          strokeDasharray: data?.proposalState === "proposed" ? "5 4" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan group pointer-events-auto absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {edgeLabel ? (
            <span className="rounded-sm border bg-background px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {edgeLabel}
              {confidence !== null ? <span className="ml-1 text-[#a8d8ff]">{confidence}%</span> : null}
              {weight !== null ? <span className="ml-1 text-[#ffb86b]">w{Math.round(weight * 100)}</span> : null}
            </span>
          ) : null}
          {data?.contractId ? (
            <span className="hidden rounded-sm border border-[#4ade80]/40 bg-background px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[#4ade80] md:inline-flex">
              contract
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => insertNodeOnEdge(id)}
            className="flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-all hover:text-primary group-hover:opacity-100 data-[selected=true]:opacity-100"
            data-selected={selected}
            aria-label="在此插入节点"
          >
            <Plus className="size-2.5" />
          </button>
          <button
            type="button"
            onClick={removeEdge}
            className="flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100 data-[selected=true]:opacity-100"
            data-selected={selected}
            aria-label="删除连线"
          >
            <X className="size-2.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(WorkflowEdgeComponent)
