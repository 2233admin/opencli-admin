type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export type WorkflowOpenCLIAdapterNodeArg = {
  name: string
  type?: string | null
  required: boolean
  valueRequired: boolean
  positional: boolean
  choices: unknown[]
  default?: unknown
  help?: string | null
}

export type WorkflowOpenCLIAdapterNode = {
  id: string
  label: string
  description: string
  status: "runnable" | "blocked" | "preview_only" | "design_only"
  site: string
  command: string
  access: string
  browser: boolean
  strategy?: string | null
  domain?: string | null
  catalogId: string
  kind: string
  capability: string
  requiredArgs: string[]
  args: WorkflowOpenCLIAdapterNodeArg[]
  adapter: Record<string, unknown>
  params: Record<string, unknown>
  manifest: Record<string, unknown>
}

export type WorkflowOpenCLIAdapterNodesResponse = {
  total: number
  summary: Record<string, unknown>
  nodes: WorkflowOpenCLIAdapterNode[]
}

type FeaturedOpenCLISource = {
  id: string
  label: string
  description: string
}

const FEATURED_OPENCLI_SOURCES: FeaturedOpenCLISource[] = [
  { id: "opencli.adapter.eastmoney.gridlist", label: "东方财富 · A 股行情全景", description: "实时市场行情、成交额与涨跌幅数据" },
  { id: "opencli.adapter.cls.telegraph", label: "财联社 · 实时电报", description: "财经突发与盘中快讯" },
  { id: "opencli.adapter.sinafinance.news", label: "新浪财经 · 财经新闻", description: "财经新闻与市场资讯" },
  { id: "opencli.adapter.jin10.kuaixun", label: "金十数据 · 财经快讯", description: "宏观、外汇和财经快讯" },
  { id: "opencli.adapter.cninfo.disclosure", label: "巨潮资讯 · 上市公司公告", description: "A 股公司公告与披露信息" },
  { id: "opencli.adapter.wallstreetcn.live", label: "华尔街见闻 · 实时快讯", description: "全球市场实时资讯" },
  { id: "opencli.adapter.bilibili.search", label: "哔哩哔哩 · 内容搜索", description: "视频内容与公开讨论搜索" },
  { id: "opencli.adapter.xiaohongshu.search", label: "小红书 · 内容搜索", description: "公开内容与消费趋势搜索" },
]

export function featuredOpenCLIAdapterNodes(
  nodes: WorkflowOpenCLIAdapterNode[],
): WorkflowOpenCLIAdapterNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return FEATURED_OPENCLI_SOURCES.flatMap((featured) => {
    const node = byId.get(featured.id)
    return node ? [node] : []
  })
}

export function openCLIAdapterNodePresentation(
  node: WorkflowOpenCLIAdapterNode,
): { label: string; description: string } {
  const featured = FEATURED_OPENCLI_SOURCES.find((candidate) => candidate.id === node.id)
  return featured ?? {
    label: node.label,
    description: node.description || `实时执行 opencli ${node.site} ${node.command}`,
  }
}

export async function fetchWorkflowOpenCLIAdapterNodes(
  options: {
    authorization?: string | null
    site?: string
    q?: string
    includeWrite?: boolean
    limit?: number
    refresh?: boolean
    signal?: AbortSignal
  } = {},
): Promise<WorkflowOpenCLIAdapterNodesResponse> {
  const params = new URLSearchParams()
  if (options.site) params.set("site", options.site)
  if (options.q) params.set("q", options.q)
  if (typeof options.includeWrite === "boolean") {
    params.set("includeWrite", String(options.includeWrite))
  }
  if (typeof options.limit === "number") params.set("limit", String(options.limit))
  if (typeof options.refresh === "boolean") params.set("refresh", String(options.refresh))
  const query = params.toString()
  const response = await fetch(`/api/workflow/opencli-adapter-nodes${query ? `?${query}` : ""}`, {
    headers: {
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    cache: "no-store",
    signal: options.signal,
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<WorkflowOpenCLIAdapterNodesResponse> | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message ?? payload?.error ?? `OpenCLI adapter node fetch failed (${response.status})`)
  }
  return payload.data
}

export function workflowCatalogItemForOpenCLIAdapterNode(
  node: WorkflowOpenCLIAdapterNode,
  requiredValues: Record<string, string> = {},
): WorkflowNodeCatalogItem {
  const presentation = openCLIAdapterNodePresentation(node)
  const args = { ...((node.params.args as Record<string, unknown> | undefined) ?? {}) }
  const positionalArgs = Array.isArray(node.params.positional_args)
    ? [...node.params.positional_args]
    : []
  for (const arg of node.args) {
    const value = requiredValues[arg.name]
    if (!value) continue
    if (arg.positional) positionalArgs.push(value)
    else args[arg.name] = value
  }
  const adapter = node.adapter as AdapterBinding
  return {
    id: node.catalogId,
    idPrefix: `source-opencli-${safeIdPart(node.site)}-${safeIdPart(node.command)}`,
    label: presentation.label,
    description: presentation.description,
    category: "source",
    profile: "intelligence",
    kind: "source",
    capability: "fetch",
    icon: "Globe",
    color: "var(--chart-4)",
    adapter: adapter.id,
    requiredAdapters: [adapter],
    params: {
      ...node.params,
      args,
      ...(positionalArgs.length ? { positional_args: positionalArgs } : {}),
      opencliAdapterNodeId: node.id,
      sourceGroup: node.site,
    },
    keywords: [
      "opencli",
      "realtime",
      "实时",
      "采集",
      node.site,
      node.command,
      node.label,
      node.description,
    ].filter(Boolean),
  }
}

function safeIdPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "source"
}
import type { AdapterBinding } from "./schema"
import type { WorkflowNodeCatalogItem } from "./node-catalog"
