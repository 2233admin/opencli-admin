import type {
  GeneratedWorkflowCapabilityGap,
  GeneratedWorkflowEdge,
  GeneratedWorkflowNode,
  GeneratedWorkflowNodeType,
  GeneratedWorkflowReadiness,
  GeneratedWorkflowSpec,
} from "./types"

export type ExtractedWorkflowSchedule = {
  cadence: "realtime" | "minutes" | "hourly" | "daily" | "weekdays" | "weekly"
  config: string
  label: string
}

const URL_PATTERN = /https?:\/\/[^\s，。；、）)]+/gi
const NAMED_SOURCE_PATTERN = /小红书|微博|知乎|微信公众号|公众号|哔哩哔哩|B站|GitHub|YouTube|抖音|快手|金十|Jin10/gi

export function extractWorkflowSource(prompt: string): string | null {
  const urls = Array.from(prompt.matchAll(URL_PATTERN), (match) => match[0])
  const sourceUrls = urls.filter((url) => !/(?:hooks?|webhook)/i.test(url))
  if (sourceUrls.length) return sourceUrls.at(-1) ?? null
  const namedSources = Array.from(prompt.matchAll(NAMED_SOURCE_PATTERN), (match) => match[0])
  return namedSources.at(-1) ?? null
}

export function extractWorkflowSchedule(prompt: string): ExtractedWorkflowSchedule | null {
  const candidates: Array<{ schedule: ExtractedWorkflowSchedule | null; index: number; priority: number }> = []
  const add = (pattern: RegExp, build: (match: RegExpMatchArray) => ExtractedWorkflowSchedule | null, priority = 0) => {
    for (const match of prompt.matchAll(pattern)) candidates.push({ schedule: build(match), index: match.index ?? 0, priority })
  }

  add(/每\s*(\d{1,3})\s*分钟/g, (match) => {
    const minutes = Number(match[1])
    if (minutes < 1 || minutes > 59) return null
    return { cadence: "minutes", config: `cron: */${minutes} * * * *`, label: `每 ${minutes} 分钟触发` }
  }, 3)
  add(/每小时/g, () => ({ cadence: "hourly", config: "cron: 0 * * * *", label: "每小时触发" }), 3)
  add(/(?:每天|每日)\s*(?:(早上|上午|下午|晚上)\s*)?(\d{1,2})(?:\s*[点:：]\s*(\d{1,2}))?/g, (match) => {
    const clock = parseScheduleClock(match[2], match[3], match[1])
    if (!clock) return null
    const { hour, minute } = clock
    return { cadence: "daily", config: `cron: ${minute} ${hour} * * *`, label: `每天 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} 触发` }
  }, 4)
  add(/(?:工作日|每个工作日)\s*(?:(早上|上午|下午|晚上)\s*)?(\d{1,2})(?:\s*[点:：]\s*(\d{1,2}))?/g, (match) => {
    const clock = parseScheduleClock(match[2], match[3], match[1])
    if (!clock) return null
    const { hour, minute } = clock
    return { cadence: "weekdays", config: `cron: ${minute} ${hour} * * 1-5`, label: `工作日 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} 触发` }
  }, 4)
  add(/(?:每周|每星期)\s*([一二三四五六日天])\s*(?:(早上|上午|下午|晚上)\s*)?(\d{1,2})(?:\s*[点:：]\s*(\d{1,2}))?/g, (match) => {
    const clock = parseScheduleClock(match[3], match[4], match[2])
    if (!clock) return null
    const day = ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 } as const)[match[1] as "一" | "二" | "三" | "四" | "五" | "六" | "日" | "天"]
    const { hour, minute } = clock
    return { cadence: "weekly", config: `cron: ${minute} ${hour} * * ${day}`, label: `每周${match[1]} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} 触发` }
  }, 4)
  add(/(?:实时|持续监测|持续监听)/g, () => ({ cadence: "realtime", config: "event: realtime", label: "实时触发" }), 2)

  const selected = candidates.sort((left, right) => right.index - left.index || right.priority - left.priority)[0]
  return selected?.schedule ?? null
}

function parseScheduleClock(hourValue: string, minuteValue?: string, period?: string) {
  let hour = Number(hourValue)
  const minute = Number(minuteValue ?? 0)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  if (/(下午|晚上)/.test(period ?? "") && hour < 12) hour += 12
  if (hour > 23) return null
  return { hour, minute }
}

