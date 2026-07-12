import type { WorkflowCompileError } from "./backend-compile"
import type { WorkflowProject } from "./schema"
import { workflowRequestAuthHeaders } from "./request-auth"

export type WorkflowOpenCLIHDATraceDispatchEnvelope = {
  function_id: string
  payload: Record<string, unknown>
}

export type WorkflowOpenCLIHDATraceDispatchItem = {
  taskId: string
  nodeId: string
  packageNodeId?: string | null
  internalNodeId?: string | null
  sourceGroup: string
  site: string
  command: string
  args: Record<string, unknown>
  iii: WorkflowOpenCLIHDATraceDispatchEnvelope
}

export type WorkflowOpenCLIHDATraceResponse = {
  valid: boolean
  errors: WorkflowCompileError[]
  workflowId: string
  runId: string
  traceId: string
  packageNodeId?: string | null
  dispatch?: {
    runtime: string
    worker: string
    functionId: string
    mode: string
  } | null
  dispatches: WorkflowOpenCLIHDATraceDispatchItem[]
}

type ApiResponse<T> = {
  success: boolean
  data?: T | null
  error?: string | null
}

export async function traceOpenCLIHDAWorkflow(
  project: WorkflowProject,
  options: {
    baseUrl?: string
    authorization?: string | null
    packageNodeId?: string | null
    runId?: string | null
    traceId?: string | null
  } = {},
): Promise<WorkflowOpenCLIHDATraceResponse> {
  const baseUrl = options.baseUrl ?? ""
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  Object.assign(headers, workflowRequestAuthHeaders(options.authorization))

  const response = await fetch(`${baseUrl}/api/v1/workflows/opencli-hda/trace`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      project,
      packageNodeId: options.packageNodeId ?? undefined,
      runId: options.runId ?? undefined,
      traceId: options.traceId ?? undefined,
    }),
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<WorkflowOpenCLIHDATraceResponse> | null

  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(payload?.error ?? `Backend OpenCLI HDA trace failed (${response.status})`)
  }

  return payload.data
}
