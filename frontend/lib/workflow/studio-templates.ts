import type { ProjectAppType } from '@/lib/api/types'

import { PACKAGED_WORKFLOW_PROJECT } from './collection-pipeline'
import { WORKFLOW_NODE_CATALOG, createWorkflowNodeFromCatalog } from './node-catalog'
import { parseWorkflowProject, workflowNodeSchema, type WorkflowProjectNode } from './schema'

export const STUDIO_TEMPLATES = [
  { id: 'opencli-live-pipeline', variant: 'collection-to-consumption', appType: 'workflow', title: 'OpenCLI 实时采集清洗发送', description: '从 OpenCLI 动态数据源实时提取，完成标准化、去重、Records 入库并发送结果。', category: '完整链路', steps: ['OpenCLI 实时采集', '清洗与 Records', 'Webhook 发送'] },
  { id: 'financial-rss-intelligence', variant: 'collect', appType: 'workflow', title: '财经多源 RSS 情报', description: '并行采集央行政策、监管公告与研究动态，按来源 Group 清洗后写入成果与数据。', category: '采集与监控', steps: ['多源 RSS', 'Group 标准化', 'Records 入库'] },
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
type TemplateIntent = {
  cadence: string
  source: string
  objective: string
  delivery: string
}

const TEMPLATE_INTENTS: Record<(typeof STUDIO_TEMPLATES)[number]['id'], TemplateIntent> = {
  'opencli-live-pipeline': { cadence: '5m', source: 'opencli-live-catalog', objective: 'collect-clean-store-deliver', delivery: 'webhook' },
  'financial-rss-intelligence': { cadence: '15m', source: 'financial-rss-groups', objective: 'collect-normalize-store', delivery: 'records' },
  'website-watch': { cadence: 'hourly', source: 'webpage-url', objective: 'detect-change', delivery: 'records' },
  'multi-source-intake': { cadence: '15m', source: 'website-and-opencli-sources', objective: 'collect-and-normalize', delivery: 'records' },
  'news-brief': { cadence: 'daily', source: 'topic-feeds', objective: 'summarize-new-items', delivery: 'email' },
  'record-cleanup': { cadence: 'on-demand', source: 'imported-records', objective: 'normalize-and-dedupe', delivery: 'records' },
  'content-summary': { cadence: 'on-demand', source: 'long-form-content', objective: 'structured-summary', delivery: 'inbox' },
  'entity-extraction': { cadence: 'on-demand', source: 'text-input', objective: 'extract-entities-and-relations', delivery: 'records' },
  'research-agent': { cadence: 'on-demand', source: 'web-research', objective: 'evidence-backed-research', delivery: 'email' },
  'signal-triage': { cadence: 'realtime', source: 'incoming-signals', objective: 'classify-and-recommend', delivery: 'inbox' },
  'quality-review': { cadence: 'on-demand', source: 'content-under-review', objective: 'quality-gate', delivery: 'human-review' },
  'webhook-delivery': { cadence: 'realtime', source: 'workflow-results', objective: 'assemble-payload', delivery: 'webhook' },
  'database-sync': { cadence: '15m', source: 'workflow-results', objective: 'map-and-upsert', delivery: 'database' },
  'collection-to-consumption': { cadence: '15m', source: 'multi-source', objective: 'collect-decide-deliver', delivery: 'multi-channel' },
}

export function studioAppTypeForTemplate(template: StudioTemplateId): ProjectAppType {
  if (template === 'blank') return 'workflow'
  return STUDIO_TEMPLATES.find((item) => item.id === template)?.appType ?? 'workflow'
}

export function studioGraphForTemplate(template: StudioTemplateId, name: string) {
  const base = PACKAGED_WORKFLOW_PROJECT
  if (template === 'blank') {
    const startItem = WORKFLOW_NODE_CATALOG.find((item) => item.id === 'intelligence.input.collection-need')
    if (!startItem) throw new Error('空白工作流起点未注册')
    const start = createWorkflowNodeFromCatalog(startItem, 'start', { x: 160, y: 180 })
    return parseWorkflowProject({
      ...base,
      id: `draft-${Date.now()}`,
      name,
      nodes: [{
        ...start,
        params: { ...start.params, text: '', mode: 'demand-draft' },
        ui: { ...start.ui, label: '开始', description: '从这里描述需求或添加第一个节点' },
      }],
      edges: [],
      adapters: [],
    })
  }
  if (template === 'opencli-live-pipeline') return opencliLivePipelineGraph(name)
  if (template === 'financial-rss-intelligence') return financialRssIntelligenceGraph(name)

  const variant: StudioTemplateVariant = STUDIO_TEMPLATES.find((item) => item.id === template)?.variant ?? 'collection-to-consumption'
  const intent = TEMPLATE_INTENTS[template]
  const nodes = base.nodes.filter((node) => {
    const x = (node.ui?.position as { x?: number } | undefined)?.x ?? 0
    if (variant === 'collect') return x <= 400
    if (variant === 'process') return x > 400 && x <= 1100
    if (variant === 'deliver') return x > 1100
    return true
  }).map((node) => applyTemplateIntent(node, template, intent, true))
  const ids = new Set(nodes.map((node) => node.id))
  const referencedAdapterIds = collectReferencedAdapterIds(nodes)
  const adapters = base.adapters.filter((adapter) => referencedAdapterIds.has(adapter.id))
  return parseWorkflowProject({ ...base, id: `draft-${Date.now()}`, name, nodes, edges: base.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)), adapters })
}

