import type { WorkflowProject } from "./schema"

export type WorkflowCompileError = {
  code: string
  message: string
  node_id?: string | null
  edge_id?: string | null
  path: string[]
}

export type WorkflowCompiledPlanPreview = {
  compile_version: string
  authoring: {
    project_id: string
    project_name: string
    project_version: number
    profile: WorkflowProject["profile"]
    node_count: number
    edge_count: number
    adapter_count: number
    settings: WorkflowProject["settings"]
    agentPermissions: WorkflowProject["agentPermissions"]
  }
  runtime: {
    execution_mode: "preview"
    dispatch: "none"
    node_ids: string[]
    nodes: Array<{
      id: string
      kind: WorkflowProject["nodes"][number]["kind"]
      capability: WorkflowProject["nodes"][number]["capability"]
      params: Record<string, unknown>
      depends_on: string[]
      adapter?: WorkflowProject["adapters"][number] | null
      sourceAnchor?: WorkflowProject["nodes"][number]["sourceAnchor"] | null
      runArtifact?: WorkflowProject["nodes"][number]["runArtifact"] | null
      package?: Record<string, unknown> | null
      runtime: Record<string, unknown>
    }>
    edges: Array<{
      id: string
      source: string
      target: string
      sourcePort: string
      targetPort: string
      contractId?: string | null
      condition?: string | null
    }>
    plan_ir: Record<string, unknown>
  }
}

export type WorkflowCompileResponse = {
  valid: boolean
  errors: WorkflowCompileError[]
  plan: WorkflowCompiledPlanPreview | null
}

type ApiResponse<T> = {
  success: boolean
  data?: T | null
  error?: string | null
}

export async function compileWorkflowProject(
  project: WorkflowProject,
  options: { baseUrl?: string; authorization?: string | null } = {},
): Promise<WorkflowCompileResponse> {
  const baseUrl = options.baseUrl ?? ""
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (options.authorization) headers.Authorization = options.authorization

  const response = await fetch(`${baseUrl}/api/v1/workflows/compile`, {
    method: "POST",
    headers,
    body: JSON.stringify({ project }),
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<WorkflowCompileResponse> | null

  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(payload?.error ?? `Backend workflow compile failed (${response.status})`)
  }

  return payload.data
}
