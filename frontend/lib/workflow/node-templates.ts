import type { AdapterBinding, WorkflowProjectNode } from "./schema"

export type NodeTemplateField =
  | {
      id: string
      source: "params"
      type: "text" | "textarea"
      label: string
      description?: string
      placeholder?: string
    }
  | {
      id: string
      source: "params"
      type: "number" | "slider"
      label: string
      description?: string
      min?: number
      max?: number
      step?: number
    }
  | {
      id: string
      source: "params"
      type: "boolean"
      label: string
      description?: string
    }
  | {
      id: string
      source: "params" | "adapter"
      type: "select"
      label: string
      description?: string
      options: { value: string; label: string }[]
    }
  | {
      id: string
      source: "params"
      type: "tokens"
      label: string
      description?: string
      options: { value: string; label: string }[]
    }

export type NodeTemplate = {
  id: string
  title: string
  summary: string
  dataShape: string
  fields: NodeTemplateField[]
}

const NODE_TEMPLATES: NodeTemplate[] = [
  {
    id: "intelligence.input.collection-need",
    title: "Collection Need",
    summary: "Turn a user's collection need into a reviewable real-node patch.",
    dataShape: "need -> trigger",
    fields: [
      {
        id: "text",
        source: "params",
        type: "textarea",
        label: "Need",
        placeholder: "抓小红书热帖",
      },
      {
        id: "locale",
        source: "params",
        type: "select",
        label: "Locale",
        options: [
          { value: "zh-CN", label: "zh-CN" },
          { value: "en-US", label: "en-US" },
        ],
      },
    ],
  },
  {
    id: "intelligence.schedule.cron",
    title: "Cron Schedule",
    summary: "Start the pipeline on a fixed interval.",
    dataShape: "clock -> trigger",
    fields: [
      { id: "interval", source: "params", type: "text", label: "Interval", placeholder: "5m" },
      { id: "timezone", source: "params", type: "select", label: "Timezone", options: timezoneOptions() },
    ],
  },
  {
    id: "intelligence.source.jin10",
    title: "JIN10 Source",
    summary: "Fetch JIN10 flash news from fixture now, live later when permissions allow it.",
    dataShape: "trigger -> items[]",
    fields: [
      {
        id: "mode",
        source: "adapter",
        type: "select",
        label: "Adapter Mode",
        description: "Keep fixture for deterministic QA; live needs network permission.",
        options: [
          { value: "fixture", label: "fixture" },
          { value: "live", label: "live" },
        ],
      },
      { id: "limit", source: "params", type: "number", label: "Limit", min: 1, max: 100, step: 1 },
      { id: "importantOnly", source: "params", type: "boolean", label: "Important only" },
      {
        id: "channel",
        source: "params",
        type: "select",
        label: "Channel",
        options: [{ value: "kuaixun", label: "kuaixun" }],
      },
    ],
  },
  {
    id: "intelligence.source.opencli-slot",
    title: "OpenCLI Source Slot",
    summary: "Fetch one selected source through the OpenCLI channel.",
    dataShape: "trigger -> items[]",
    fields: [
      { id: "site", source: "params", type: "text", label: "Site", placeholder: "bilibili" },
      { id: "command", source: "params", type: "text", label: "Command", placeholder: "search" },
      { id: "sourceGroup", source: "params", type: "text", label: "Source group", placeholder: "video" },
    ],
  },
  {
    id: "intelligence.agent.summary",
    title: "LLM Summary",
    summary: "Produce a concise operator brief from normalized items.",
    dataShape: "items[] -> summarizedItems[]",
    fields: [
      {
        id: "model",
        source: "params",
        type: "select",
        label: "Model",
        options: [
          { value: "deepseek", label: "DeepSeek" },
          { value: "gpt", label: "GPT" },
          { value: "claude", label: "Claude" },
        ],
      },
      {
        id: "style",
        source: "params",
        type: "select",
        label: "Style",
        options: [
          { value: "macro-brief", label: "macro brief" },
          { value: "risk-brief", label: "risk brief" },
          { value: "headline", label: "headline" },
        ],
      },
      { id: "maxChars", source: "params", type: "number", label: "Max chars", min: 80, max: 1200, step: 20 },
    ],
  },
  {
    id: "intelligence.agent.score",
    title: "Importance Score",
    summary: "Score each item by market impact, policy relevance, and urgency.",
    dataShape: "items[] -> scoredItems[]",
    fields: [
      { id: "threshold", source: "params", type: "slider", label: "Threshold", min: 0, max: 1, step: 0.05 },
      {
        id: "dimensions",
        source: "params",
        type: "tokens",
        label: "Dimensions",
        options: [
          { value: "market", label: "market" },
          { value: "policy", label: "policy" },
          { value: "urgency", label: "urgency" },
          { value: "liquidity", label: "liquidity" },
        ],
      },
    ],
  },
  {
    id: "intelligence.router.importance",
    title: "Importance Router",
    summary: "Route important items to notification and everything useful to review.",
    dataShape: "scoredItems[] -> review | notify",
    fields: [
      {
        id: "expression",
        source: "params",
        type: "textarea",
        label: "Expression",
        description: "Return true for high-signal items.",
      },
    ],
  },
  {
    id: "intelligence.output.webhook",
    title: "Webhook Notify",
    summary: "Preview outbound notification payloads without sending real messages.",
    dataShape: "items[] -> mock delivery",
    fields: [
      {
        id: "mode",
        source: "adapter",
        type: "select",
        label: "Adapter Mode",
        options: [
          { value: "mock", label: "mock" },
          { value: "webhook", label: "webhook" },
        ],
      },
      { id: "target", source: "params", type: "text", label: "Target" },
      {
        id: "template",
        source: "params",
        type: "select",
        label: "Template",
        options: [
          { value: "brief", label: "brief" },
          { value: "full", label: "full" },
          { value: "headline", label: "headline" },
        ],
      },
    ],
  },
  {
    id: "intelligence.output.turbopush-publish",
    title: "TurboPush Publish",
    summary: "Publish content through the local TurboPush service and logged accounts.",
    dataShape: "items[] -> delivery",
    fields: [
      {
        id: "contentType",
        source: "params",
        type: "select",
        label: "Content Type",
        options: turboPushContentTypeOptions(),
      },
      {
        id: "contentSource",
        source: "params",
        type: "select",
        label: "Content Source",
        options: [
          { value: "upstream", label: "upstream" },
          { value: "inline", label: "inline" },
          { value: "existing_article", label: "existing article" },
        ],
      },
      { id: "title", source: "params", type: "text", label: "Title" },
      { id: "markdown", source: "params", type: "textarea", label: "Markdown" },
      { id: "desc", source: "params", type: "textarea", label: "Description" },
      {
        id: "targetPlatforms",
        source: "params",
        type: "tokens",
        label: "Platforms",
        options: turboPushPlatformOptions(),
      },
      {
        id: "accountSelector",
        source: "params",
        type: "select",
        label: "Accounts",
        options: [
          { value: "logged_accounts_by_platform", label: "logged accounts by platform" },
          { value: "all_logged", label: "all logged accounts" },
        ],
      },
      { id: "syncDraft", source: "params", type: "boolean", label: "Sync Draft" },
    ],
  },
]

