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

export async function fetchWorkflowOpenCLIAdapterNodes(
  options: {
    authorization?: string | null
    site?: string
    q?: string
    includeWrite?: boolean
    limit?: number
  } = {},
): Promise<WorkflowOpenCLIAdapterNodesResponse> {
  const params = new URLSearchParams()
  if (options.site) params.set("site", options.site)
  if (options.q) params.set("q", options.q)
  if (typeof options.includeWrite === "boolean") {
    params.set("includeWrite", String(options.includeWrite))
  }
  if (typeof options.limit === "number") params.set("limit", String(options.limit))
  const query = params.toString()
  const response = await fetch(`/api/workflow/opencli-adapter-nodes${query ? `?${query}` : ""}`, {
    headers: {
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    cache: "no-store",
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
    label: node.label,
    description: node.description || `实时执行 opencli ${node.site} ${node.command}`,
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
