import type { AgentProposal } from "./proposal"
import { getProposalFocus } from "./proposal-focus"
import type { WorkflowSimulationRun } from "./simulation"
import type { AdapterBinding, WorkflowProject, WorkflowProjectNode } from "./schema"
import { buildProjectContractReport, type ContractStatus, type PortContract } from "./node-contracts"
import type { WorkflowRuntimeCapability } from "./capabilities"

export type ManagedNodeSummary = {
  id: string
  kind: WorkflowProjectNode["kind"]
  capability: WorkflowProjectNode["capability"]
  adapter: string
  paramsCount: number
  incoming: number
  outgoing: number
  lastEvent: string
  lastItemCount: number
  proposalImpacted: boolean
  contractId: string
  contractStatus: ContractStatus
  ports: PortContract[]
  runtimeCapability?: WorkflowRuntimeCapability
}

export type AdapterUsageSummary = AdapterBinding & {
  usedBy: string[]
}

export type NodeManagementSummary = {
  nodes: ManagedNodeSummary[]
  adapters: AdapterUsageSummary[]
  run: {
    runId: string
    traceEventCount: number
    notifiedItems: number
    storedItems: number
  } | null
  proposal: {
    id: string
    risk: AgentProposal["risk"]
    nodeIds: string[]
    edgeIds: string[]
  } | null
  contracts: {
    status: ContractStatus
    coveragePercent: number
    findingsCount: number
    nodes: Array<{
      nodeId: string
      contractId: string
      title: string
      ports: PortContract[]
      assertions: string[]
      status: ContractStatus
    }>
    findings: Array<{
      nodeId: string
      contractId: string
      status: ContractStatus
      summary: string
    }>
  }
}

export function summarizeNodeManagement(
  project: WorkflowProject,
  run?: WorkflowSimulationRun | null,
  proposal?: AgentProposal | null,
): NodeManagementSummary {
  const incoming = countEdges(project.nodes, project.edges, "target")
  const outgoing = countEdges(project.nodes, project.edges, "source")
  const lastEvents = new Map(run?.trace.map((event) => [event.nodeId, event]) ?? [])
  const proposalFocus = proposal ? getProposalFocus(proposal.operations) : null
  const proposalNodes = new Set(proposalFocus?.nodeIds ?? [])
  const contracts = buildProjectContractReport(project)
  const contractsByNode = new Map(contracts.nodeContracts.map((contract) => [contract.nodeId, contract]))
  const findingsByNode = new Map<string, ContractStatus>()
  for (const finding of contracts.findings) {
    findingsByNode.set(finding.nodeId, maxStatus(findingsByNode.get(finding.nodeId), finding.status))
  }

  return {
    nodes: project.nodes.map((node) => {
      const event = lastEvents.get(node.id)
      const contract = contractsByNode.get(node.id)
      const contractStatus = findingsByNode.get(node.id) ?? (contract ? "pass" : "warn")
      return {
        id: node.id,
        kind: node.kind,
        capability: node.capability,
        adapter: node.adapter ?? "none",
        paramsCount: Object.keys(node.params).length,
        incoming: incoming.get(node.id) ?? 0,
        outgoing: outgoing.get(node.id) ?? 0,
        lastEvent: event?.event ?? "not-run",
        lastItemCount: event?.itemCount ?? 0,
        proposalImpacted: proposalNodes.has(node.id),
        contractId: contract?.contractId ?? "missing",
        contractStatus,
        ports: contract?.ports ?? [],
        runtimeCapability: readRuntimeCapability(node),
      }
    }),
    adapters: project.adapters.map((adapter) => ({
      ...adapter,
      usedBy: project.nodes.filter((node) => node.adapter === adapter.id).map((node) => node.id),
    })),
    run: run
      ? {
          runId: run.runId,
          traceEventCount: run.runtime.traceEventCount,
          notifiedItems: run.quality.notifiedItems,
          storedItems: run.quality.storedItems,
        }
      : null,
    proposal: proposal
      ? {
          id: proposal.id,
          risk: proposal.risk,
          nodeIds: proposalFocus?.nodeIds ?? [],
          edgeIds: proposalFocus?.edgeIds ?? [],
        }
      : null,
    contracts: {
      status: contracts.status,
      coveragePercent: contracts.portCoverage.percent,
      findingsCount: contracts.findings.length,
      nodes: contracts.nodeContracts.map((contract) => ({
        nodeId: contract.nodeId,
        contractId: contract.contractId,
        title: contract.title,
        ports: contract.ports,
        assertions: contract.assertions,
        status: findingsByNode.get(contract.nodeId) ?? "pass",
      })),
      findings: contracts.findings.map((finding) => ({
        nodeId: finding.nodeId,
        contractId: finding.contractId,
        status: finding.status,
        summary: finding.summary,
      })),
    },
  }
}

function readRuntimeCapability(node: WorkflowProjectNode): WorkflowRuntimeCapability | undefined {
  const value = node.ui?.runtimeCapability
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.status !== "string") return undefined
  return value as WorkflowRuntimeCapability
}

function maxStatus(left: ContractStatus | undefined, right: ContractStatus): ContractStatus {
  if (left === "fail" || right === "fail") return "fail"
  if (left === "warn" || right === "warn") return "warn"
  return "pass"
}

function countEdges(
  nodes: WorkflowProject["nodes"],
  edges: WorkflowProject["edges"],
  side: "source" | "target",
): Map<string, number> {
  const counts = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of edges) {
    counts.set(edge[side], (counts.get(edge[side]) ?? 0) + 1)
  }
  return counts
}
