import type {
  AdapterBinding,
  WorkflowCapability,
  WorkflowNodeKind,
  WorkflowProfile,
  WorkflowProject,
  WorkflowProjectNode,
} from "./schema"
import { parseWorkflowProject } from "./schema"
import { getNodeInternals } from "./node-internals"
import { createParameterInterfaceFromInternals } from "./parameter-interface"

export type WorkflowNodeCatalogCategory = "trigger" | "source" | "processing" | "decision" | "output" | "package"

export type WorkflowNodeCatalogItem = {
  id: string
  idPrefix: string
  label: string
  description: string
  category: WorkflowNodeCatalogCategory
  profile: WorkflowProfile
  kind: WorkflowNodeKind
  capability: WorkflowCapability
  icon: string
  color: string
  adapter?: string
  requiredAdapters?: AdapterBinding[]
  params: Record<string, unknown>
  topicCollapse?: WorkflowProjectNode["topicCollapse"]
  internals?: WorkflowProjectNode["internals"]
  keywords: string[]
}

const JIN10_ADAPTER: AdapterBinding = {
  id: "jin10-kuaixun",
  type: "source",
  provider: "jin10",
  mode: "fixture",
  config: { feed: "kuaixun" },
}

const SIMULATED_WEBHOOK_ADAPTER: AdapterBinding = {
  id: "simulated-webhook",
  type: "notification",
  provider: "generic-webhook",
  mode: "mock",
  config: { target: "operator-preview" },
}

const OPENCLI_BILIBILI_ADAPTER: AdapterBinding = {
  id: "opencli-bilibili",
  type: "source",
  provider: "opencli",
  mode: "live",
  config: { channel: "opencli" },
}

const OPENCLI_XIAOHONGSHU_ADAPTER: AdapterBinding = {
  id: "opencli-xiaohongshu",
  type: "source",
  provider: "opencli",
  mode: "live",
  config: { channel: "opencli" },
}

