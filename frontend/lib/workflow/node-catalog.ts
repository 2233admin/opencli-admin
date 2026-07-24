import type {
  ParameterFieldType,
  ParameterInterface,
  ParameterInterfaceField,
} from "@/lib/flow/types"
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
import {
  catalogRuntimeCapability,
  projectedCatalogRuntimeCapability,
  runtimeContractForCapability,
  type WorkflowCapabilitiesResponse,
  type WorkflowRuntimeIOContract,
  type WorkflowRuntimeCapability,
} from "./capabilities"
import type { WorkflowToolCapability } from "./backend-tool-capabilities"

export type WorkflowNodeCatalogCategory =
  | "trigger"
  | "source"
  | "processing"
  | "flow"
  | "decision"
  | "control"
  | "sink"
  | "output"
  | "package"

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
  runtimeCapability?: WorkflowRuntimeCapability
  runtimeContract?: WorkflowRuntimeIOContract
  keywords: string[]
}

export const COLLECTION_NEED_CATALOG_ID = "intelligence.input.collection-need"
export const TURBOPUSH_PUBLISH_CATALOG_ID = "intelligence.output.turbopush-publish"
export const RECORD_HYGIENE_PACKAGE_CATALOG_ID = "package.processing.record-hygiene"

const RECORD_HYGIENE_INTERNALS: NonNullable<WorkflowProjectNode["internals"]> = {
  locked: true,
  nodes: [
    {
      id: "normalize",
      kind: "agent",
      capability: "normalize",
      params: { language: "zh-CN", preserveSourceRefs: true },
      ui: {
        label: "Normalize Items",
        description: "统一字段，记录语言标注并保留来源引用（不翻译内容）",
        icon: "ArrowRightLeft",
        color: "var(--chart-2)",
        catalogId: "intelligence.processing.normalize",
        position: { x: 80, y: 120 },
      },
    },
    {
      id: "dedupe",
      kind: "agent",
      capability: "dedupe",
      params: { key: "title+source+publishedAt", window: "24h" },
      ui: {
        label: "Dedupe Items",
        description: "按稳定业务键和时间窗口去重",
        icon: "Filter",
        color: "var(--chart-2)",
        catalogId: "intelligence.processing.dedupe",
        position: { x: 400, y: 120 },
      },
    },
    {
      id: "record-acceptance",
      kind: "control",
      capability: "accept",
      params: {
        mode: "automatic_with_review",
        schema: "record.v1",
        dedupe: "required",
        lineageRequired: true,
        minQuality: 0,
      },
      ui: {
        label: "Record Acceptance Gate",
        description: "按 schema、质量和 lineage 接收 Record",
        icon: "BadgeCheck",
        color: "var(--chart-3)",
        catalogId: "intelligence.control.record-acceptance",
        position: { x: 720, y: 120 },
      },
    },
  ],
  edges: [
    {
      id: "normalize-dedupe",
      source: "normalize",
      target: "dedupe",
      sourcePort: "out",
      targetPort: "in",
    },
    {
      id: "dedupe-record-acceptance",
      source: "dedupe",
      target: "record-acceptance",
      sourcePort: "out",
      targetPort: "candidates",
    },
  ],
}

const JIN10_ADAPTER: AdapterBinding = {
  id: "jin10-kuaixun",
  type: "source",
  provider: "jin10",
  mode: "fixture",
  config: { feed: "kuaixun" },
}

const RSS_ADAPTER: AdapterBinding = {
  id: "rss-feed",
  type: "source",
  provider: "rss",
  mode: "live",
  config: { channel: "rss" },
}

const WEBHOOK_NOTIFY_ADAPTER: AdapterBinding = {
  id: "webhook-notifier",
  type: "notification",
  provider: "webhook",
  mode: "webhook",
  config: { notifierType: "webhook", target: "webhook" },
}

const TURBOPUSH_ADAPTER: AdapterBinding = {
  id: "turbopush-local",
  type: "notification",
  provider: "turbopush",
  mode: "live",
  config: { channel: "turbopush", mcpServer: "turbo-push", resourceMode: "auto" },
}

export type OpenCLISourceSlot = {
  id: string
  label: string
  sourceGroup: string
  site: string
  command: string
  args: Record<string, unknown>
  positionalArgs?: string[]
  adapterId?: string
  format?: string
  mode?: string
  profileId?: string
  profileBinding?: string
  sessionPolicy?: string
  workerTags?: string[]
  resourceTags?: string[]
}

export function isOpenCLISourceSlotArray(value: unknown): value is OpenCLISourceSlot[] {
  return Array.isArray(value) && value.every((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return false
    const slot = source as Record<string, unknown>
    return (
      typeof slot.id === "string" &&
      slot.id.trim().length > 0 &&
      typeof slot.label === "string" &&
      typeof slot.sourceGroup === "string" &&
      typeof slot.site === "string" &&
      slot.site.trim().length > 0 &&
      typeof slot.command === "string" &&
      slot.command.trim().length > 0 &&
      !!slot.args &&
      typeof slot.args === "object" &&
      !Array.isArray(slot.args)
    )
  })
}

