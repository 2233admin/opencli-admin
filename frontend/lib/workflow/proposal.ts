import { z } from "zod"
import {
  parseWorkflowProject,
  workflowEdgeSchema,
  workflowNodeSchema,
  workflowSettingsSchema,
  type WorkflowProject,
  type WorkflowProjectEdge,
  type WorkflowProjectNode,
} from "./schema"

const jsonRecordSchema = z.record(z.string(), z.unknown())

export const agentProposalRiskLabelSchema = z.enum(["low", "medium", "high"])

export const agentProposalValidationEvidenceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  passed: z.boolean(),
  details: z.string().optional(),
})

export const addNodeOperationSchema = z.object({
  type: z.literal("addNode"),
  node: workflowNodeSchema,
})

export const updateNodeParamsOperationSchema = z.object({
  type: z.literal("updateNodeParams"),
  nodeId: z.string().min(1),
  params: jsonRecordSchema,
})

export const removeNodeOperationSchema = z.object({
  type: z.literal("removeNode"),
  nodeId: z.string().min(1),
})

export const addEdgeOperationSchema = z.object({
  type: z.literal("addEdge"),
  edge: workflowEdgeSchema,
})

export const removeEdgeOperationSchema = z.object({
  type: z.literal("removeEdge"),
  edgeId: z.string().min(1),
})

export const updateProjectSettingsOperationSchema = z.object({
  type: z.literal("updateProjectSettings"),
  settings: workflowSettingsSchema.partial(),
})

export const updateProfileRubricOperationSchema = z.object({
  type: z.literal("updateProfileRubric"),
  rubric: jsonRecordSchema,
})

export const agentProposalOperationSchema = z.discriminatedUnion("type", [
  addNodeOperationSchema,
  updateNodeParamsOperationSchema,
  removeNodeOperationSchema,
  addEdgeOperationSchema,
  removeEdgeOperationSchema,
  updateProjectSettingsOperationSchema,
  updateProfileRubricOperationSchema,
])

export const agentProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  risk: agentProposalRiskLabelSchema,
  validationEvidence: z.array(agentProposalValidationEvidenceSchema).default([]),
  operations: z.array(agentProposalOperationSchema).min(1),
})

export type AgentProposalRiskLabel = z.infer<typeof agentProposalRiskLabelSchema>
export type AgentProposalValidationEvidence = z.infer<typeof agentProposalValidationEvidenceSchema>
export type AgentProposalOperation = z.infer<typeof agentProposalOperationSchema>
export type AgentProposal = z.infer<typeof agentProposalSchema>
export type WorkflowProjectDraft = WorkflowProject & {
  profileRubric?: Record<string, unknown>
}

export function parseAgentProposal(input: unknown): AgentProposal {
  return agentProposalSchema.parse(input)
}

export function acceptAgentProposal(project: WorkflowProjectDraft, proposalInput: unknown): WorkflowProjectDraft {
  const proposal = parseAgentProposal(proposalInput)
  const draft = cloneProjectDraft(project)

  for (const operation of proposal.operations) {
    applyOperation(draft, operation)
  }

  return parseWorkflowProjectDraft(draft)
}

export function rejectAgentProposal(project: WorkflowProjectDraft): WorkflowProjectDraft {
  return project
}

function applyOperation(draft: WorkflowProjectDraft, operation: AgentProposalOperation): void {
  switch (operation.type) {
    case "addNode":
      ensureMissingNode(draft, operation.node.id)
      draft.nodes.push(operation.node)
      return
    case "updateNodeParams":
      findNode(draft, operation.nodeId).params = {
        ...findNode(draft, operation.nodeId).params,
        ...operation.params,
      }
      return
    case "removeNode":
      findNode(draft, operation.nodeId)
      draft.nodes = draft.nodes.filter((node) => node.id !== operation.nodeId)
      draft.edges = draft.edges.filter(
        (edge) => edge.source !== operation.nodeId && edge.target !== operation.nodeId,
      )
      return
    case "addEdge":
      ensureMissingEdge(draft, operation.edge.id)
      ensureNodeExists(draft, operation.edge.source, `source "${operation.edge.source}"`)
      ensureNodeExists(draft, operation.edge.target, `target "${operation.edge.target}"`)
      draft.edges.push(operation.edge)
      return
    case "removeEdge":
      findEdge(draft, operation.edgeId)
      draft.edges = draft.edges.filter((edge) => edge.id !== operation.edgeId)
      return
    case "updateProjectSettings":
      draft.settings = {
        ...draft.settings,
        ...operation.settings,
      }
      return
    case "updateProfileRubric":
      draft.profileRubric = {
        ...draft.profileRubric,
        ...operation.rubric,
      }
      return
  }
}

function cloneProjectDraft(project: WorkflowProjectDraft): WorkflowProjectDraft {
  return structuredClone(project)
}

function parseWorkflowProjectDraft(project: WorkflowProjectDraft): WorkflowProjectDraft {
  const parsed = parseWorkflowProject(project)
  return project.profileRubric ? { ...parsed, profileRubric: project.profileRubric } : parsed
}

function findNode(project: WorkflowProjectDraft, nodeId: string): WorkflowProjectNode {
  const node = project.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    throw new Error(`Agent proposal operation references missing node "${nodeId}"`)
  }
  return node
}

function findEdge(project: WorkflowProjectDraft, edgeId: string): WorkflowProjectEdge {
  const edge = project.edges.find((candidate) => candidate.id === edgeId)
  if (!edge) {
    throw new Error(`Agent proposal operation references missing edge "${edgeId}"`)
  }
  return edge
}

function ensureMissingNode(project: WorkflowProjectDraft, nodeId: string): void {
  if (project.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`Agent proposal operation would create duplicate node "${nodeId}"`)
  }
}

function ensureMissingEdge(project: WorkflowProjectDraft, edgeId: string): void {
  if (project.edges.some((edge) => edge.id === edgeId)) {
    throw new Error(`Agent proposal operation would create duplicate edge "${edgeId}"`)
  }
}

function ensureNodeExists(project: WorkflowProjectDraft, nodeId: string, label: string): void {
  if (!project.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`Agent proposal operation references missing ${label}`)
  }
}
