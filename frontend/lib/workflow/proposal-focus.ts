import type { AgentProposalOperation } from "./proposal"

export type ProposalFocusTarget = {
  nodeIds: string[]
  edgeIds: string[]
}

export function getProposalOperationFocus(operation: AgentProposalOperation): ProposalFocusTarget {
  switch (operation.type) {
    case "addNode":
      return { nodeIds: [operation.node.id], edgeIds: [] }
    case "updateNodeParams":
    case "removeNode":
      return { nodeIds: [operation.nodeId], edgeIds: [] }
    case "addEdge":
      return {
        nodeIds: unique([operation.edge.source, operation.edge.target]),
        edgeIds: [operation.edge.id],
      }
    case "removeEdge":
      return { nodeIds: [], edgeIds: [operation.edgeId] }
    case "updateProjectSettings":
    case "updateProfileRubric":
      return { nodeIds: [], edgeIds: [] }
  }
}

export function getProposalFocus(operations: AgentProposalOperation[]): ProposalFocusTarget {
  const nodeIds: string[] = []
  const edgeIds: string[] = []
  for (const operation of operations) {
    const focus = getProposalOperationFocus(operation)
    nodeIds.push(...focus.nodeIds)
    edgeIds.push(...focus.edgeIds)
  }
  return { nodeIds: unique(nodeIds), edgeIds: unique(edgeIds) }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
