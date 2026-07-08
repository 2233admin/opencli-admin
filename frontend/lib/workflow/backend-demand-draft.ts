import type { AgentProposal, AgentProposalOperation } from "./proposal"
import type { WorkflowProject, WorkflowProjectEdge, WorkflowProjectNode } from "./schema"

type ApiResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

type BackendPatchOperation = {
  op: string
  node?: WorkflowProjectNode
  edge?: WorkflowProjectEdge
  nodeId?: string
  params?: Record<string, unknown>
  capability?: string
  reason?: string
}

type BackendWorkflowPatchResponse = {
  valid: boolean
  errors: Array<{ code: string; message: string; node_id?: string | null; edge_id?: string | null }>
  missing_capabilities: Array<{ capability: string; reason?: string | null; n8n_search_hint?: string | null }>
  patch: { operations: BackendPatchOperation[] }
  project?: WorkflowProject | null
  compile?: unknown
}

export async function draftWorkflowDemand(
  project: WorkflowProject,
  text: string,
  options: { authorization?: string | null; locale?: string | null } = {},
): Promise<AgentProposal> {
  const response = await fetch("/api/workflow/demand-draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authorization ? { Authorization: options.authorization } : {}),
    },
    body: JSON.stringify({
      project,
      text,
      ...(options.locale ? { locale: options.locale } : {}),
    }),
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<BackendWorkflowPatchResponse> | null
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message ?? payload?.error ?? `Workflow demand draft failed (${response.status})`)
  }
  return toAgentProposal(payload.data, text)
}

function toAgentProposal(response: BackendWorkflowPatchResponse, text: string): AgentProposal {
  const operations = response.patch.operations.flatMap(toAgentOperation)
  if (operations.length === 0) {
    const missing = response.missing_capabilities[0]
    throw new Error(missing?.reason ?? missing?.capability ?? "No existing capability can assemble this demand")
  }
  return {
    id: `demand-${Date.now()}`,
    title: `Assemble: ${text.slice(0, 48)}`,
    summary: "Existing runtime capabilities were assembled into a reviewable WorkflowProject patch.",
    risk: response.valid && response.errors.length === 0 ? "low" : "medium",
    validationEvidence: [
      {
        id: "demand-mapped-existing-capability",
        label: "Existing capability mapped",
        passed: response.missing_capabilities.length === 0,
        details: response.missing_capabilities.map((item) => item.capability).join(", ") || "OpenCLI HDA/source slots",
      },
      {
        id: "demand-backend-compile",
        label: "Backend compile",
        passed: response.valid,
        details: response.errors.map((error) => error.message).join("; ") || "Patch compiles",
      },
    ],
    operations,
  }
}

function toAgentOperation(operation: BackendPatchOperation): AgentProposalOperation[] {
  if (operation.op === "add_node" && operation.node) {
    return [{ type: "addNode", node: operation.node }]
  }
  if (operation.op === "update_parameters" && operation.nodeId) {
    return [{ type: "updateNodeParams", nodeId: operation.nodeId, params: operation.params ?? {} }]
  }
  if (operation.op === "connect_nodes" && operation.edge) {
    return [{ type: "addEdge", edge: operation.edge }]
  }
  return []
}
