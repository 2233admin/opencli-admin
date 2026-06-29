// First batch of L3 atomic node types — the smallest reusable, cross-system
// node primitives. Pure specs (config + ports + reserved run); rendered for free
// by KitNode. Register with registerNodes(PRIMITIVE_NODES).
import { defineNode } from '../define'
import type { NodeSpec } from '../spec'

const value = defineNode({
  type: 'value',
  category: 'source',
  title: '常量',
  subtitle: 'value',
  icon: 'hash',
  ports: { inputs: [], outputs: [{ id: 'out' }] },
  config: { fields: [{ key: 'value', type: 'json', label: '值', default: 0 }] },
  run: async (ctx) => ({ out: ctx.config.value }),
})

const filter = defineNode({
  type: 'transform.filter',
  category: 'transform',
  title: '过滤',
  subtitle: 'filter',
  icon: 'filter',
  ports: { inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] },
  config: {
    fields: [
      { key: 'path', type: 'string', label: '字段', placeholder: 'status', required: true },
      { key: 'equals', type: 'string', label: '等于', placeholder: 'active' },
    ],
  },
  run: async (ctx) => {
    const arr = Array.isArray(ctx.inputs.in) ? (ctx.inputs.in as Record<string, unknown>[]) : []
    const path = String(ctx.config.path)
    const eq = ctx.config.equals
    return { out: arr.filter((r) => String(r?.[path]) === String(eq)) }
  },
})

const map = defineNode({
  type: 'transform.map',
  category: 'transform',
  title: '映射',
  subtitle: 'map',
  icon: 'shuffle',
  ports: { inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] },
  config: { fields: [{ key: 'pick', type: 'string', label: '取字段', placeholder: 'title' }] },
})

const branch = defineNode({
  type: 'control.branch',
  category: 'control',
  title: '分支',
  subtitle: 'branch',
  icon: 'git-branch',
  ports: { inputs: [{ id: 'in' }], outputs: [{ id: 'true' }, { id: 'false' }] },
  config: { fields: [{ key: 'when', type: 'string', label: '条件', placeholder: 'count > 0' }] },
})

const displayJson = defineNode({
  type: 'display.json',
  category: 'display',
  title: 'JSON 视图',
  subtitle: 'display',
  icon: 'code',
  ports: { inputs: [{ id: 'in' }], outputs: [] },
})

const note = defineNode({
  type: 'note',
  category: 'custom',
  title: '便签',
  subtitle: 'note',
  icon: 'sticky-note',
  ports: { inputs: [], outputs: [] },
  config: { fields: [{ key: 'text', type: 'string', label: '内容', placeholder: '写点什么…' }] },
})

export const PRIMITIVE_NODES: NodeSpec<any>[] = [value, filter, map, branch, displayJson, note]