/**
 * 规则式工作流生成回退。
 * 当 AI Gateway 不可用（例如未配置额度）时，根据关键字启发式地
 * 构造一个合理的工作流，保证「AI 生成」功能始终可用。
 */
export function generateWorkflowLocally(prompt: string): GeneratedWorkflowSpec {
  const text = prompt.toLowerCase()
  const source = extractWorkflowSource(prompt)
  const schedule = extractWorkflowSchedule(prompt)
  const nodes: GeneratedWorkflowNode[] = []
  const edges: GeneratedWorkflowEdge[] = []
  const capabilityGaps: GeneratedWorkflowCapabilityGap[] = []
  let counter = 0
  const nextId = () => `n${++counter}`

  const push = (node: Omit<GeneratedWorkflowNode, "id">): string => {
    const id = nextId()
    nodes.push({ id, ...node })
    return id
  }

  const explicitlyManual = /(?:一次性|一次查询|手动|manual|one[- ]?time)/i.test(prompt)
  const mode = schedule ? (explicitlyManual ? "hybrid" : "scheduled") : "one_time"
  const triggerIds: string[] = []
  if (!schedule || explicitlyManual) {
    triggerIds.push(push({
      type: "manual-trigger",
      label: "Manual Trigger",
      description: "手动提交运行参数后触发一次 Run",
      config: "manual",
      params: { inputSchema: { type: "object", additionalProperties: true }, presets: [] },
      outputMode: "single",
      readiness: "ready",
      recentStatus: "idle",
    }))
  }
  if (schedule) {
    triggerIds.push(push({
      type: "schedule-trigger",
      label: "Schedule Trigger",
      description: schedule.label,
      config: schedule.config,
      params: {
        interval: schedule.config.replace(/^cron:\s*/, ""),
        timezone: "Asia/Shanghai",
        overlap: "coalesce-one-pending",
        missedRuns: "skip",
      },
      outputMode: "single",
      readiness: "ready",
      recentStatus: "idle",
    }))
  }

  let entryIds = triggerIds
  if (triggerIds.length > 1) {
    const mergeId = push({
      type: "merge",
      label: "Merge Entrances",
      description: "显式合并手动与定时入口；每次触发仍创建独立 Run",
      config: "available",
      params: { strategy: "available", preserveLineage: true },
      inputMode: "batch",
      outputMode: "batch",
      readiness: "ready",
      recentStatus: "idle",
    })
    for (const triggerId of triggerIds) edges.push(createMappedEdge(triggerId, mergeId, text))
    entryIds = [mergeId]
  }

  const agentIds: string[] = []
  const apiRequested = Boolean(source && /^https?:\/\//i.test(source)) || /(?:api agent|api|接口|http|抓取|查询|fetch|请求)/i.test(prompt)
  const opencliRequested = /opencli/i.test(prompt) || Boolean(source && !/^https?:\/\//i.test(source))
  const governedToolRequested = /(?:governed tool|受管工具|治理工具|tool agent)/i.test(prompt)
  const transformRequested = /(?:llm transform|llm|摘要|总结|转换|清洗|summar|transform)/i.test(prompt)

  if (apiRequested) {
    const endpoint = source && /^https?:\/\//i.test(source) ? source : undefined
    const id = pushAgent("api-agent", "API Agent", endpoint ? `调用 ${endpoint}` : "API endpoint 尚待配置", {
      endpoint,
      method: "GET",
    })
    agentIds.push(id)
    if (!endpoint) addGap(id, "configuration", "API endpoint 未配置", "为 API Agent 绑定可调用的 URL。")
  }
  if (opencliRequested) {
    const namedSource = source && !/^https?:\/\//i.test(source) ? source : extractNamedSource(prompt)
    const id = pushAgent("opencli-agent", "OpenCLI Agent", namedSource ? `通过 OpenCLI 查询 ${namedSource}` : "OpenCLI site/command 尚待配置", {
      site: namedSource?.toLowerCase(),
      command: "search",
      args: { keyword: inferSearchKeyword(prompt) },
    })
    agentIds.push(id)
    if (!namedSource) addGap(id, "configuration", "OpenCLI 来源未配置", "为 OpenCLI Agent 选择 site 与 command。")
  }
  if (governedToolRequested) {
    const toolName = prompt.match(/(?:tool|工具)\s*[:：]?\s*([\w.-]+)/i)?.[1]
    const id = pushAgent("governed-tool-agent", "Governed Tool Agent", toolName ? `调用受管工具 ${toolName}` : "受管工具尚待绑定", {
      tool: toolName,
      permission: "explicit",
    })
    agentIds.push(id)
    if (!toolName) addGap(id, "connection", "受管工具未绑定", "选择一个已治理、已授权的 Tool Definition。")
  }
  if (transformRequested) {
    agentIds.push(pushAgent("llm-transform-agent", "LLM Transform Agent", "转换并总结上游结构化结果", {
      model: "workspace-default",
      instruction: "summarize",
      preserveRaw: true,
    }))
  }
  if (agentIds.length === 0) {
    const id = pushAgent("api-agent", "API Agent", "数据来源尚待配置", { method: "GET" })
    agentIds.push(id)
    addGap(id, "configuration", "数据来源未配置", "为 API Agent 补充网站、API、RSS 或具体链接。")
  }

  let previousIds = entryIds
  for (const agentId of agentIds) {
    for (const previousId of previousIds) edges.push(createMappedEdge(previousId, agentId, text))
    previousIds = [agentId]
  }

  if (/(?:校验|判断|优先级|条件|如果|是否|valid|priority|\bif\b)/i.test(prompt)) {
    const routerId = push({
      type: "router",
      label: "Router",
      description: "按显式条件路由结果",
      config: "condition === true",
      params: { expression: "condition === true" },
      inputMode: "batch",
      outputMode: "batch",
      readiness: "ready",
      recentStatus: "idle",
    })
    for (const previousId of previousIds) edges.push(createMappedEdge(previousId, routerId, text))
    previousIds = [routerId]
  }

  const outputIds: string[] = []
  const recordsRequested = /(?:records?|保存|记录|内部结果|落库)/i.test(prompt)
  const emailRequested = /(?:邮件|email|mail)/i.test(prompt)
  const webhookRequested = /(?:webhook|hooks?\.)/i.test(prompt)
  const hasExplicitOutput = recordsRequested || emailRequested || webhookRequested

  if (recordsRequested || !hasExplicitOutput) {
    outputIds.push(push({
      type: "records-output",
      label: "Records",
      description: "保存本次 Run 的内部结构化结果与 lineage",
      config: "records",
      params: { target: "records", writeMode: "append", preserveLineage: true },
      inputMode: "batch",
      readiness: "ready",
      recentStatus: "idle",
      outputStatus: "idle",
    }))
  }
  if (emailRequested) {
    const to = extractEmail(prompt)
    const id = push({
      type: "email-output",
      label: "Email",
      description: to ? `发送到 ${to}` : "收件人尚待配置",
      config: to ?? "email: pending-recipient",
      params: { channel: "email", ...(to ? { to } : {}), template: "brief" },
      inputMode: "batch",
      readiness: to ? "ready" : "incomplete",
      recentStatus: "idle",
      outputStatus: "idle",
    })
    outputIds.push(id)
    if (!to) addGap(id, "configuration", "Email 收件人未配置", "为 Email 输出填写有效收件地址。")
  }
  if (webhookRequested) {
    const url = extractWebhookUrl(prompt)
    const id = push({
      type: "webhook-output",
      label: "Webhook",
      description: url ? `发送到 ${url}` : "Webhook URL 尚待配置",
      config: url ?? "webhook: pending-url",
      params: { channel: "webhook", ...(url ? { url, target: url } : {}), template: "brief" },
      inputMode: "batch",
      readiness: url ? "ready" : "incomplete",
      recentStatus: "idle",
      outputStatus: "idle",
    })
    outputIds.push(id)
    if (!url) addGap(id, "connection", "Webhook URL 未配置", "为 Webhook 输出绑定有效 URL。")
  }

  for (const previousId of previousIds) {
    for (const outputId of outputIds) edges.push(createMappedEdge(previousId, outputId, text))
  }

  for (const edge of edges.filter((candidate) => candidate.mapping?.compatible === false)) {
    const target = nodes.find((node) => node.id === edge.target)
    addGap(
      edge.target,
      "mapping",
      "字段映射不兼容",
      `边 ${edge.source} -> ${edge.target} 存在字段类型冲突；请添加显式 Transform 或覆盖映射。`,
    )
    if (target) target.readiness = "blocked"
  }

  const spec: GeneratedWorkflowSpec = {
    version: 1,
    title: prompt.slice(0, 40) || "自动化工作流",
    intent: { mode, execution: "batch", acyclic: true },
    executionPolicy: {
      crossRunState: "none",
      branchFailure: "isolate-descendants",
      outputFailureStatus: "partial_success",
    },
    envelope: {
      contract: "typed-envelope.v1",
      fields: ["data", "schema", "metadata", "provenance", "trace"],
      rawPath: "data.raw",
      execution: "batch",
    },
    nodes,
    edges,
    capabilityGaps,
    readiness: readinessFromGaps(capabilityGaps),
  }
  return spec

  function pushAgent(
    type: Extract<GeneratedWorkflowNodeType, `${string}-agent`>,
    label: string,
    description: string,
    params: Record<string, unknown>,
  ) {
    const kind = type.replace(/-agent$/, "") as "api" | "opencli" | "governed-tool" | "llm-transform"
    return push({
      type,
      label,
      description,
      config: Object.values(params).find((value) => typeof value === "string") as string | undefined,
      params,
      definitionRef: { kind, id: `workspace.${kind}.default`, version: "1" },
      inputMode: "batch",
      outputMode: "batch",
      retryPolicy: { maxAttempts: 3, backoff: "exponential" },
      readiness: "ready",
      recentStatus: "idle",
    })
  }

  function addGap(
    nodeId: string,
    capability: GeneratedWorkflowCapabilityGap["capability"],
    title: string,
    detail: string,
  ) {
    const id = `gap-${capabilityGaps.length + 1}`
    capabilityGaps.push({ id, nodeId, capability, title, detail, blockingActions: ["publish", "run"] })
    const node = nodes.find((candidate) => candidate.id === nodeId)
    if (node) {
      node.readiness = "incomplete"
      node.capabilityGapIds = [...(node.capabilityGapIds ?? []), id]
    }
  }
}

export function analyzeGeneratedWorkflowReadiness(spec: GeneratedWorkflowSpec): GeneratedWorkflowReadiness {
  const declaredGaps = spec.capabilityGaps ?? []
  const mappingGaps = spec.edges.flatMap((edge, index) => {
    if (edge.mapping?.compatible !== false) return []
    const existing = declaredGaps.find((gap) => gap.capability === "mapping" && gap.detail.includes(edge.source) && gap.detail.includes(edge.target))
    if (existing) return [existing]
    return [{
      id: `gap-mapping-${index + 1}`,
      capability: "mapping" as const,
      title: "字段映射不兼容",
      detail: `边 ${edge.source} -> ${edge.target} 存在字段类型冲突。`,
      blockingActions: ["publish", "run"] as Array<"publish" | "run">,
    }]
  })
  const gaps = Array.from(new Map([...declaredGaps, ...mappingGaps].map((gap) => [gap.id, gap])).values())
  return readinessFromGaps(gaps)
}

function readinessFromGaps(gaps: GeneratedWorkflowCapabilityGap[]): GeneratedWorkflowReadiness {
  const blockingGapIds = gaps
    .filter((gap) => gap.blockingActions.includes("publish") || gap.blockingActions.includes("run"))
    .map((gap) => gap.id)
  return {
    status: blockingGapIds.length > 0 ? "incomplete" : "ready",
    canSave: true,
    canPublish: !gaps.some((gap) => gap.blockingActions.includes("publish")),
    canRun: !gaps.some((gap) => gap.blockingActions.includes("run")),
    blockingGapIds,
  }
}

function createMappedEdge(source: string, target: string, prompt: string): GeneratedWorkflowEdge {
  const incompatible = /(?:字段类型冲突|mapping incompatible|映射不兼容)/i.test(prompt)
  return {
    source,
    target,
    mapping: {
      mode: /(?:手动映射|override mapping|mapping override)/i.test(prompt) ? "override" : "auto",
      fields: [],
      preserveRaw: true,
      compatible: !incompatible,
      conflicts: incompatible ? ["源字段与目标字段类型不兼容，需要显式 Transform 或映射覆盖。"] : [],
    },
  }
}

function extractNamedSource(prompt: string): string | undefined {
  return Array.from(prompt.matchAll(NAMED_SOURCE_PATTERN), (match) => match[0]).at(-1)
}

function extractEmail(prompt: string): string | undefined {
  return prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
}

function extractWebhookUrl(prompt: string): string | undefined {
  return Array.from(prompt.matchAll(URL_PATTERN), (match) => match[0]).find((url) => /(?:hooks?|webhook)/i.test(url))
}

function inferSearchKeyword(prompt: string): string {
  return prompt.match(/(?:搜索|查询)\s*([^，。；、]+)/)?.[1]?.trim() || "待配置关键词"
}
