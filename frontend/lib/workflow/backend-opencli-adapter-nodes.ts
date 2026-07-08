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
