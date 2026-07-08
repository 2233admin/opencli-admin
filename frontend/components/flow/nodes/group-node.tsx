"use client"

import { memo } from "react"
import { NodeResizer, type NodeProps } from "@xyflow/react"
import { ChevronDown, ChevronRight, Group } from "lucide-react"
import type { WorkflowNode as WorkflowNodeType } from "@/lib/flow/types"
import { useFlowStore } from "@/lib/flow/store"
import { cn } from "@/lib/utils"

function GroupNodeComponent({ id, data, selected }: NodeProps<WorkflowNodeType>) {
  const toggle = useFlowStore((s) => s.toggleGroupCollapse)
  const collapsed = data.collapsed

  return (
    <div
      className={cn(
        "h-full w-full rounded-md border border-dashed bg-foreground/[0.02] transition-colors",
        selected ? "border-foreground/50 ring-1 ring-foreground/20" : "border-[#3a3d42]",
      )}
    >
      {!collapsed ? (
        <NodeResizer
          isVisible={selected}
          minWidth={220}
          minHeight={140}
          lineClassName="!border-ring"
          handleClassName="!bg-ring !size-2 !rounded-sm"
        />
      ) : null}
      <div className="flex items-center gap-2 rounded-t-md border-b border-dashed border-[#3a3d42] bg-card/80 px-3 py-1.5">
        <button
          type="button"
          onClick={() => toggle(id)}
          className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "展开分组" : "折叠分组"}
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <Group className="size-3 text-muted-foreground" />
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Frame</span>
        <span className="truncate text-xs font-medium">{data.label}</span>
      </div>
    </div>
  )
}

export default memo(GroupNodeComponent)
