import type { ProjectAppType } from '@/lib/api/types'

import { PACKAGED_WORKFLOW_PROJECT } from './collection-pipeline'
import { parseWorkflowProject } from './schema'

export const STUDIO_TEMPLATES = [
  { id: 'website-watch', variant: 'collect', appType: 'workflow', title: '网站变化监控', description: '定时读取指定页面，识别内容变化并形成可追溯记录。', category: '采集与监控', steps: ['网页来源', '变化检测', '记录入库'] },
  { id: 'multi-source-intake', variant: 'collect', appType: 'workflow', title: '多来源信息采集', description: '把多个网站与 CLI 数据源汇入统一的采集队列。', category: '采集与监控', steps: ['来源列表', '并行采集', '统一输出'] },
  { id: 'news-brief', variant: 'collect', appType: 'text-generator', title: '每日资讯简报', description: '持续汇总指定主题的新内容，生成每日更新素材。', category: '采集与监控', steps: ['主题检索', '内容抓取', '增量归档'] },
  { id: 'record-cleanup', variant: 'process', appType: 'workflow', title: '结构化清洗管线', description: '标准化、去重并修复来源不同的数据记录。', category: '内容处理', steps: ['原始记录', '清洗去重', '结构化结果'] },
  { id: 'content-summary', variant: 'process', appType: 'text-generator', title: '长内容摘要', description: '拆分长文档，保留关键信息并生成结构化摘要。', category: '内容处理', steps: ['内容切分', '要点提取', '摘要合并'] },
  { id: 'entity-extraction', variant: 'process', appType: 'workflow', title: '实体与关系提取', description: '识别人名、机构、产品及它们之间的关系。', category: '内容处理', steps: ['文本输入', '实体识别', '关系映射'] },
  { id: 'research-agent', variant: 'collection-to-consumption', appType: 'agent', title: '专题研究 Agent', description: '围绕一个问题检索证据、交叉验证并输出研究结论。', category: 'Agent 分析', steps: ['任务拆解', '证据研判', '结论生成'] },
  { id: 'signal-triage', variant: 'collection-to-consumption', appType: 'agent', title: '信号研判助手', description: '对新信号进行分级、补充背景并给出处置建议。', category: 'Agent 分析', steps: ['信号接入', 'Agent 研判', '建议输出'] },
  { id: 'quality-review', variant: 'process', appType: 'agent', title: '内容质量审查', description: '按规则和样例检查内容质量，标记需要人工确认的部分。', category: 'Agent 分析', steps: ['规则读取', '质量检查', '人工复核'] },
  { id: 'webhook-delivery', variant: 'deliver', appType: 'workflow', title: 'Webhook 结果分发', description: '把工作流产物转换为稳定负载并投递到业务系统。', category: '分发与集成', steps: ['结果接收', '负载组装', 'Webhook'] },
  { id: 'database-sync', variant: 'deliver', appType: 'workflow', title: '数据表同步', description: '将处理结果按字段映射写入数据库或数据表。', category: '分发与集成', steps: ['字段映射', '批量写入', '状态回执'] },
  { id: 'collection-to-consumption', variant: 'collection-to-consumption', appType: 'workflow', title: '采集到消费完整链路', description: '采集、处理、决策、发送与运行观测的一体化模板。', category: '完整链路', steps: ['采集与解析', '处理与决策', '发送与观测'] },
] as const

export type StudioTemplateId = (typeof STUDIO_TEMPLATES)[number]['id'] | 'blank'
type StudioTemplateVariant = (typeof STUDIO_TEMPLATES)[number]['variant'] | 'blank'

export function studioAppTypeForTemplate(template: StudioTemplateId): ProjectAppType {
  if (template === 'blank') return 'workflow'
  return STUDIO_TEMPLATES.find((item) => item.id === template)?.appType ?? 'workflow'
}

export function studioGraphForTemplate(template: StudioTemplateId, name: string) {
  const variant: StudioTemplateVariant = template === 'blank'
    ? 'blank'
    : STUDIO_TEMPLATES.find((item) => item.id === template)?.variant ?? 'collection-to-consumption'
  const base = PACKAGED_WORKFLOW_PROJECT
  const nodes = variant === 'blank' ? base.nodes.slice(0, 1) : base.nodes.filter((node) => {
    const x = (node.ui?.position as { x?: number } | undefined)?.x ?? 0
    if (variant === 'collect') return x <= 400
    if (variant === 'process') return x > 400 && x <= 1100
    if (variant === 'deliver') return x > 1100
    return true
  })
  const ids = new Set(nodes.map((node) => node.id))
  const adapters = base.adapters.filter((adapter) => nodes.some((node) => node.adapter === adapter.id))
  return parseWorkflowProject({ ...base, id: `draft-${Date.now()}`, name, nodes, edges: base.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), adapters })
}

export function studioSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
}
