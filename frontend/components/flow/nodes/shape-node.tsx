"use client"

import { memo } from "react"
import { Handle, NodeResizer, Position, useStore, type NodeProps } from "@xyflow/react"
import { shallow } from "zustand/shallow"
import type { WorkflowNode as WorkflowNodeType } from "@/lib/flow/types"
import type { ShapeKind } from "@/lib/flow/types"
import { cn } from "@/lib/utils"

function ShapePath({ shape, w, h, color }: { shape: ShapeKind; w: number; h: number; color: string }) {
  const stroke = color
  const fill = `color-mix(in oklab, ${color} 14%, var(--card))`
  const common = { fill, stroke, strokeWidth: 1.25, vectorEffect: "non-scaling-stroke" as const }

  switch (shape) {
    case "circle":
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 2} ry={h / 2 - 2} {...common} />
    case "round":
      return <rect x={2} y={2} width={w - 4} height={h - 4} rx={Math.min(w, h) / 4} {...common} />
    case "diamond":
      return <polygon points={`${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`} {...common} />
    case "hexagon": {
      const q = w * 0.25
      return (
        <polygon
          points={`${q},2 ${w - q},2 ${w - 2},${h / 2} ${w - q},${h - 2} ${q},${h - 2} 2,${h / 2}`}
          {...common}
        />
      )
    }
    case "parallelogram": {
      const s = w * 0.2
      return <polygon points={`${s},2 ${w - 2},2 ${w - s},${h - 2} 2,${h - 2}`} {...common} />
    }
    case "cylinder": {
      const ry = h * 0.14
      return (
        <g {...common}>
          <path d={`M2,${ry} A${w / 2 - 2},${ry} 0 0 1 ${w - 2},${ry} L${w - 2},${h - ry} A${w / 2 - 2},${ry} 0 0 1 2,${h - ry} Z`} />
          <path d={`M2,${ry} A${w / 2 - 2},${ry} 0 0 0 ${w - 2},${ry}`} fill="none" />
        </g>
      )
    }
    default:
      return <rect x={2} y={2} width={w - 4} height={h - 4} {...common} />
  }
}

function ShapeNodeComponent({ id, data, selected }: NodeProps<WorkflowNodeType>) {
  const dims = useStore((s) => {
    const n = s.nodeLookup.get(id)
    return { w: n?.measured?.width ?? 140, h: n?.measured?.height ?? 100 }
  }, shallow)
  const shape = (data.shape ?? "rectangle") as ShapeKind
  // engineered monochrome: hairline stroke, white when selected
  const color = selected ? "var(--foreground)" : "#3a3d42"

  return (
    <div className="relative h-full w-full min-h-[60px] min-w-[80px]">
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={60}
        keepAspectRatio={shape === "circle"}
        lineClassName="!border-ring"
        handleClassName="!bg-ring !size-2 !rounded-sm"
      />
      <svg width="100%" height="100%" className="absolute inset-0 overflow-visible" preserveAspectRatio="none">
        <ShapePath shape={shape} w={dims.w} h={dims.h} color={color} />
      </svg>
      <div className={cn("relative flex h-full w-full items-center justify-center px-3 text-center", selected && "")}>
        <span className="text-xs font-medium text-foreground">{data.label}</span>
      </div>
      <Handle type="target" position={Position.Top} className="!size-2 !border-2 !border-background" style={{ background: color }} />
      <Handle type="source" position={Position.Bottom} className="!size-2 !border-2 !border-background" style={{ background: color }} />
      <Handle type="target" position={Position.Left} id="l" className="!size-2 !border-2 !border-background" style={{ background: color }} />
      <Handle type="source" position={Position.Right} id="r" className="!size-2 !border-2 !border-background" style={{ background: color }} />
    </div>
  )
}

export default memo(ShapeNodeComponent)
