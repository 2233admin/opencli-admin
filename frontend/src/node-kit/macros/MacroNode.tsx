// Collapsed macro body. Rendered by <KitNode> via spec.render() — header,
// ports, subtitle ('N 节点') are drawn by KitNode/the spec; this only fills the
// body: a few child-type chips + a "double-click to expand" hint. Composes from
// the shared atoms (NodeBadge). No ctx.emit (it is a no-op at KitNode.tsx:32);
// expand is driven from the workbench layer, not the node body.
import { getNode } from '../registry'
import { NodeBadge } from '../render/atoms'
import type { MacroDef } from './macro'

const MAX_CHIPS = 4

export function MacroBody({ def }: { def: MacroDef }) {
  // Distinct child node titles, in first-seen order.
  const titles: string[] = []
  for (const n of def.subgraph.nodes) {
    const t = getNode(String(n.type))?.title ?? String(n.type)
    if (!titles.includes(t)) titles.push(t)
  }
  const shown = titles.slice(0, MAX_CHIPS)
  const overflow = titles.length - shown.length

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <NodeBadge key={t}>{t}</NodeBadge>
        ))}
        {overflow > 0 && <NodeBadge tone="accent">+{overflow}</NodeBadge>}
      </div>
      <div className="text-3xs text-zinc-600">双击展开</div>
    </div>
  )
}
