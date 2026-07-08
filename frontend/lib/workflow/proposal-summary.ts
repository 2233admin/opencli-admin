import type {
  AgentProposal,
  AgentProposalOperation,
  AgentProposalRiskLabel,
} from "./proposal"

export type ProposalRiskTone = "success" | "warning" | "danger"

export type ProposalOperationSummary = {
  id: string
  index: number
  type: AgentProposalOperation["type"]
  label: string
  detail: string
}

export type ProposalSummary = {
  id: string
  title: string
  summary: string
  risk: AgentProposalRiskLabel
  riskTone: ProposalRiskTone
  evidencePassed: number
  evidenceTotal: number
  failedEvidence: number
  operationCount: number
  operationSummaries: ProposalOperationSummary[]
}

export function summarizeAgentProposal(proposal: AgentProposal): ProposalSummary {
  const evidencePassed = proposal.validationEvidence.filter((item) => item.passed).length
  const evidenceTotal = proposal.validationEvidence.length

  return {
    id: proposal.id,
    title: proposal.title,
    summary: proposal.summary ?? "No summary provided.",
    risk: proposal.risk,
    riskTone: riskToneFor(proposal.risk),
    evidencePassed,
    evidenceTotal,
    failedEvidence: evidenceTotal - evidencePassed,
    operationCount: proposal.operations.length,
    operationSummaries: proposal.operations.map(summarizeOperation),
  }
}

function riskToneFor(risk: AgentProposalRiskLabel): ProposalRiskTone {
  if (risk === "high") return "danger"
  if (risk === "medium") return "warning"
  return "success"
}

function summarizeOperation(operation: AgentProposalOperation, index: number): ProposalOperationSummary {
  switch (operation.type) {
    case "addNode":
      return {
        id: `op-${index}-${operation.type}-${operation.node.id}`,
        index,
        type: operation.type,
        label: "Add node",
        detail: `${operation.node.id} (${operation.node.kind}/${operation.node.capability})`,
      }
    case "updateNodeParams":
      return {
        id: `op-${index}-${operation.type}-${operation.nodeId}`,
        index,
        type: operation.type,
        label: "Update params",
        detail: `${operation.nodeId}: ${Object.keys(operation.params).join(", ") || "no keys"}`,
      }
    case "removeNode":
      return {
        id: `op-${index}-${operation.type}-${operation.nodeId}`,
        index,
        type: operation.type,
        label: "Remove node",
        detail: operation.nodeId,
      }
    case "addEdge":
      return {
        id: `op-${index}-${operation.type}-${operation.edge.id}`,
        index,
        type: operation.type,
        label: "Add edge",
        detail: `${operation.edge.source} -> ${operation.edge.target}`,
      }
    case "removeEdge":
      return {
        id: `op-${index}-${operation.type}-${operation.edgeId}`,
        index,
        type: operation.type,
        label: "Remove edge",
        detail: operation.edgeId,
      }
    case "updateProjectSettings":
      return {
        id: `op-${index}-${operation.type}`,
        index,
        type: operation.type,
        label: "Project settings",
        detail: Object.keys(operation.settings).join(", ") || "no keys",
      }
    case "updateProfileRubric":
      return {
        id: `op-${index}-${operation.type}`,
        index,
        type: operation.type,
        label: "Profile rubric",
        detail: Object.keys(operation.rubric).join(", ") || "no keys",
      }
  }
}
