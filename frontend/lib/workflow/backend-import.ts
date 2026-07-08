import type { WorkflowProject, WorkflowProjectEdge, WorkflowProjectNode } from "./schema"

type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export type ExternalWorkflowRuntime = "langgraph" | "langchain"

type BackendPatchOperation = {
  op: string
  node?: WorkflowProjectNode
  edge?: WorkflowProjectEdge
  nodeId?: string
  params?: Record<string, unknown>
  capability?: string
  reason?: string
}

export type ExternalWorkflowImportResponse = {
  valid: boolean
  errors: Array<{ code: string; message: string; node_id?: string | null; edge_id?: string | null }>
  missing_capabilities: Array<{ capability: string; reason?: string | null; n8n_search_hint?: string | null }>
  patch: { operations: BackendPatchOperation[] }
  project?: WorkflowProject | null
  compile?: unknown
}

export async function importExternalRuntimeWorkflow(
  project: WorkflowProject,
  options: {
    runtime: ExternalWorkflowRuntime
    graph: Record<string, unknown>
    name?: string
    locale?: string
    authorization?: string | null
  },
): Promise<ExternalWorkflowImportResponse> {
  const response = await fetch("/api/workflow/import/external-runtime", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify({
      project,
      runtime: options.runtime,
      graph: options.graph,
      ...(options.name ? { name: options.name } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
    }),
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<ExternalWorkflowImportResponse> | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message ?? payload?.error ?? `Workflow import failed (${response.status})`)
  }
  return payload.data
}