export function getNodeTemplate(node: WorkflowProjectNode | undefined): NodeTemplate | undefined {
  const catalogId = node?.ui?.catalogId
  if (typeof catalogId === "string") return NODE_TEMPLATES.find((template) => template.id === catalogId)

  if (!node) return undefined
  return NODE_TEMPLATES.find((template) => {
    if (template.id === "intelligence.input.collection-need") {
      return isCollectionNeedNode(node)
    }
    if (template.id === "intelligence.schedule.cron") return node.kind === "schedule" && node.capability === "trigger"
    if (template.id === "intelligence.source.jin10") return node.kind === "source" && node.adapter === "jin10-kuaixun"
    if (template.id === "intelligence.source.opencli-slot") return node.kind === "source" && Boolean(node.adapter?.startsWith("opencli-"))
    if (template.id === "intelligence.agent.summary") return node.kind === "agent" && node.capability === "summarize"
    if (template.id === "intelligence.agent.score") return node.kind === "agent" && node.capability === "score"
    if (template.id === "intelligence.router.importance") return node.kind === "router" && node.capability === "route"
    if (template.id === "intelligence.output.turbopush-publish") return node.kind === "notify" && Boolean(node.adapter?.startsWith("turbopush"))
    if (template.id === "intelligence.output.webhook") return node.kind === "notify"
    return false
  })
}

export function readTemplateFieldValue(
  node: WorkflowProjectNode,
  adapter: AdapterBinding | undefined,
  field: NodeTemplateField,
): unknown {
  if (field.source === "adapter") {
    if (field.id === "mode") return adapter?.mode
    return adapter?.config[field.id]
  }
  return node.params[field.id]
}

function timezoneOptions() {
  return [
    { value: "Asia/Shanghai", label: "Asia/Shanghai" },
    { value: "UTC", label: "UTC" },
    { value: "America/New_York", label: "America/New_York" },
  ]
}

function turboPushContentTypeOptions() {
  return [
    { value: "article", label: "article" },
    { value: "graph_text", label: "graph text" },
    { value: "video", label: "video" },
  ]
}

function turboPushPlatformOptions() {
  return [
    { value: "wechat", label: "wechat" },
    { value: "wechat-video", label: "wechat-video" },
    { value: "douyin", label: "douyin" },
    { value: "toutiaohao", label: "toutiaohao" },
    { value: "kuaishou", label: "kuaishou" },
    { value: "xiaohongshu", label: "xiaohongshu" },
    { value: "bilibili", label: "bilibili" },
    { value: "zhihu", label: "zhihu" },
    { value: "sina", label: "sina" },
    { value: "csdn", label: "csdn" },
    { value: "juejin", label: "juejin" },
    { value: "jianshuhao", label: "jianshuhao" },
    { value: "tiktok", label: "tiktok" },
    { value: "youtube", label: "youtube" },
    { value: "x", label: "x" },
    { value: "pinduoduo", label: "pinduoduo" },
    { value: "acfun", label: "acfun" },
    { value: "omtencent", label: "omtencent" },
    { value: "weishi", label: "weishi" },
    { value: "baijiahao", label: "baijiahao" },
  ]
}

function isCollectionNeedNode(node: WorkflowProjectNode): boolean {
  if (node.ui?.catalogId === "intelligence.input.collection-need") return true
  if (node.kind !== "schedule" || node.capability !== "trigger") return false
  if (node.params.mode === "demand-draft") return true
  return hasNeedShape(node.params) && !hasScheduleShape(node.params)
}

function hasNeedShape(params: Record<string, unknown>): boolean {
  return typeof params.text === "string" || typeof params.locale === "string"
}

function hasScheduleShape(params: Record<string, unknown>): boolean {
  return typeof params.interval === "string" || typeof params.timezone === "string"
}
