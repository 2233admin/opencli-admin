// Component-library workbench: register the atomic nodes, then hand them to the
// reusable NodeWorkbench (Touch Bar + canvas) to browse, add, and wire into
// functions. This is the home of "manage atomic nodes" the kit provides.
import { NodeWorkbench, registerNodes, ALL_NODES } from '../../node-kit'

// register the atomic node library (idempotent — registry is a module Map)
registerNodes(ALL_NODES)

export default function NodeKitPage() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border border-white/[0.08] bg-black/30 px-3 py-2 font-code text-[11px] text-zinc-400">
        <span className="text-zinc-100">组件库 · 节点工作台</span>
        <span className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] text-zinc-500">
          {ALL_NODES.length} 原子节点 · React Flow + 自研 Runtime
        </span>
        <span className="text-[10px] text-zinc-600">左侧拖入 / Tab 搜索 · 运行跑图</span>
      </div>
      <div className="h-[78vh] min-h-[560px]">
        <NodeWorkbench />
      </div>
    </div>
  )
}
