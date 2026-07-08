import type { WorkflowEdge, WorkflowNode } from "@/lib/flow/types"
import type { WorkflowProject } from "./schema"
import { parseWorkflowProject } from "./schema"

type ReactFlowProjection = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export function reactFlowToWorkflowProject(
  baseProject: WorkflowProject,
  projection: ReactFlowProjection,
): WorkflowProject {
  const uiByNodeId = new Map(
    projection.nodes.map((node) => [
      node.id,
      {
        ...(baseProject.nodes.find((projectNode) => projectNode.id === node.id)?.ui ?? {}),
        position: node.position,
        label: node.data.label,
        description: node.data.description,
        color: node.data.color,
        icon: node.data.icon,
      },
    ]),
  )

  const uiByEdgeId = new Map(
    projection.edges.map((edge) => [
      edge.id,
      {
        ...(baseProject.edges.find((projectEdge) => projectEdge.id === edge.id)?.ui ?? {}),
        label: typeof edge.label === "string" ? edge.label : edge.data?.label,
      },
    ]),
  )

  return parseWorkflowProject({
    ...baseProject,
    nodes: baseProject.nodes.map((node) => ({
      ...node,
      sourceAnchor: projection.nodes.find((projectionNode) => projectionNode.id === node.id)?.data.sourceAnchor ?? node.sourceAnchor,
      runArtifact: projection.nodes.find((projectionNode) => projectionNode.id === node.id)?.data.runArtifact ?? node.runArtifact,
      miniNetwork: projection.nodes.find((projectionNode) => projectionNode.id === node.id)?.data.miniNetwork ?? node.miniNetwork,
      topicCollapse: projection.nodes.find((projectionNode) => projectionNode.id === node.id)?.data.topicCollapse ?? node.topicCollapse,
      proposalState: projection.nodes.find((projectionNode) => projectionNode.id === node.id)?.data.proposalState ?? node.proposalState,
      parameterInterface: projection.nodes.find((projectionNode) => projectionNode.id === node.id)?.data.parameterInterface ?? node.parameterInterface,
      ui: uiByNodeId.get(node.id) ?? node.ui,
    })),
    edges: baseProject.edges.map((edge) => ({
      ...edge,
      sourcePort: projection.edges.find((projectionEdge) => projectionEdge.id === edge.id)?.sourceHandle ?? edge.sourcePort,
      targetPort: projection.edges.find((projectionEdge) => projectionEdge.id === edge.id)?.targetHandle ?? edge.targetPort,
      semantic: projection.edges.find((projectionEdge) => projectionEdge.id === edge.id)?.data?.semantic ?? edge.semantic,
      weight: projection.edges.find((projectionEdge) => projectionEdge.id === edge.id)?.data?.weight ?? edge.weight,
      contractId: projection.edges.find((projectionEdge) => projectionEdge.id === edge.id)?.data?.contractId ?? edge.contractId,
      proposalState: projection.edges.find((projectionEdge) => projectionEdge.id === edge.id)?.data?.proposalState ?? edge.proposalState,
      ui: uiByEdgeId.get(edge.id) ?? edge.ui,
    })),
  })
}
