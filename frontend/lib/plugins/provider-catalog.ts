export type PluginProviderCategory =
  | 'model'
  | 'tool'
  | 'datasource'
  | 'agent'
  | 'trigger'
  | 'extension'
  | 'bundle'

export type PluginProviderIcon =
  | 'brain'
  | 'wrench'
  | 'database'
  | 'bot'
  | 'clock'
  | 'puzzle'
  | 'package'
  | 'globe'
  | 'rss'
  | 'webhook'

export type PluginProvider = {
  id: string
  name: string
  author: string
  category: PluginProviderCategory
  description: string
  icon: PluginProviderIcon
  nodeIds: string[]
  tags: string[]
  bundled?: boolean
  marketplace?: boolean
}

/**
 * Dify-style provider packages. A provider may expose several workflow nodes,
 * but the plugin center presents the provider once and leaves node selection to Studio.
 */
export const PLUGIN_PROVIDERS: PluginProvider[] = [
  {
    id: 'opencli',
    name: 'OpenCLI',
    author: 'OpenCLI',
    category: 'datasource',
    description: '把已注册网站的读取与操作能力暴露给工作流。',
    icon: 'globe',
    nodeIds: ['intelligence.source.opencli-slot', 'package.opencli.multi-source-hda'],
    tags: ['website', 'browser', 'collection'],
    bundled: true,
  },
  {
    id: 'rss-reader',
    name: 'RSS / Atom',
    author: 'OpenCLI',
    category: 'datasource',
    description: '读取 RSS、Atom、RSSHub 与 RSS-Bridge 内容。',
    icon: 'rss',
    nodeIds: [
      'intelligence.source.rss',
      'intelligence.source.rsshub',
      'intelligence.source.rss-bridge',
    ],
    tags: ['rss', 'feed', 'reader'],
    bundled: true,
  },
  {
    id: 'http-api',
    name: 'HTTP / API',
    author: 'OpenCLI',
    category: 'datasource',
    description: '通过受控 HTTP 请求读取 JSON API 与自定义网络数据。',
    icon: 'database',
    nodeIds: ['intelligence.source.http'],
    tags: ['http', 'api', 'json'],
    bundled: true,
  },
  {
    id: 'model-runtime',
    name: '模型运行时',
    author: 'OpenCLI',
    category: 'model',
    description: '为摘要、评分、分类等分析节点提供模型推理。',
    icon: 'brain',
    nodeIds: [
      'intelligence.agent.summary',
      'intelligence.agent.score',
      'intelligence.agent.tag',
    ],
    tags: ['llm', 'analysis', 'inference'],
    bundled: true,
  },
  {
    id: 'agent-runtime',
    name: 'Agent Runtime',
    author: 'OpenCLI',
    category: 'agent',
    description: '把 Codex、Claude Code、Hermes 等执行端作为可选择的 Agent Provider。',
    icon: 'bot',
    nodeIds: ['package.ai.prompt-experiment', 'package.intelligence.pipeline'],
    tags: ['agent', 'codex', 'claude', 'hermes'],
    bundled: true,
  },
  {
    id: 'schedule-trigger',
    name: 'Schedule Trigger',
    author: 'OpenCLI',
    category: 'trigger',
    description: '按计划或业务需求启动工作流。',
    icon: 'clock',
    nodeIds: ['intelligence.schedule.cron', 'intelligence.input.collection-need'],
    tags: ['cron', 'schedule', 'trigger'],
    bundled: true,
  },
  {
    id: 'delivery',
    name: 'Delivery',
    author: 'OpenCLI',
    category: 'tool',
    description: '通过 Webhook 与 TurboPush 把结果交付给外部系统。',
    icon: 'webhook',
    nodeIds: ['intelligence.output.webhook', 'intelligence.output.turbopush-publish'],
    tags: ['webhook', 'publish', 'notification'],
    bundled: true,
  },
  {
    id: 'workflow-core',
    name: 'Workflow Components',
    author: 'OpenCLI',
    category: 'extension',
    description: '提供通用工作流组件，并兼容 Dify DSL 中的控制、转换、模型与输出节点。',
    icon: 'puzzle',
    nodeIds: [
      'workflow.start.webhook',
      'workflow.block.agent',
      'workflow.block.agent-v2',
      'workflow.block.llm',
      'workflow.block.knowledge-retrieval',
      'workflow.block.end',
      'workflow.block.direct-answer',
      'workflow.block.question-classifier',
      'workflow.block.if-else',
      'workflow.block.exit-loop',
      'workflow.block.iteration',
      'workflow.block.loop',
      'workflow.block.code',
      'workflow.block.template-transform',
      'workflow.block.variable-aggregator',
      'workflow.block.document-extractor',
      'workflow.block.variable-assigner',
      'workflow.block.parameter-extractor',
      'workflow.block.http-request',
      'workflow.block.list-filter',
      'intelligence.processing.normalize',
      'intelligence.processing.dedupe',
      'intelligence.flow.merge',
      'intelligence.router.importance',
      'intelligence.control.record-acceptance',
      'intelligence.sink.records',
    ],
    tags: ['workflow', 'transform', 'control'],
    bundled: true,
  },
  {
    id: 'workflow-bundles',
    name: 'Workflow Bundles',
    author: 'OpenCLI',
    category: 'bundle',
    description: '提供采集、分析、告警、审核等可复用工作流模板包。',
    icon: 'package',
    nodeIds: [
      'package.collection.pipeline',
      'package.opencli.multi-source-hda',
      'package.dispatch.fanout',
      'package.intelligence.pipeline',
      'package.ops.event',
      'package.ops.monitor-guard',
      'package.ops.alert-response',
      'package.ai.prompt-experiment',
      'package.verify.regression-gate',
      'package.map.knowledge-map',
      'package.review.human-review',
    ],
    tags: ['bundle', 'template', 'hda'],
    bundled: true,
  },
  {
    id: 'opentabs',
    name: 'OpenTabs',
    author: 'OpenTabs',
    category: 'tool',
    description: '通过本机 OpenTabs Provider 调用浏览器工具。',
    icon: 'wrench',
    nodeIds: [],
    tags: ['browser', 'tool', 'local'],
    marketplace: true,
  },
  {
    id: 'browser-bridge',
    name: 'Browser Bridge',
    author: 'OpenCLI',
    category: 'tool',
    description: '通过 BBX Provider 读取或操作当前浏览器页面。',
    icon: 'wrench',
    nodeIds: [],
    tags: ['bbx', 'browser', 'tool'],
    marketplace: true,
  },
]

export const PLUGIN_PROVIDER_CATEGORIES: Array<{
  key: 'all' | PluginProviderCategory
  label: string
}> = [
  { key: 'all', label: '全部' },
  { key: 'model', label: '模型' },
  { key: 'tool', label: '工具' },
  { key: 'datasource', label: '数据源' },
  { key: 'agent', label: 'Agent 策略' },
  { key: 'trigger', label: '触发器' },
  { key: 'extension', label: '扩展' },
  { key: 'bundle', label: '工具包' },
]

export function pluginProviderCategoryLabel(category: PluginProviderCategory): string {
  return PLUGIN_PROVIDER_CATEGORIES.find((item) => item.key === category)?.label ?? category
}
