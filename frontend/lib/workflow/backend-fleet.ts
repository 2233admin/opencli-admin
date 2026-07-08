type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export type WorkflowFleetSiteBinding = {
  site: string
  browserEndpoint: string
  notes?: string | null
}

export type WorkflowFleetAgent = {
  endpoint: string
  label: string
  mode: string
  nodeType: string
  agentUrl?: string | null
  agentProtocol?: string | null
  status: string
  connected: boolean
  available: boolean
  sites: string[]
  runtimes: string[]
  capabilities: string[]
  source: string
}

export type WorkflowFleetInventoryResponse = {
  version: string
  summary: Record<string, unknown>
  agents: WorkflowFleetAgent[]
  siteBindings: WorkflowFleetSiteBinding[]
}

export type WorkflowFleetCapabilityMatchRequest = {
  adapterNodeId?: string | null
  site?: string | null
  command?: string | null
}

export type WorkflowFleetCapabilityCandidate = {
  endpoint: string
  label: string
  mode: string
  agentUrl?: string | null
  agentProtocol?: string | null
  status: string
  connected: boolean
  available: boolean
  score: number
  reasons: string[]
  missing: string[]
  sites: string[]
}

export type WorkflowFleetCapabilityMatchResponse = {
  matched: boolean
  adapterNodeId?: string | null
  site?: string | null
  command?: string | null
  requiresBrowser: boolean
  requiresSiteBinding: boolean
  selected?: WorkflowFleetCapabilityCandidate | null
  candidates: WorkflowFleetCapabilityCandidate[]
  missing: string[]
}

export async function fetchWorkflowFleetInventory(
  options: { authorization?: string | null } = {},
): Promise<WorkflowFleetInventoryResponse> {
  const response = await fetch("/api/workflow/fleet/inventory", {
    headers: {
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as
    | ApiResponse<WorkflowFleetInventoryResponse>
    | null
  if (!response.ok || !payload?.data) {
    throw new Error(
      payload?.message ?? payload?.error ?? `Workflow fleet inventory failed (${response.status})`,
    )
  }
  return payload.data
}

export async function matchWorkflowFleetCapability(
  request: WorkflowFleetCapabilityMatchRequest,
  options: { authorization?: string | null } = {},
): Promise<WorkflowFleetCapabilityMatchResponse> {
  const response = await fetch("/api/workflow/fleet/match", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify(request),
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as
    | ApiResponse<WorkflowFleetCapabilityMatchResponse>
    | null
  if (!response.ok || !payload?.data) {
    throw new Error(
      payload?.message ?? payload?.error ?? `Workflow fleet match failed (${response.status})`,
    )
  }
  return payload.data
}
