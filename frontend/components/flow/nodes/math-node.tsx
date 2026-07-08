"use client"

// "Computing Flows" example — reactive numeric nodes.
// Each node writes its own numeric output into node.data.value; consumers
// read upstream connections via useHandleConnections + useNodesData.

import { memo, useEffect } from "react"
import {
  Handle,
  Position,
  useHandleConnections,
  useNodesData,
  useReactFlow,
  type NodeProps,
  type Node,
} from "@xyflow/react"
import { cn } from "@/lib/utils"

type Op = "add" | "sub" | "mul" | "div"

export interface MathNodeData extends Record<string, unknown> {
  kind: "input" | "op" | "output"
  op?: Op
  value?: number
  handleType?: "number"
}

type MathNode = Node<MathNodeData>

const handleCls =
  "!size-2 !rounded-[2px] !border !border-background !bg-[#3a3d42] transition-colors hover:!bg-foreground"

function InputNode({ id, data, selected }: NodeProps<MathNode>) {
  const { updateNodeData } = useReactFlow()
  return (
    <div
      className={cn(
        "w-[160px] rounded-md border bg-card px-3 py-2 text-card-foreground",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        DATA::INPUT
      </div>
      <input
        type="number"
        className="mt-1 w-full rounded-sm border border-border bg-background px-2 py-1 font-mono text-xs"
        value={String(data.value ?? 0)}
        onChange={(e) => updateNodeData(id, { value: Number(e.target.value) })}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={handleCls}
        style={{ top: "50%" }}
      />
    </div>
  )
}

const OP_LABEL: Record<Op, string> = { add: "+", sub: "−", mul: "×", div: "÷" }

function OpNode({ id, data, selected }: NodeProps<MathNode>) {
  const { updateNodeData } = useReactFlow()
  const aConnections = useHandleConnections({ type: "target", id: "a" })
  const bConnections = useHandleConnections({ type: "target", id: "b" })
  const aData = useNodesData<MathNode>(aConnections.map((c) => c.source))
  const bData = useNodesData<MathNode>(bConnections.map((c) => c.source))
  const a = aData[0]?.data.value ?? 0
  const b = bData[0]?.data.value ?? 0
  const op: Op = data.op ?? "add"
  const value = op === "add" ? a + b : op === "sub" ? a - b : op === "mul" ? a * b : b === 0 ? 0 : a / b

  useEffect(() => {
    if (data.value !== value) updateNodeData(id, { value })
  }, [id, value, data.value, updateNodeData])

  return (
    <div
      className={cn(
        "relative w-[180px] rounded-md border bg-card px-3 py-2 text-card-foreground",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        LOGIC::MATH
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono text-xs">
        <span>{a}</span>
        <select
          value={op}
          onChange={(e) => updateNodeData(id, { op: e.target.value as Op })}
          className="rounded-sm border border-border bg-background px-1 py-0.5"
        >
          {(Object.keys(OP_LABEL) as Op[]).map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </select>
        <span>{b}</span>
        <span className="ml-auto text-foreground">= {value}</span>
      </div>
      <Handle
        type="target"
        id="a"
        position={Position.Left}
        className={handleCls}
        style={{ top: "35%" }}
      />
      <Handle
        type="target"
        id="b"
        position={Position.Left}
        className={handleCls}
        style={{ top: "65%" }}
      />
      <Handle type="source" position={Position.Right} className={handleCls} style={{ top: "50%" }} />
    </div>
  )
}

function OutputNode({ data, selected }: NodeProps<MathNode>) {
  const conns = useHandleConnections({ type: "target" })
  const upstream = useNodesData<MathNode>(conns.map((c) => c.source))
  const value = upstream[0]?.data.value ?? data.value ?? 0
  return (
    <div
      className={cn(
        "w-[140px] rounded-md border bg-card px-3 py-2 text-card-foreground",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        DATA::OUTPUT
      </div>
      <div className="mt-1 font-mono text-lg font-medium">{value}</div>
      <Handle type="target" position={Position.Left} className={handleCls} style={{ top: "50%" }} />
    </div>
  )
}

function MathNodeComponent(props: NodeProps<MathNode>) {
  const kind = props.data.kind
  if (kind === "input") return <InputNode {...props} />
  if (kind === "output") return <OutputNode {...props} />
  return <OpNode {...props} />
}

export default memo(MathNodeComponent)