export const DEFAULT_OPENCLI_HDA_SOURCES: OpenCLISourceSlot[] = [
  {
    id: "douyin",
    label: "Douyin Search",
    sourceGroup: "short-video",
    site: "douyin",
    command: "search",
    args: { query: "ai" },
  },
  {
    id: "bilibili",
    label: "Bilibili Search",
    sourceGroup: "video",
    site: "bilibili",
    command: "search",
    args: { limit: 20 },
    positionalArgs: ["ai"],
  },
  {
    id: "xiaohongshu",
    label: "Xiaohongshu Search",
    sourceGroup: "social",
    site: "xiaohongshu",
    command: "search",
    args: {},
    positionalArgs: ["ai"],
  },
  {
    id: "twitter",
    label: "Twitter Search",
    sourceGroup: "social",
    site: "twitter",
    command: "search",
    args: { query: "ai", product: "live" },
  },
]

export function opencliAdaptersForSourceSlots(sources: OpenCLISourceSlot[]): AdapterBinding[] {
  const adapters = sources.map((source) => ({
    id: source.adapterId ?? opencliAdapterId(source.site),
    type: "source" as const,
    provider: "opencli",
    mode: "live" as const,
    config: { channel: "opencli" },
  }))
  return Array.from(new Map(adapters.map((adapter) => [adapter.id, adapter])).values())
}

export function buildOpenCLIMultiSourceHDAInternals(
  sources: OpenCLISourceSlot[],
  options: { exposeRawSourceItems?: boolean } = {},
): WorkflowProjectNode["internals"] {
  const sourceGroups = sources.map((source) => source.sourceGroup || source.site)
  const sourcePoolNode = {
    id: "source-pool",
    kind: "agent" as const,
    capability: "normalize" as const,
    params: { sourceCount: sources.length, sourceGroups, fanout: "parallel" },
    ui: {
      label: "Source Pool",
      description: "Fanout source intent into parallel OpenCLI source slots",
      icon: "Network",
      color: "var(--chart-4)",
      catalogId: "intelligence.source.pool",
      position: { x: 0, y: Math.max(0, ((sources.length - 1) * 150) / 2) },
    },
  }
  const sourceNodes = sources.map((source, index) => ({
    id: opencliSourceNodeId(source),
    kind: "source" as const,
    capability: "fetch" as const,
    adapter: source.adapterId ?? opencliAdapterId(source.site),
    params: {
      site: source.site,
      command: source.command,
      args: source.args,
      ...(source.positionalArgs ? { positionalArgs: source.positionalArgs } : {}),
      sourceGroup: source.sourceGroup,
      ...(source.format ? { format: source.format } : {}),
      ...(source.mode ? { mode: source.mode } : {}),
      ...(source.profileId ? { profileId: source.profileId } : {}),
      ...(source.profileBinding ? { profileBinding: source.profileBinding } : {}),
      ...(source.sessionPolicy ? { sessionPolicy: source.sessionPolicy } : {}),
      ...(source.workerTags ? { workerTags: source.workerTags } : {}),
      ...(source.resourceTags ? { resourceTags: source.resourceTags } : {}),
    },
    ui: {
      label: source.label,
      description: `${source.site} ${source.command}`,
      icon: "Globe",
      color: "var(--chart-4)",
      catalogId: "intelligence.source.opencli-slot",
      position: { x: 280, y: index * 150 },
    },
  }))
  const midpointY = Math.max(0, ((sourceNodes.length - 1) * 150) / 2)
  const sourcePoolEdges = sourceNodes.map((sourceNode) => ({
    id: `source-pool-${sourceNode.id}`,
    source: "source-pool",
    target: sourceNode.id,
    sourcePort: "out",
    targetPort: "in",
  }))
  if (options.exposeRawSourceItems) {
    return {
      locked: true,
      nodes: [sourcePoolNode, ...sourceNodes],
      edges: sourcePoolEdges,
    }
  }
  const outputNode = {
    id: "collection-output",
    kind: "inbox" as const,
    capability: "store" as const,
    params: { queue: "opencli-hda-output", archive: false },
    ui: {
      label: "Collection Output",
      description: "Expose normalized items as the package output",
      icon: "Inbox",
      color: "var(--chart-4)",
      catalogId: "intelligence.output.collection-result",
      position: { x: 920, y: midpointY },
    },
  }
  return {
    locked: true,
    nodes: [
      sourcePoolNode,
      ...sourceNodes,
      {
        id: "internal-normalize",
        kind: "agent",
        capability: "normalize",
        params: { language: "zh-CN", preserveSourceRefs: true },
        ui: {
          label: "Normalize Items",
          description: "Normalize OpenCLI source slot results",
          icon: "ArrowRightLeft",
          color: "var(--chart-2)",
          catalogId: "intelligence.processing.normalize",
          position: { x: 620, y: midpointY },
        },
      },
      outputNode,
    ],
    edges: [
      ...sourcePoolEdges,
      ...sourceNodes.map((sourceNode) => ({
        id: `${sourceNode.id}-normalize`,
        source: sourceNode.id,
        target: "internal-normalize",
        sourcePort: "out",
        targetPort: "in",
      })),
      {
        id: "internal-normalize-output",
        source: "internal-normalize",
        target: "collection-output",
        sourcePort: "out",
        targetPort: "in",
      },
    ],
  }
}

