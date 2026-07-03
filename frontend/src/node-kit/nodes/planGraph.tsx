// Plan-graph generic node specs (Plan IR issue 07 — Collection Canvas edit
// lens). Source nodes reuse the existing per-channel `source.<channel_type>`
// specs (sources.tsx) once materialized; these four specs cover the cases
// sources.tsx doesn't: an unmaterialized draft with no channel_type chosen
// yet, and the kind-generic transform/merge/sink nodes issue 01's IR allows
// but no per-node-type catalog exists for yet (issue 01 scoped node `type`
// as free-form on purpose — a later issue owns a real catalog).
//
// Host contract (stamped into KitNode facts by PlanCanvasPage, mirroring the
// collection.* `__entityId`/`__badges` convention in collection.tsx):
//   facts.__draft: boolean       — true renders the "visibly unmaterialized" look
//   facts.__errors: string[]     — node-anchored validation messages (issue 07
//                                   acceptance criterion: 422 errors render on
//                                   the offending node)
import type { ReactNode } from 'react'

import { defineNode } from '../define'
import type { NodeRenderContext, NodeSpec } from '../spec'
import { NodeBadge, NodeField } from '../render/atoms'

function DraftBadge(): ReactNode {
  return (
    <NodeBadge tone="neutral">
      <span className="uppercase tracking-wide">draft · unmaterialized</span>
    </NodeBadge>
  )
}

function ErrorBadges(ctx: NodeRenderContext): ReactNode {
  const errors = Array.isArray(ctx.facts.__errors) ? (ctx.facts.__errors as string[]) : []
  if (errors.length === 0) return null
  return (
    <div className="grid gap-1">
      {errors.map((message, i) => (
        <NodeBadge key={i} tone="danger">
          {message}
        </NodeBadge>
      ))}
    </div>
  )
}

/** Shared body for every plan.* node: draft badge (when unmaterialized) +
 * validation-error badges (when the last save 422'd on this node), on top of
 * whatever the node's own fields render. */
function PlanNodeBody(ctx: NodeRenderContext, inner?: ReactNode): ReactNode {
  const draft = Boolean(ctx.facts.__draft)
  return (
    <div className="grid gap-1.5">
      {draft && <DraftBadge />}
      {inner}
      {ErrorBadges(ctx)}
    </div>
  )
}

// A Draft Source Node dropped before a channel type was chosen (bare palette
// drop, not a Preset) — issue 07 acceptance criterion "drag/click places a
// Draft Source Node visually distinct from materialized nodes". Once the
// operator picks a channel_type in the inspector the page re-types this node
// to `source.<channel_type>` (see PlanCanvasPage) so it starts rendering
// through that channel's real per-field body.
const sourceDraft = defineNode({
  type: 'plan.source-draft',
  category: 'source',
  title: '待定源',
  subtitle: 'draft',
  icon: 'circle-dashed',
  ports: { inputs: [], outputs: [{ id: 'out', label: '记录' }] },
  render: (ctx) => PlanNodeBody(ctx, <NodeField label="渠道" value="尚未选择" />),
})

const transform = defineNode({
  type: 'plan.transform',
  category: 'transform',
  title: '变换',
  subtitle: 'transform',
  icon: 'shuffle',
  ports: { inputs: [{ id: 'in', label: '输入' }], outputs: [{ id: 'out', label: '输出' }] },
  render: (ctx) => PlanNodeBody(ctx, <NodeField label="节点类型" value={ctx.id} />),
})

const merge = defineNode({
  type: 'plan.merge',
  category: 'transform',
  title: '合并',
  subtitle: 'merge',
  icon: 'git-merge',
  ports: {
    inputs: [
      { id: 'a', label: '输入 A' },
      { id: 'b', label: '输入 B' },
    ],
    outputs: [{ id: 'out', label: '输出' }],
  },
  render: (ctx) => PlanNodeBody(ctx),
})

const sink = defineNode({
  type: 'plan.sink',
  category: 'sink',
  title: '汇',
  subtitle: 'sink',
  icon: 'database',
  ports: { inputs: [{ id: 'in', label: '输入' }], outputs: [] },
  render: (ctx) => PlanNodeBody(ctx),
})

export const PLAN_GRAPH_NODES: NodeSpec<any>[] = [sourceDraft, transform, merge, sink]
