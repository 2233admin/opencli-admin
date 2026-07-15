import { PACKAGED_WORKFLOW_PROJECT } from './collection-pipeline'
import { parseWorkflowProject } from './schema'

export const STUDIO_TEMPLATES = [
  { id: 'collect', title: '实时网站采集器', description: '把网站或 CLI 封装为持续运行的数据入口。', category: '采集', steps: ['配置数据源', '解析网页内容', '输出结构化记录'] },
  { id: 'process', title: '结构化清洗管线', description: '标准化、去重、结构化与 Agent 增强处理。', category: '处理', steps: ['接收原始记录', '清洗与标准化', '交给 Agent 增强'] },
  { id: 'deliver', title: '数据消费 API', description: '将产物发送到 API、数据库、消息系统或其他 AI。', category: '发送', steps: ['接收处理结果', '组装发送负载', '投递目标系统'] },
  { id: 'collection-to-consumption', title: '采集到消费完整链路', description: '采集、处理、决策、发送与运行观测的完整模板。', category: '完整链路', steps: ['采集与解析', '处理与决策', '发送与观测'] },
] as const

export type StudioTemplateId = (typeof STUDIO_TEMPLATES)[number]['id'] | 'blank'

export function studioGraphForTemplate(template: StudioTemplateId, name: string) {
  const base = PACKAGED_WORKFLOW_PROJECT
  const nodes = template === 'blank' ? base.nodes.slice(0, 1) : base.nodes.filter((node) => {
    const x = (node.ui?.position as { x?: number } | undefined)?.x ?? 0
    if (template === 'collect') return x <= 400
    if (template === 'process') return x > 400 && x <= 1100
    if (template === 'deliver') return x > 1100
    return true
  })
  const ids = new Set(nodes.map((node) => node.id))
  const adapters = base.adapters.filter((adapter) => nodes.some((node) => node.adapter === adapter.id))
  return parseWorkflowProject({ ...base, id: `draft-${Date.now()}`, name, nodes, edges: base.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), adapters })
}

export function studioSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
}