function buildToolPackageInternals(
  toolId: string,
  executorMode: "situation_awareness" | "swarm_simulation",
  label: string,
  toolParams: Record<string, unknown>,
): WorkflowProjectNode["internals"] {
  return {
    locked: true,
    nodes: [
      {
        id: "tool",
        kind: "action",
        capability: "store",
        params: {
          toolCapability: {
            id: toolId,
            executor: { mode: executorMode, params: {} },
          },
          toolParams,
        },
        ui: {
          label,
          description: `${label} internal Tool Capability`,
          icon: executorMode === "situation_awareness" ? "Radar" : "Network",
          color: executorMode === "situation_awareness" ? "var(--chart-2)" : "var(--chart-5)",
          catalogId: "external.tool.capability",
          position: { x: 0, y: 0 },
        },
      },
      {
        id: "output",
        kind: "inbox",
        capability: "store",
        params: { queue: `${executorMode}-output`, archive: false },
        ui: {
          label: `${label} Output`,
          description: "Expose the complete result with workflow lineage",
          icon: "Inbox",
          color: "var(--chart-4)",
          catalogId: "intelligence.output.inbox",
          position: { x: 340, y: 0 },
        },
      },
    ],
    edges: [
      {
        id: "tool-output",
        source: "tool",
        target: "output",
        sourcePort: "out",
        targetPort: "in",
      },
    ],
  }
}

function opencliAdapterId(site: string): string {
  return `opencli-${safeIdPart(site)}`
}

function opencliSourceNodeId(source: OpenCLISourceSlot): string {
  return `source-${safeIdPart(source.id || source.sourceGroup || source.site)}`
}

function safeIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "source"
}

