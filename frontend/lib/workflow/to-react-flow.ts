import type { WorkflowEdge, WorkflowNode, WorkflowNodeData, NodeCategory, WorkflowNodeType } from "@/lib/flow/types"
import type { WorkflowRuntimeCapability } from "./capabilities"
import type { WorkflowProject, WorkflowProjectNode } from "./schema"

const KIND_TO_NODE_TYPE: Record<WorkflowProjectNode["kind"], WorkflowNodeType> = {
  schedule: "trigger",
  source: "http",
  agent: "action",
  router: "condition",
  notify: "action",
  inbox: "action",
  action: "action",
}

const KIND_TO_CATEGORY: Record<WorkflowProjectNode["kind"], NodeCategory> = {
  schedule: "trigger",
  source: "data",
  agent: "action",
  router: "logic",
  notify: "action",
  inbox: "data",
  action: "action",
}

const KIND_TO_ICON: Record<WorkflowProjectNode["kind"], string> = {
  schedule: "Clock",
  source: "Globe",
  agent: "Sparkles",
  router: "GitBranch",
  notify: "Send",
  inbox: "Inbox",
  action: "Play",
}

export function workflowProjectToReactFlow(project: WorkflowProject): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  return {
    nodes: project.nodes.map((node, index) => workflowNodeToReactFlow(node, index)),
    edges: project.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort,
      targetHandle: edge.targetPort,
      label: edge.label,
      type: "workflow",
      animated: true,
      data: {
        label: edge.label,
        semantic: edge.semantic,
        weight: edge.weight,
        contractId: edge.contractId,
        proposalState: edge.proposalState,
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
        ...(edge.ui ?? {}),
      },
    })),
  }
}

export function workflowNodeToReactFlow(node: WorkflowProjectNode, index: number): WorkflowNode {
  const ui = node.ui ?? {}
  const position = readPosition(ui) ?? { x: 520, y: 80 + index * 220 }
  const data: WorkflowNodeData = {
    label: readString(ui, "label") ?? node.id,
    description: readString(ui, "description") ?? `${node.kind}:${node.capability}`,
    nodeType: KIND_TO_NODE_TYPE[node.kind],
    category: KIND_TO_CATEGORY[node.kind],
    icon: readString(ui, "icon") ?? KIND_TO_ICON[node.kind],
    color: readString(ui, "color") ?? "var(--chart-2)",
    status: "idle",
    fields: Object.entries(node.params).map(([id, value]) => ({ id, label: id, value: formatParamValue(value) })),
    canonical: {
      kind: node.kind,
      capability: node.capability,
      adapter: node.adapter,
      params: node.params,
      catalogId: readString(ui, "catalogId"),
    },
    sourceAnchor: node.sourceAnchor,
    runArtifact: node.runArtifact,
    runtimeCapability: readRuntimeCapability(ui),
    miniNetwork: node.miniNetwork,
    topicCollapse: node.topicCollapse,
    proposalState: node.proposalState,
    parameterInterface: node.parameterInterface,
    externalWorkflow: readExternalWorkflow(ui),
  }

  return {
    id: node.id,
    type: data.nodeType === "note" ? "note" : "workflow",
    position,
    data,
  }
}

function readRuntimeCapability(ui: Record<string, unknown>): WorkflowRuntimeCapability | undefined {
  const value = ui.runtimeCapability
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.status !== "string") return undefined
  if (
    record.status !== "runnable" &&
    record.status !== "blocked" &&
    record.status !== "preview_only" &&
    record.status !== "design_only"
  ) {
    return undefined
  }
  return value as WorkflowRuntimeCapability
}

function readPosition(ui: Record<string, unknown>) {
  const value = ui.position
  if (!value || typeof value !== "object") return null
  const position = value as { x?: unknown; y?: unknown }
  if (typeof position.x !== "number" || typeof position.y !== "number") return null
  return { x: position.x, y: position.y }
}

function readString(ui: Record<string, unknown>, key: string): string | undefined {
  const value = ui[key]
  return typeof value === "string" ? value : undefined
}

function formatParamValue(value: unknown): string {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function readExternalWorkflow(ui: Record<string, unknown>): WorkflowNodeData["externalWorkflow"] {
  const n8n = ui.n8n
  if (!n8n || typeof n8n !== "object" || Array.isArray(n8n)) return undefined
  const record = n8n as Record<string, unknown>
  if (record.source !== "n8n") return undefined
  return {
    source: "n8n",
    originalId: typeof record.originalId === "string" ? record.originalId : undefined,
    originalName: typeof record.originalName === "string" ? record.originalName : undefined,
    type: typeof record.type === "string" ? record.type : undefined,
  }
}
