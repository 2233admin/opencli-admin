"use client"

import { memo } from "react"
import { NodeResizer, type NodeProps } from "@xyflow/react"
import { StickyNote } from "lucide-react"
import type { WorkflowNode as WorkflowNodeType } from "@/lib/flow/types"
import { cn } from "@/lib/utils"

function NoteNodeComponent({ data, selected }: NodeProps<WorkflowNodeType>) {
  return (
    <div
      className={cn(
        "h-full min-h-[90px] w-full min-w-[160px] rounded-md border border-dashed bg-card/60 p-3 transition-colors",
        selected ? "border-foreground/50" : "border-border",
      )}
    >
      <NodeResizer isVisible={selected} minWidth={160} minHeight={90} lineClassName="!border-ring" handleClassName="!bg-ring !size-2 !rounded-sm" />
      <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
        <StickyNote className="size-3" />
        <span className="font-mono text-[9px] uppercase tracking-[0.12em]">Annotation</span>
      </div>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
        {data.description || "在右侧面板编辑备注内容"}
      </p>
    </div>
  )
}

export default memo(NoteNodeComponent)