export const WORKFLOW_NODE_CATALOG: WorkflowNodeCatalogItem[] = [
  {
    id: "intelligence.schedule.cron",
    idPrefix: "schedule",
    label: "Cron Schedule",
    description: "按 cron/interval 周期触发情报工作流",
    category: "trigger",
    profile: "intelligence",
    kind: "schedule",
    capability: "trigger",
    icon: "Clock",
    color: "var(--chart-1)",
    params: { interval: "5m", timezone: "Asia/Shanghai" },
    keywords: ["schedule", "cron", "hourly", "daily", "定时", "触发"],
  },
  {
    id: "intelligence.source.jin10",
    idPrefix: "source-jin10",
    label: "JIN10 Source",
    description: "读取金十快讯 fixture/live feed",
    category: "source",
    profile: "intelligence",
    kind: "source",
    capability: "fetch",
    icon: "Globe",
    color: "var(--chart-4)",
    adapter: JIN10_ADAPTER.id,
    requiredAdapters: [JIN10_ADAPTER],
    params: { limit: 20, importantOnly: false, channel: "kuaixun" },
    keywords: ["jin10", "金十", "source", "news", "kuaixun", "fetch"],
  },
  {
    id: "intelligence.processing.normalize",
    idPrefix: "normalize",
    label: "Normalize Items",
    description: "统一字段、语言和时间格式",
    category: "processing",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "ArrowRightLeft",
    color: "var(--chart-2)",
    params: { language: "zh-CN", preserveSourceRefs: true },
    keywords: ["normalize", "clean", "format", "标准化", "清洗"],
  },
  {
    id: "intelligence.processing.dedupe",
    idPrefix: "dedupe",
    label: "Dedupe Items",
    description: "按标题、时间和来源去重",
    category: "processing",
    profile: "intelligence",
    kind: "agent",
    capability: "dedupe",
    icon: "Filter",
    color: "var(--chart-2)",
    params: { key: "title+source+publishedAt", window: "24h" },
    keywords: ["dedupe", "duplicate", "去重", "重复"],
  },
  {
    id: "intelligence.agent.summary",
    idPrefix: "summary",
    label: "LLM Summary",
    description: "生成短摘要和影响解释",
    category: "processing",
    profile: "intelligence",
    kind: "agent",
    capability: "summarize",
    icon: "Sparkles",
    color: "var(--chart-2)",
    params: { model: "deepseek", style: "macro-brief", maxChars: 280 },
    keywords: ["deepseek", "gpt", "claude", "llm", "agent", "summary", "摘要"],
  },
  {
    id: "intelligence.agent.score",
    idPrefix: "score",
    label: "Importance Score",
    description: "按影响范围和紧急度打分",
    category: "processing",
    profile: "intelligence",
    kind: "agent",
    capability: "score",
    icon: "Sigma",
    color: "var(--chart-3)",
    params: { threshold: 0.7, dimensions: ["market", "policy", "urgency"] },
    keywords: ["score", "rating", "importance", "打分", "重要性"],
  },
  {
    id: "intelligence.agent.tag",
    idPrefix: "tag",
    label: "Auto Tag",
    description: "给条目打主题、市场和风险标签",
    category: "processing",
    profile: "intelligence",
    kind: "agent",
    capability: "tag",
    icon: "Code",
    color: "var(--chart-3)",
    params: { taxonomy: ["macro", "fx", "commodity", "policy", "risk"] },
    keywords: ["tag", "label", "topic", "标签", "分类"],
  },
  {
    id: "intelligence.router.importance",
    idPrefix: "router-importance",
    label: "Importance Router",
    description: "按分数和条件路由到 Inbox/Notify",
    category: "decision",
    profile: "intelligence",
    kind: "router",
    capability: "route",
    icon: "GitBranch",
    color: "var(--chart-5)",
    params: { expression: "item.important === true || item.score >= 0.7" },
    keywords: ["score", "router", "condition", "threshold", "路由", "阈值"],
  },
  {
    id: "intelligence.output.inbox",
    idPrefix: "inbox",
    label: "Inbox Store",
    description: "保存到人工复核队列",
    category: "output",
    profile: "intelligence",
    kind: "inbox",
    capability: "store",
    icon: "Inbox",
    color: "var(--chart-4)",
    params: { queue: "macro-watch", archive: true },
    keywords: ["inbox", "store", "cache", "archive", "收件箱", "归档"],
  },
  {
    id: "intelligence.output.webhook",
    idPrefix: "notify",
    label: "Webhook Notify",
    description: "模拟 webhook 推送，真实通知后置",
    category: "output",
    profile: "intelligence",
    kind: "notify",
    capability: "send",
    icon: "Bell",
    color: "var(--chart-1)",
    adapter: SIMULATED_WEBHOOK_ADAPTER.id,
    requiredAdapters: [SIMULATED_WEBHOOK_ADAPTER],
    params: { template: "brief", target: "operator-preview" },
    keywords: ["feishu", "wecom", "tg", "telegram", "qq", "notify", "webhook", "通知"],
  },
  {
    id: "package.collection.pipeline",
    idPrefix: "pkg-collection",
    label: "Collection Pipeline",
    description: "封装调度触发、多源采集（JIN10/RSS/HTTP）、标准化、去重和富化的采集管线",
    category: "package",
    profile: "intelligence",
    kind: "source",
    capability: "fetch",
    icon: "Globe",
    color: "var(--chart-4)",
    adapter: JIN10_ADAPTER.id,
    requiredAdapters: [JIN10_ADAPTER],
    params: { template: "collection-pipeline", runtime: "fixture", lockedInternals: true },
    keywords: ["package", "collection", "source", "rss", "http", "采集", "封装"],
  },
  {
    id: "package.opencli.multi-source-hda",
    idPrefix: "pkg-opencli-hda",
    label: "OpenCLI Multi-source HDA",
    description: "封装 Bilibili/小红书 OpenCLI source fanout 和内部标准化",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "Network",
    color: "var(--chart-4)",
    requiredAdapters: [OPENCLI_BILIBILI_ADAPTER, OPENCLI_XIAOHONGSHU_ADAPTER],
    params: { template: "opencli-multi-source", runtime: "iii", lockedInternals: true },
    topicCollapse: {
      groupId: "opencli-package",
      nodeCount: 3,
      mode: "locked",
      packageInternal: true,
    },
    internals: {
      locked: true,
      nodes: [
        {
          id: "source-bilibili",
          kind: "source",
          capability: "fetch",
          adapter: "opencli-bilibili",
          params: {
            site: "bilibili",
            command: "search",
            args: { keyword: "ai" },
            sourceGroup: "video",
          },
        },
        {
          id: "source-xiaohongshu",
          kind: "source",
          capability: "fetch",
          adapter: "opencli-xiaohongshu",
          params: {
            site: "xiaohongshu",
            command: "search",
            args: { keyword: "ai" },
            sourceGroup: "social",
          },
        },
        {
          id: "internal-normalize",
          kind: "agent",
          capability: "normalize",
          params: { language: "zh-CN" },
        },
      ],
      edges: [
        {
          id: "bilibili-normalize",
          source: "source-bilibili",
          target: "internal-normalize",
        },
        {
          id: "xiaohongshu-normalize",
          source: "source-xiaohongshu",
          target: "internal-normalize",
        },
      ],
    },
    keywords: ["package", "hda", "opencli", "bilibili", "xiaohongshu", "multi-source", "采集", "封装"],
  },
  {
    id: "package.dispatch.fanout",
    idPrefix: "pkg-dispatch",
    label: "Dispatch Fanout",
    description: "封装重要性路由、限流和 Webhook/Telegram/邮件多通道发送与 Postgres 存档",
    category: "package",
    profile: "intelligence",
    kind: "notify",
    capability: "send",
    icon: "Bell",
    color: "var(--chart-1)",
    adapter: SIMULATED_WEBHOOK_ADAPTER.id,
    requiredAdapters: [SIMULATED_WEBHOOK_ADAPTER],
    params: { template: "dispatch-fanout", runtime: "mock", lockedInternals: true },
    keywords: ["package", "dispatch", "fanout", "telegram", "email", "发送", "分发", "封装"],
  },
  {
    id: "package.intelligence.pipeline",
    idPrefix: "pkg-intelligence",
    label: "Intelligence Pipeline",
    description: "封装定时抓取、标准化、摘要评分、复核和通知的情报流水线",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "Network",
    color: "var(--chart-2)",
    params: { template: "jin10-intelligence", runtime: "fixture", lockedInternals: true },
    keywords: ["package", "dop", "intelligence", "pipeline", "情报", "封装"],
  },
  {
    id: "package.ops.event",
    idPrefix: "pkg-ops-event",
    label: "Ops Event",
    description: "封装触发、队列、重试、日志和执行证据的任务事件",
    category: "package",
    profile: "intelligence",
    kind: "action",
    capability: "send",
    icon: "ServerCog",
    color: "var(--chart-4)",
    params: { template: "ops-event", runtime: "template", lockedInternals: true },
    keywords: ["package", "ops", "event", "job", "automation", "任务"],
  },
  {
    id: "package.ops.monitor-guard",
    idPrefix: "pkg-monitor",
    label: "Monitor Guard",
    description: "封装指标采集、阈值、delta 和限流的监控闸门",
    category: "package",
    profile: "intelligence",
    kind: "router",
    capability: "route",
    icon: "Activity",
    color: "var(--chart-4)",
    params: { template: "monitor-guard", runtime: "template", lockedInternals: true },
    keywords: ["package", "monitor", "guard", "metric", "alert", "监控"],
  },
  {
    id: "package.ops.alert-response",
    idPrefix: "pkg-alert",
    label: "Alert Response",
    description: "封装告警分派、通知、工单、快照和升级动作",
    category: "package",
    profile: "intelligence",
    kind: "notify",
    capability: "send",
    icon: "Bell",
    color: "var(--chart-1)",
    params: { template: "alert-response", runtime: "template", lockedInternals: true },
    keywords: ["package", "alert", "response", "ticket", "snapshot", "告警"],
  },
  {
    id: "package.ai.prompt-experiment",
    idPrefix: "pkg-prompt-exp",
    label: "Prompt Experiment",
    description: "封装 prompt 版本、测试用例、模型对比和实验记录",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "summarize",
    icon: "FlaskConical",
    color: "var(--state-action)",
    params: { template: "prompt-experiment", runtime: "mock", lockedInternals: true },
    keywords: ["package", "prompt", "experiment", "model", "eval", "实验"],
  },
  {
    id: "package.verify.regression-gate",
    idPrefix: "pkg-regression",
    label: "Regression Gate",
    description: "封装 dataset、evaluator、scorecard 和回归门禁",
    category: "package",
    profile: "intelligence",
    kind: "router",
    capability: "route",
    icon: "ShieldCheck",
    color: "#4ade80",
    params: { template: "regression-gate", runtime: "mock", lockedInternals: true },
    keywords: ["package", "regression", "scorecard", "coverage", "gate", "回归"],
  },
  {
    id: "package.map.knowledge-map",
    idPrefix: "pkg-knowledge-map",
    label: "Knowledge Map",
    description: "封装来源锚点、语义连线、主题折叠和知识导出",
    category: "package",
    profile: "intelligence",
    kind: "action",
    capability: "store",
    icon: "Network",
    color: "var(--chart-3)",
    params: { template: "knowledge-map", runtime: "template", lockedInternals: true },
    keywords: ["package", "knowledge", "map", "turnmap", "obsidian", "知识图"],
  },
  {
    id: "package.review.human-review",
    idPrefix: "pkg-human-review",
    label: "Human Review",
    description: "封装人工审核、Inbox、审批分支和审计证据",
    category: "package",
    profile: "intelligence",
    kind: "inbox",
    capability: "store",
    icon: "Inbox",
    color: "var(--chart-4)",
    params: { template: "human-review", runtime: "template", lockedInternals: true },
    keywords: ["package", "human", "review", "approval", "inbox", "人工"],
  },
]