function opencliLivePipelineGraph(name: string) {
  const catalog = (id: string) => {
    const item = WORKFLOW_NODE_CATALOG.find((candidate) => candidate.id === id)
    if (!item) throw new Error(`工作流节点未注册：${id}`)
    return item
  }
  const schedule = createWorkflowNodeFromCatalog(catalog('intelligence.schedule.cron'), 'schedule', { x: 80, y: 220 })
  const source: WorkflowProjectNode = {
    id: 'source-opencli-bbc-news',
    kind: 'source',
    capability: 'fetch',
    adapter: 'opencli-bbc',
    params: {
      site: 'bbc',
      command: 'news',
      format: 'json',
      args: {},
      sourceGroup: 'bbc',
      opencliAdapterNodeId: 'opencli.adapter.bbc.news',
    },
    ui: {
      label: 'BBC · news',
      description: '默认实时示例；通过“添加节点”可搜索并加入全部 OpenCLI 读命令',
      icon: 'Globe',
      color: 'var(--chart-4)',
      position: { x: 340, y: 220 },
      catalogId: 'intelligence.source.opencli-slot',
    },
  }
  const normalize = createWorkflowNodeFromCatalog(catalog('intelligence.processing.normalize'), 'normalize', { x: 620, y: 150 })
  const dedupe = createWorkflowNodeFromCatalog(catalog('intelligence.processing.dedupe'), 'dedupe', { x: 880, y: 150 })
  const acceptance = createWorkflowNodeFromCatalog(catalog('intelligence.control.record-acceptance'), 'record-acceptance', { x: 1140, y: 150 })
  const records = createWorkflowNodeFromCatalog(catalog('intelligence.sink.records'), 'records', { x: 1420, y: 80 })
  const notifyItem = catalog('intelligence.output.webhook')
  const notify = createWorkflowNodeFromCatalog(notifyItem, 'notify-webhook', { x: 1420, y: 270 })
  const adapters = [
    {
      id: 'opencli-bbc',
      type: 'source' as const,
      provider: 'opencli',
      mode: 'live' as const,
      config: { channel: 'opencli' },
    },
    ...(notifyItem.requiredAdapters ?? []),
  ]
  return parseWorkflowProject({
    ...PACKAGED_WORKFLOW_PROJECT,
    id: `draft-${Date.now()}`,
    name,
    adapters,
    agentPermissions: {
      ...PACKAGED_WORKFLOW_PROJECT.agentPermissions,
      canFetchNetwork: true,
      canWriteInbox: true,
      canSendNotifications: true,
    },
    nodes: [schedule, source, normalize, dedupe, acceptance, records, notify],
    edges: [
      { id: 'schedule-source', source: schedule.id, target: source.id },
      { id: 'source-normalize', source: source.id, target: normalize.id },
      { id: 'normalize-dedupe', source: normalize.id, target: dedupe.id },
      { id: 'dedupe-acceptance', source: dedupe.id, target: acceptance.id },
      { id: 'acceptance-records', source: acceptance.id, target: records.id },
      { id: 'acceptance-notify', source: acceptance.id, target: notify.id },
    ],
  })
}