export const WORKFLOW_NODE_CATALOG: WorkflowNodeCatalogItem[] = [
  {
    id: COLLECTION_NEED_CATALOG_ID,
    idPrefix: "collection-need",
    label: "Collection Need",
    description: "用户只输入采集需求，由后端 demand-draft 组装真实节点 patch",
    category: "trigger",
    profile: "intelligence",
    kind: "schedule",
    capability: "trigger",
    icon: "MessageSquare",
    color: "var(--chart-1)",
    params: { text: "抓小红书热帖", locale: "zh-CN", mode: "demand-draft" },
    keywords: ["need", "demand", "input", "manual", "需求", "输入", "采集"],
  },
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
    id: "intelligence.source.rss",
    idPrefix: "source-rss",
    label: "RSS / Atom Source",
    description: "实时读取官方 RSS、RSSHub 或 RSS-Bridge feed，并以 sourceGroup 保留来源分组和血缘",
    category: "source",
    profile: "intelligence",
    kind: "source",
    capability: "fetch",
    icon: "Rss",
    color: "var(--chart-4)",
    adapter: RSS_ADAPTER.id,
    requiredAdapters: [RSS_ADAPTER],
    params: {
      feedUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
      maxEntries: 20,
      sourceGroup: "macro-policy",
      site: "federal-reserve",
    },
    keywords: ["rss", "atom", "rsshub", "rss-bridge", "bridge", "feed", "finance", "news", "财经", "订阅", "数据源"],
  },
  {
    id: "intelligence.processing.normalize",
    idPrefix: "normalize",
    label: "Normalize Items",
    description: "统一字段与时间格式，并记录语言标注（不翻译内容）",
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
    id: "intelligence.flow.merge",
    idPrefix: "merge",
    label: "Merge",
    description: "Houdini-style typed fan-in，合并多路候选流并保留 lineage",
    category: "flow",
    profile: "intelligence",
    kind: "flow",
    capability: "merge",
    icon: "GitMerge",
    color: "var(--chart-5)",
    params: {
      strategy: "concat",
      preserveLineage: true,
      inputType: "recordCandidate[]",
      outputType: "recordCandidate[]",
    },
    keywords: ["merge", "join", "fan-in", "lineage", "合并", "汇流"],
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
    id: "intelligence.control.record-acceptance",
    idPrefix: "record-acceptance",
    label: "Record Acceptance Gate",
    description: "把 Record Candidate 通过 schema、去重、质量和 lineage 检查后接收为 Record",
    category: "control",
    profile: "intelligence",
    kind: "control",
    capability: "accept",
    icon: "BadgeCheck",
    color: "var(--chart-3)",
    params: {
      mode: "automatic_with_review",
      schema: "record.v1",
      dedupe: "required",
      lineageRequired: true,
      minQuality: 0,
    },
    keywords: ["record", "acceptance", "gate", "quality", "lineage", "入库", "审核"],
  },
  {
    id: RECORD_HYGIENE_PACKAGE_CATALOG_ID,
    idPrefix: "pkg-record-hygiene",
    label: "Record Hygiene & Acceptance",
    description: "默认清洗管线：标准化、去重并通过 Record Acceptance Gate 准入",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "ShieldCheck",
    color: "var(--chart-2)",
    params: {
      template: "record-hygiene",
      lockedInternals: true,
      language: "zh-CN",
      preserveSourceRefs: true,
      key: "title+source+publishedAt",
      window: "24h",
      mode: "automatic_with_review",
      schema: "record.v1",
      lineageRequired: true,
      minQuality: 0,
    },
    topicCollapse: {
      groupId: "record-hygiene-package",
      nodeCount: 3,
      mode: "locked",
      packageInternal: true,
    },
    internals: RECORD_HYGIENE_INTERNALS,
    keywords: [
      "package",
      "record hygiene",
      "normalize",
      "dedupe",
      "acceptance",
      "cleaning",
      "记录清洗",
      "准入",
      "标准化",
      "去重",
    ],
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
    id: "intelligence.sink.records",
    idPrefix: "record-sink",
    label: "Record Sink",
    description: "把已接收的 Record 写入 records 系统，保留 lineage 和 run trace 指针",
    category: "sink",
    profile: "intelligence",
    kind: "sink",
    capability: "store",
    icon: "Database",
    color: "var(--chart-4)",
    params: { target: "records", writeMode: "append", preserveLineage: true },
    keywords: ["record", "sink", "database", "records", "落库", "存储"],
  },
  {
    id: "intelligence.output.webhook",
    idPrefix: "notify",
    label: "Webhook Notify",
    description: "通过后端 guarded webhook notifier 发送工作流通知",
    category: "output",
    profile: "intelligence",
    kind: "notify",
    capability: "send",
    icon: "Bell",
    color: "var(--chart-1)",
    adapter: WEBHOOK_NOTIFY_ADAPTER.id,
    requiredAdapters: [WEBHOOK_NOTIFY_ADAPTER],
    params: { template: "brief", target: "webhook" },
    keywords: ["feishu", "wecom", "tg", "telegram", "qq", "notify", "webhook", "通知"],
  },
  {
    id: TURBOPUSH_PUBLISH_CATALOG_ID,
    idPrefix: "turbopush-publish",
    label: "TurboPush Publish",
    description: "通过本机 TurboPush 服务发布文章/图文/视频到已登录平台账号",
    category: "output",
    profile: "intelligence",
    kind: "notify",
    capability: "send",
    icon: "Send",
    color: "var(--state-action)",
    adapter: TURBOPUSH_ADAPTER.id,
    requiredAdapters: [TURBOPUSH_ADAPTER],
    params: {
      contentType: "graph_text",
      contentSource: "upstream",
      title: "{{item.title}}",
      markdown: "{{item.markdown}}",
      desc: "{{item.summary}}",
      files: [],
      thumb: [],
      targetPlatforms: ["xiaohongshu"],
      accountSelector: "logged_accounts_by_platform",
      platformSettings: {},
      syncDraft: false,
    },
    keywords: [
      "turbopush",
      "publish",
      "send",
      "wechat",
      "douyin",
      "xiaohongshu",
      "youtube",
      "bilibili",
      "多平台",
      "发布",
      "发送",
    ],
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
    id: "intelligence.source.pool",
    idPrefix: "source-pool",
    label: "Source Pool",
    description: "把业务来源组展开为并行 source slots，资源由 runtime resolver 隐式处理",
    category: "source",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "Network",
    color: "var(--chart-4)",
    params: { sourceCount: 2, sourceGroups: ["video", "social"], fanout: "parallel" },
    keywords: ["source", "pool", "fanout", "registry", "来源池", "数据源"],
  },
  {
    id: "intelligence.source.opencli-slot",
    idPrefix: "source-opencli",
    label: "OpenCLI Source Slot",
    description: "一个由 HDA/source planner 生成的 OpenCLI source 槽位，运行时交给 OpenCLI channel 执行",
    category: "source",
    profile: "intelligence",
    kind: "source",
    capability: "fetch",
    icon: "Globe",
    color: "var(--chart-4)",
    params: { site: "bilibili", command: "search", sourceGroup: "video", args: { keyword: "ai" } },
    keywords: ["opencli", "source", "slot", "bilibili", "xiaohongshu", "adapter", "来源槽"],
  },
  {
    id: "intelligence.output.collection-result",
    idPrefix: "collection-output",
    label: "Collection Output",
    description: "把 HDA 内部标准化结果暴露为可审计的 items[] 输出",
    category: "output",
    profile: "intelligence",
    kind: "inbox",
    capability: "store",
    icon: "Inbox",
    color: "var(--chart-4)",
    params: { queue: "opencli-hda-output", archive: false },
    keywords: ["output", "items", "collection", "result", "采集输出", "结果"],
  },
  {
    id: "package.opencli.multi-source-hda",
    idPrefix: "pkg-opencli-hda",
    label: "多站点数据采集",
    description: "从选定网站并行采集数据，并整理为可审查、可追溯的结果",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "Network",
    color: "var(--chart-4)",
    requiredAdapters: opencliAdaptersForSourceSlots(DEFAULT_OPENCLI_HDA_SOURCES),
    params: {
      template: "opencli-multi-source",
      runtime: "iii",
      lockedInternals: true,
      execution: {
        fanout: "parallel",
      },
      sources: DEFAULT_OPENCLI_HDA_SOURCES,
      aiCallable: {
        schema: "opencli.multi_source_hda.v1",
        editable: ["sources", "sources[].args"],
        sourceMode: "parallel",
      },
    },
    topicCollapse: {
      groupId: "opencli-package",
      nodeCount: DEFAULT_OPENCLI_HDA_SOURCES.length + 3,
      mode: "locked",
      packageInternal: true,
    },
    internals: buildOpenCLIMultiSourceHDAInternals(DEFAULT_OPENCLI_HDA_SOURCES),
    keywords: ["package", "hda", "opencli", "bilibili", "xiaohongshu", "multi-source", "采集", "封装"],
  },
  {
    id: "package.intelligence.situation-awareness",
    idPrefix: "pkg-situation",
    label: "近 30 天事态感知",
    description: "独立研究能力：严格时间窗、去重、主题聚合、基线对比、异常信号和证据简报",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "Radar",
    color: "var(--chart-2)",
    params: {
      template: "situation-awareness",
      runtime: "iii",
      lockedInternals: true,
      provider: "opencli-native",
      query: "人工智能",
      windowDays: 30,
      baselineDays: 30,
      includeUnknownDates: false,
      topK: 10,
    },
    topicCollapse: {
      groupId: "situation-awareness-package",
      nodeCount: 2,
      mode: "locked",
      packageInternal: true,
    },
    internals: buildToolPackageInternals(
      "tool.intelligence.situation-awareness",
      "situation_awareness",
      "近 30 天事态感知",
      {
        provider: "opencli-native",
        query: "人工智能",
        windowDays: 30,
        baselineDays: 30,
        includeUnknownDates: false,
        topK: 10,
      },
    ),
    keywords: ["last30days", "research", "situation", "awareness", "事态感知", "近30天", "研究"],
  },
  {
    id: "package.intelligence.native-lifecycle",
    idPrefix: "pkg-native-intelligence",
    label: "Native Intelligence Lifecycle",
    description: "零凭据离线研究、知识图谱、推演、访谈、报告、问答与关闭；内部节点由后端能力注册表物化",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "Brain",
    color: "var(--chart-3)",
    params: {
      template: "native-intelligence-lifecycle",
      runtime: "iii",
      lockedInternals: true,
      offline: true,
      credentialFree: true,
      sourceMode: "offline_fixture",
      fixtureId: "native-intelligence-offline-v1",
    },
    topicCollapse: {
      groupId: "native-intelligence-lifecycle-package",
      nodeCount: 21,
      mode: "locked",
      packageInternal: true,
    },
    keywords: [
      "native",
      "intelligence",
      "offline",
      "research",
      "ontology",
      "graph",
      "simulation",
      "interview",
      "report",
      "qa",
    ],
  },
  {
    id: "package.simulation.swarm-forecast",
    idPrefix: "pkg-swarm",
    label: "群体智能推演",
    description: "独立推演能力：本地可复现模拟或固定版本 MiroFish provider，输出模拟轨迹和报告",
    category: "package",
    profile: "intelligence",
    kind: "agent",
    capability: "normalize",
    icon: "Network",
    color: "var(--chart-5)",
    params: {
      template: "swarm-forecast",
      runtime: "iii",
      lockedInternals: true,
      provider: "local",
      requirement: "推演事态在不同群体中的传播、立场变化和可能结果",
      agentCount: 12,
      maxRounds: 8,
      platforms: ["twitter", "reddit"],
      enableGraphMemoryUpdate: false,
    },
    topicCollapse: {
      groupId: "swarm-forecast-package",
      nodeCount: 2,
      mode: "locked",
      packageInternal: true,
    },
    internals: buildToolPackageInternals(
      "tool.simulation.swarm-forecast",
      "swarm_simulation",
      "群体智能推演",
      {
        provider: "local",
        requirement: "推演事态在不同群体中的传播、立场变化和可能结果",
        agentCount: 12,
        maxRounds: 8,
        platforms: ["twitter", "reddit"],
        enableGraphMemoryUpdate: false,
      },
    ),
    keywords: ["mirofish", "swarm", "simulation", "forecast", "群体智能", "推演", "模拟"],
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
    adapter: WEBHOOK_NOTIFY_ADAPTER.id,
    requiredAdapters: [WEBHOOK_NOTIFY_ADAPTER],
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

export function nativeIntelligenceCatalogItems(
  tools: WorkflowToolCapability[],
): WorkflowNodeCatalogItem[] {
  return tools.map((tool) => {
    const action =
      typeof tool.executor.params?.action === "string"
        ? tool.executor.params.action
        : tool.id.replace("tool.intelligence.native.", "")
    const runtimeContract =
      tool.manifest.runtimeContract &&
      typeof tool.manifest.runtimeContract === "object"
        ? (tool.manifest.runtimeContract as WorkflowRuntimeIOContract)
        : undefined
    const readiness =
      tool.manifest.readiness && typeof tool.manifest.readiness === "object"
        ? (tool.manifest.readiness as Record<string, unknown>)
        : {}
    const missing = Array.isArray(readiness.missingReasons)
      ? readiness.missingReasons.filter((value): value is string => typeof value === "string")
      : []
    return {
      id: `intelligence.native.${action}`,
      idPrefix: `native-${action.replaceAll(".", "-")}`,
      label: tool.label,
      description:
        tool.description ??
        `Native intelligence action ${action} with durable provenance and limits.`,
      category: action === "close" || action === "cancel" ? "control" : "processing",
      profile: "intelligence",
      kind: "action",
      capability: "store",
      icon: action.startsWith("report")
        ? "FileText"
        : action.startsWith("simulation")
          ? "Network"
          : action.startsWith("interviews")
            ? "MessageSquare"
            : "Brain",
      color: "var(--chart-3)",
      params: {
        toolCapability: {
          id: tool.id,
          executor: {
            mode: tool.executor.mode,
            params: tool.executor.params ?? { action },
          },
        },
        toolParams: {},
      },
      runtimeCapability: {
        id: `resource.tool-capability.${tool.id}`,
        label: tool.label,
        surface: "resource",
        status: tool.status,
        backendAvailable: tool.status === "runnable",
        kind: "action",
        capability: "store",
        provider: tool.provider,
        runtimeBinding: "workflow.external-tool.capability",
        reason: tool.description,
        missing,
        tags: tool.tags,
        source: "backend.workflow.tool_capabilities",
        manifest: tool.manifest,
      },
      runtimeContract,
      keywords: ["native", "intelligence", "offline", action, ...tool.tags],
    }
  })
}

export function getWorkflowNodeCatalog(
  profile: WorkflowProfile,
  capabilities?: WorkflowCapabilitiesResponse | null,
): WorkflowNodeCatalogItem[] {
  const staticCatalog = WORKFLOW_NODE_CATALOG.filter((item) => item.profile === profile).map((item) => {
    const runtimeCapability = projectedCatalogRuntimeCapability(
      catalogRuntimeCapability(capabilities, item.id),
      item,
      Boolean(capabilities),
    )
    return {
      ...item,
      runtimeCapability,
      runtimeContract: runtimeContractForCapability(runtimeCapability),
    }
  })
  if (profile !== "intelligence") return staticCatalog
  const dynamicBackendCatalog = (capabilities?.catalog ?? []).flatMap((runtimeCapability) => {
    const item = backendNodeCatalogItem(runtimeCapability)
    return item ? [item] : []
  })
  // The backend capability catalog is the source of truth once it is available.
  // Static entries remain only as an offline and legacy-workflow compatibility fallback.
  return dynamicBackendCatalog.length > 0 ? dynamicBackendCatalog : staticCatalog
}

export function workflowCatalogItemLocked(item: WorkflowNodeCatalogItem): boolean {
  const manifest = readCatalogRecord(item.runtimeCapability?.manifest)
  const canvas = readCatalogRecord(manifest?.canvas)
  return canvas?.locked === true
}

export function workflowCatalogPluginProvenance(
  item: WorkflowNodeCatalogItem,
): { providerKey: string; version: string } | null {
  const manifest = readCatalogRecord(item.runtimeCapability?.manifest)
  const plugin = readCatalogRecord(manifest?.plugin)
  const providerKey = typeof plugin?.providerKey === "string" ? plugin.providerKey : null
  const version = typeof plugin?.version === "string" ? plugin.version : null
  return providerKey && version ? { providerKey, version } : null
}

export function workflowCatalogIsBackendNode(item: WorkflowNodeCatalogItem): boolean {
  const manifest = readCatalogRecord(item.runtimeCapability?.manifest)
  const nodeCatalog = readCatalogRecord(manifest?.nodeCatalog)
  return nodeCatalog?.authority === "backend"
}

function backendNodeCatalogItem(
  runtimeCapability: WorkflowRuntimeCapability,
): WorkflowNodeCatalogItem | null {
  const manifest = readCatalogRecord(runtimeCapability.manifest)
  const nodeCatalog = readCatalogRecord(manifest?.nodeCatalog)
  const canvas = readCatalogRecord(manifest?.canvas)
  const legacyPlugin = runtimeCapability.source === "backend.services.plugin_registry_service"
  if (!legacyPlugin && (nodeCatalog?.authority !== "backend" || canvas?.node !== true)) return null
  const kind = catalogNodeKind(runtimeCapability.kind)
  const capability = catalogNodeCapability(runtimeCapability.capability)
  if (!kind || !capability) return null
  const plugin = readCatalogRecord(manifest?.plugin)
  const presentation = readCatalogRecord(manifest?.presentation)
  const providerKey = typeof plugin?.providerKey === "string"
    ? plugin.providerKey
    : runtimeCapability.provider ?? "opencli"
  const version = typeof plugin?.version === "string" ? plugin.version : "catalog"
  const category = typeof nodeCatalog?.category === "string"
    ? backendCatalogCategory(nodeCatalog.category)
    : pluginCatalogCategory(typeof plugin?.family === "string" ? plugin.family : "tool")
  const origin = typeof nodeCatalog?.origin === "string" ? nodeCatalog.origin : "plugin"
  const description = typeof presentation?.description === "string"
    ? presentation.description
    : runtimeCapability.reason ?? "后端节点能力"
  const icon = typeof presentation?.icon === "string"
    ? presentation.icon
    : backendCatalogIcon(category)
  return {
    id: runtimeCapability.id,
    idPrefix: safeIdPart(`${providerKey}-${runtimeCapability.label}`),
    label: runtimeCapability.label,
    description,
    category,
    profile: "intelligence",
    kind,
    capability,
    icon,
    color: "var(--muted-foreground)",
    params: {
      ...catalogParameterDefaults(presentation?.parameters),
      pluginInstallationId: plugin?.installationId,
      ...(origin === "plugin" ? { pluginProviderKey: providerKey, pluginVersion: version } : {}),
      pluginCapabilityId: plugin?.capabilityId,
    },
    runtimeCapability,
    runtimeContract: runtimeContractForCapability(runtimeCapability),
    keywords: [
      "node-capability",
      "dify",
      providerKey,
      version,
      category,
      origin,
      runtimeCapability.label,
      ...runtimeCapability.tags,
    ],
  }
}

function catalogNodeKind(value: string | null | undefined): WorkflowNodeKind | null {
  return ["schedule", "source", "agent", "router", "notify", "inbox", "action", "flow", "control", "sink"].includes(value ?? "")
    ? value as WorkflowNodeKind
    : null
}

function catalogNodeCapability(
  value: string | null | undefined,
): WorkflowCapability | null {
  return ["trigger", "fetch", "normalize", "dedupe", "summarize", "score", "tag", "route", "send", "store", "merge", "accept"].includes(value ?? "")
    ? value as WorkflowCapability
    : null
}

function pluginCatalogCategory(family: string): WorkflowNodeCatalogCategory {
  if (family === "trigger") return "trigger"
  if (family === "datasource") return "source"
  if (family === "agent_strategy") return "processing"
  return "output"
}

function backendCatalogCategory(value: string): WorkflowNodeCatalogCategory {
  if (value === "input" || value === "trigger") return "trigger"
  if (value === "knowledge") return "source"
  if (value === "logic") return "decision"
  if (value === "flow") return "flow"
  if (value === "human") return "control"
  if (value === "output") return "output"
  if (value === "compatibility") return "package"
  if (value === "tool" || value === "plugin") return "output"
  return "processing"
}

function backendCatalogIcon(category: WorkflowNodeCatalogCategory): string {
  if (category === "trigger") return "Clock"
  if (category === "source") return "Database"
  if (category === "decision") return "GitBranch"
  if (category === "flow") return "GitMerge"
  if (category === "control") return "BadgeCheck"
  if (category === "output") return "Send"
  if (category === "package") return "Package"
  return "Sparkles"
}

function catalogParameterDefaults(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {}
  return Object.fromEntries(value.flatMap((entry) => {
    const parameter = readCatalogRecord(entry)
    const name = typeof parameter?.name === "string" ? parameter.name : null
    return name && "default" in (parameter ?? {}) ? [[name, parameter?.default]] : []
  }))
}

function backendCatalogParameterInterface(
  nodeId: string,
  item: WorkflowNodeCatalogItem,
): ParameterInterface | undefined {
  if (!workflowCatalogIsBackendNode(item)) return undefined
  const manifest = readCatalogRecord(item.runtimeCapability?.manifest)
  const presentation = readCatalogRecord(manifest?.presentation)
  const parameters = presentation?.parameters
  if (!Array.isArray(parameters)) return undefined
  const fields = parameters.flatMap((entry, order): ParameterInterfaceField[] => {
    const parameter = readCatalogRecord(entry)
    const name = typeof parameter?.name === "string" ? parameter.name : null
    if (!parameter || !name) return []
    return [{
      id: name,
      label: typeof parameter.label === "string" ? parameter.label : name,
      groupId: "parameters",
      type: backendParameterFieldType(name, parameter),
      binding: { nodeId, source: "params", fieldId: name },
      order,
      value: "default" in parameter ? parameter.default : undefined,
      options: backendParameterOptions(parameter.options),
    }]
  })
  return fields.length > 0
    ? { groups: [{ id: "parameters", label: "参数", order: 1 }], fields }
    : undefined
}

function backendParameterFieldType(name: string, parameter: Record<string, unknown>): ParameterFieldType {
  const type = typeof parameter.type === "string" ? parameter.type : "string"
  if (type === "boolean") return "boolean"
  if (type === "number" || type === "integer") return "number"
  if (type === "select" && backendParameterOptions(parameter.options).length > 0) return "select"
  if (type === "array") return backendParameterOptions(parameter.options).length > 0 ? "tokens" : "textarea"
  if (type === "object" || type === "code" || /prompt|template|instruction|body|schema/i.test(name)) return "textarea"
  return "text"
}

function backendParameterOptions(value: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [{ value: entry, label: entry }]
    const option = readCatalogRecord(entry)
    const optionValue = typeof option?.value === "string" ? option.value : null
    if (!option || !optionValue) return []
    return [{ value: optionValue, label: typeof option.label === "string" ? option.label : optionValue }]
  })
}

function readCatalogRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function createWorkflowNodeFromCatalog(
  item: WorkflowNodeCatalogItem,
  id: string,
  position: { x: number; y: number },
): WorkflowProjectNode {
  const parameterInterface = backendCatalogParameterInterface(id, item)
    ?? (item.category === "package" && !item.internals
      ? undefined
      : createParameterInterfaceFromInternals(
        id,
        getNodeInternals({
          id,
          kind: item.kind,
          capability: item.capability,
          adapter: item.adapter,
          params: item.params,
          ui: { catalogId: item.id },
        }),
      ))

  return {
    id,
    kind: item.kind,
    capability: item.capability,
    adapter: item.adapter,
    params: cloneCatalogValue(item.params) ?? {},
    topicCollapse: cloneCatalogValue(item.topicCollapse),
    ...(parameterInterface ? { parameterInterface } : {}),
    internals: cloneCatalogValue(item.internals),
    ui: {
      label: item.label,
      description: item.description,
      icon: item.icon,
      color: item.color,
      position,
      catalogId: item.id,
      runtimeCapability: cloneCatalogValue(item.runtimeCapability),
      runtimeContract: cloneCatalogValue(item.runtimeContract),
    },
  }
}

export type WorkflowOperatorNodeOptions = {
  label?: string
  description?: string
}