export function getWorkflowNodeCatalog(profile: WorkflowProfile): WorkflowNodeCatalogItem[] {
  return WORKFLOW_NODE_CATALOG.filter((item) => item.profile === profile)
}

export function createWorkflowNodeFromCatalog(
  item: WorkflowNodeCatalogItem,
  id: string,
  position: { x: number; y: number },
): WorkflowProjectNode {
  const parameterInterface = createParameterInterfaceFromInternals(
    id,
    getNodeInternals({
      id,
      kind: item.kind,
      capability: item.capability,
      adapter: item.adapter,
      params: item.params,
      ui: { catalogId: item.id },
    }),
  )

  return {
    id,
    kind: item.kind,
    capability: item.capability,
    adapter: item.adapter,
    params: { ...item.params },
    topicCollapse: cloneCatalogValue(item.topicCollapse),
    parameterInterface,
    internals: cloneCatalogValue(item.internals),
    ui: {
      label: item.label,
      description: item.description,
      icon: item.icon,
      color: item.color,
      position,
      catalogId: item.id,
    },
  }
}

export function addCatalogNodeToWorkflowProject(
  project: WorkflowProject,
  item: WorkflowNodeCatalogItem,
  id: string,
  position: { x: number; y: number },
): WorkflowProject {
  const existingAdapters = new Set(project.adapters.map((adapter) => adapter.id))
  const requiredAdapters = (item.requiredAdapters ?? []).filter((adapter) => !existingAdapters.has(adapter.id))
  return parseWorkflowProject({
    ...project,
    adapters: [...project.adapters, ...requiredAdapters],
    nodes: [...project.nodes, createWorkflowNodeFromCatalog(item, id, position)],
  })
}

function cloneCatalogValue<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T)
}
