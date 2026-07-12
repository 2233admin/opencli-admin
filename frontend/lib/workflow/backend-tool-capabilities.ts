import { workflowRequestAuthHeaders } from "./request-auth"

type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export type WorkflowToolCapabilityPort = {
  name: string
  type: string
}

export type WorkflowToolCapability = {
  id: string
  label: string
  description?: string | null
  status: "runnable" | "blocked"
  provider: string
  inputPorts: WorkflowToolCapabilityPort[]
  outputPorts: WorkflowToolCapabilityPort[]
  executor: {
    mode: "fixture"
    description?: string | null
  }
  tags: string[]
  manifest: Record<string, unknown>
}

export type WorkflowToolCapabilitiesResponse = {
  version: string
  tools: WorkflowToolCapability[]
}

export async function fetchWorkflowToolCapabilities(
  options: { authorization?: string | null } = {},
): Promise<WorkflowToolCapabilitiesResponse> {
  const response = await fetch("/api/workflow/tool-capabilities", {
    headers: {
      ...workflowRequestAuthHeaders(options.authorization),
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<WorkflowToolCapabilitiesResponse> | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message ?? payload?.error ?? `Workflow tool capability fetch failed (${response.status})`)
  }
  return payload.data
}