/**
 * Build the Dify-style business layer without replacing the existing OpenCLI node.
 *
 * The operator is a structural/governance container (L1). The catalog node remains
 * intact as its implementation child (L2), including its adapter, parameter
 * interface, runtime contract, and deeper internal network.
 */
export function createOperatorNodeFromCatalog(
  item: WorkflowNodeCatalogItem,
  operatorId: string,
  implementationId: string,
  position: { x: number; y: number },
  options: WorkflowOperatorNodeOptions = {},
): WorkflowProjectNode {
  const implementation = createWorkflowNodeFromCatalog(item, implementationId, { x: 120, y: 160 })
  const implementationNode: WorkflowProjectNode = {
    ...implementation,
    ui: {
      ...implementation.ui,
      networkRole: "implementation",
    },
  }

  return {
    id: operatorId,
    kind: item.kind,
    capability: item.capability,
    params: {
      operator: {
        execution: "internals",
        implementationCatalogId: item.id,
        implementationNodeId: implementationId,
      },
    },
    internals: {
      locked: false,
      nodes: [implementationNode],
      edges: [],
    },
    miniNetwork: {
      nodes: 1,
      edges: 0,
      mode: "title-only",
    },
    ui: {
      label: options.label ?? item.label,
      description: options.description ?? `${item.description}；双击进入 OpenCLI 实现网络`,
      icon: item.icon,
      color: item.color,
      position,
      catalogId: item.id,
      preferCustomLabel: true,
      networkRole: "operator",
      implementationCatalogId: item.id,
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
    nodes: [
      ...project.nodes,
      item.category === "package"
        ? createOperatorNodeFromCatalog(item, id, `${id}-implementation`, position)
        : createWorkflowNodeFromCatalog(item, id, position),
    ],
  })
}

function cloneCatalogValue<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T)
}
