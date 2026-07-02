// Component-library workbench: register the atomic nodes, then hand them to the
// reusable NodeWorkbench (Touch Bar + canvas) to browse, add, and wire into
// functions. This is the home of "manage atomic nodes" the kit provides.
import { NodeWorkbench, registerNodes, registerSavedMacros, ALL_NODES } from '../../node-kit'

// register the atomic node library (idempotent — registry is a module Map), then
// the persisted macros so NodeWorkbench's useMemo([]) nodeTypes/palette snapshot
// includes them at first mount.
registerNodes(ALL_NODES)
registerSavedMacros()

export default function NodeKitPage() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border border-amber-400/25 bg-amber-400/5 px-3 py-2 font-code text-[11px] text-zinc-400">
        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
          组件库 demo · 非产品页面
        </span>
        <span className="text-zinc-100">节点工作台</span>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500">
          {ALL_NODES.length} 原子节点 · React Flow + 自研 Runtime
        </span>
        <span className="text-[10px] text-zinc-600">
          仅供浏览 node-kit 原子组件；采集编排请用「采集画布」— 已移出产品导航，仅可通过 URL 访问
        </span>
      </div>
      <div className="h-[78vh] min-h-[560px]">
        <NodeWorkbench />
      </div>
    </div>
  )
}