function financialRssIntelligenceGraph(name: string) {
  const catalog = (id: string) => {
    const item = WORKFLOW_NODE_CATALOG.find((candidate) => candidate.id === id)
    if (!item) throw new Error(`工作流节点未注册：${id}`)
    return item
  }
  const schedule = createWorkflowNodeFromCatalog(catalog('intelligence.schedule.cron'), 'schedule-finance-rss', { x: 80, y: 240 })
  schedule.params = { ...schedule.params, interval: '15m', timezone: 'Asia/Shanghai' }

  const rssItem = catalog('intelligence.source.rss')
  const sourceDefinitions = [
    {
      id: 'rss-federal-reserve',
      label: '美联储 · 政策与公告',
      description: 'Federal Reserve 官方新闻与政策公告 RSS',
      feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml',
      sourceGroup: 'macro-policy',
      site: 'federal-reserve',
      y: 80,
    },
    {
      id: 'rss-sec-regulation',
      label: 'SEC · 市场监管',
      description: 'SEC 官方 Press Releases RSS',
      feedUrl: 'https://www.sec.gov/news/pressreleases.rss',
      sourceGroup: 'market-regulation',
      site: 'sec',
      y: 240,
    },
    {
      id: 'rss-ecb-research',
      label: 'ECB · 央行研究',
      description: 'ECB 官方新闻、讲话与研究动态 RSS',
      feedUrl: 'https://www.ecb.europa.eu/rss/press.html',
      sourceGroup: 'central-bank-research',
      site: 'ecb',
      y: 400,
    },
  ] as const
  const sources = sourceDefinitions.map((definition) => {
    const source = createWorkflowNodeFromCatalog(rssItem, definition.id, { x: 360, y: definition.y })
    return {
      ...source,
      params: {
        ...source.params,
        feedUrl: definition.feedUrl,
        maxEntries: 20,
        sourceGroup: definition.sourceGroup,
        site: definition.site,
      },
      ui: {
        ...source.ui,
        label: definition.label,
        description: definition.description,
      },
    }
  })
  const normalize = createWorkflowNodeFromCatalog(catalog('intelligence.processing.normalize'), 'normalize-finance-rss', { x: 700, y: 240 })
  const acceptance = createWorkflowNodeFromCatalog(catalog('intelligence.control.record-acceptance'), 'accept-finance-rss', { x: 980, y: 240 })
  const records = createWorkflowNodeFromCatalog(catalog('intelligence.sink.records'), 'records-finance-rss', { x: 1260, y: 240 })

  return parseWorkflowProject({
    ...PACKAGED_WORKFLOW_PROJECT,
    id: `draft-${Date.now()}`,
    name,
    adapters: [...(rssItem.requiredAdapters ?? [])],
    agentPermissions: {
      ...PACKAGED_WORKFLOW_PROJECT.agentPermissions,
      canFetchNetwork: true,
      canWriteInbox: true,
      canSendNotifications: false,
      allowedDomains: ['federalreserve.gov', 'sec.gov', 'ecb.europa.eu'],
    },
    nodes: [schedule, ...sources, normalize, acceptance, records],
    edges: [
      ...sources.map((source) => ({
        id: `${schedule.id}-${source.id}`,
        source: schedule.id,
        target: source.id,
        sourcePort: 'tick',
        targetPort: 'in',
      })),
      ...sources.map((source) => ({
        id: `${source.id}-${normalize.id}`,
        source: source.id,
        target: normalize.id,
        sourcePort: 'out',
        targetPort: 'in',
      })),
      {
        id: `${normalize.id}-${acceptance.id}`,
        source: normalize.id,
        target: acceptance.id,
        sourcePort: 'out',
        targetPort: 'candidates',
      },
      {
        id: `${acceptance.id}-${records.id}`,
        source: acceptance.id,
        target: records.id,
        sourcePort: 'records',
        targetPort: 'records',
      },
    ],
  })
}

function applyTemplateIntent(node: WorkflowProjectNode, templateId: Exclude<StudioTemplateId, 'blank'>, intent: TemplateIntent, topLevel = false): WorkflowProjectNode {
  const params = { ...node.params }
  if (topLevel) Object.assign(params, { templateId, cadence: intent.cadence, source: intent.source, objective: intent.objective, delivery: intent.delivery })
  if (node.kind === 'schedule') params.interval = intent.cadence
  if (node.kind === 'source' && node.capability === 'fetch') params.sourceTemplate = intent.source
  if (node.kind === 'notify' && node.capability === 'send') params.deliveryTemplate = intent.delivery
  if (node.kind === 'agent') params.objective = intent.objective

  return {
    ...node,
    params,
    internals: node.internals
      ? { ...node.internals, nodes: node.internals.nodes.map((child) => applyTemplateIntent(workflowNodeSchema.parse(child), templateId, intent)) }
      : undefined,
  }
}

function collectReferencedAdapterIds(nodes: WorkflowProjectNode[]): Set<string> {
  const ids = new Set<string>()
  const visit = (node: WorkflowProjectNode) => {
    if (node.adapter) ids.add(node.adapter)
    node.internals?.nodes.forEach((child) => visit(workflowNodeSchema.parse(child)))
  }
  nodes.forEach(visit)
  return ids
}

export function studioSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
}
