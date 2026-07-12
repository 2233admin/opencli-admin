import type { WorkflowCapabilitiesResponse } from "./capabilities"

type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export async function fetchWorkflowCapabilities(
  options: { baseUrl?: string; authorization?: string | null } = {},
): Promise<WorkflowCapabilitiesResponse> {
  const baseUrl = options.baseUrl ?? ""
  const response = await fetch(`${baseUrl}/api/workflow/capabilities`, {
    headers: {
      ...workflowRequestAuthHeaders(options.authorization),
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<WorkflowCapabilitiesResponse> | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message ?? payload?.error ?? `Workflow capability fetch failed (${response.status})`)
  }
  return payload.data
}
import { workflowRequestAuthHeaders } from "./request-auth"
