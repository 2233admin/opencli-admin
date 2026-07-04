import { z } from "zod"

export const workflowProfileSchema = z.enum(["intelligence", "agent-debug", "sdk-dev"])

export const workflowNodeKindSchema = z.enum([
  "schedule",
  "source",
  "agent",
  "router",
  "notify",
  "inbox",
  "action",
])

export const workflowCapabilitySchema = z.enum([
  "trigger",
  "fetch",
  "normalize",
  "dedupe",
  "summarize",
  "score",
  "tag",
  "route",
  "send",
  "store",
])

const jsonRecordSchema = z.record(z.string(), z.unknown())

export const sourceAnchorSchema = z.object({
  kind: z.enum(["artifact", "url", "message", "selector"]),
  label: z.string().min(1),
  href: z.string().optional(),
  artifactPath: z.string().optional(),
  selector: z.string().optional(),
  runId: z.string().optional(),
})

export const miniNetworkPreviewSchema = z.object({
  nodes: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative(),
  mode: z.enum(["title-only", "ports", "contract"]),
})

export const topicCollapseStateSchema = z.object({
  groupId: z.string().min(1),
  nodeCount: z.number().int().nonnegative(),
  mode: z.enum(["draft", "locked"]),
  packageInternal: z.boolean(),
})

export const semanticLinkSchema = z.object({
  relationship: z.enum(["related", "depends-on", "evidence", "contradicts", "implements"]),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const proposalStateSchema = z.enum(["draft", "proposed", "accepted"])

export const parameterBindingSchema = z.object({
  nodeId: z.string().min(1),
  source: z.enum(["params", "adapter", "data"]),
  fieldId: z.string().min(1),
})

export const parameterInterfaceGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  order: z.number().optional(),
})

export const parameterInterfaceFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  groupId: z.string().min(1),
  type: z.enum(["text", "textarea", "number", "slider", "select", "boolean", "tokens"]),
  binding: parameterBindingSchema,
  description: z.string().optional(),
  order: z.number().optional(),
  readonly: z.boolean().optional(),
  value: z.unknown().optional(),
  placeholder: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
})

export const parameterInterfaceSchema = z.object({
  groups: z.array(parameterInterfaceGroupSchema),
  fields: z.array(parameterInterfaceFieldSchema),
})

export const workflowNodeSchema = z.object({
  id: z.string().min(1),
  kind: workflowNodeKindSchema,
  capability: workflowCapabilitySchema,
  adapter: z.string().min(1).optional(),
  params: jsonRecordSchema.default({}),
  sourceAnchor: sourceAnchorSchema.optional(),
  runArtifact: z.object({
    runId: z.string().min(1),
    artifactPath: z.string().min(1),
    apiPath: z.string().optional(),
  }).optional(),
  miniNetwork: miniNetworkPreviewSchema.optional(),
  topicCollapse: topicCollapseStateSchema.optional(),
  proposalState: proposalStateSchema.optional(),
  parameterInterface: parameterInterfaceSchema.optional(),
  internals: z.object({
    locked: z.boolean().optional(),
    nodes: z.array(z.unknown()).default([]),
    edges: z.array(z.unknown()).default([]),
  }).optional(),
  ui: jsonRecordSchema.optional(),
})

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourcePort: z.string().min(1).optional(),
  targetPort: z.string().min(1).optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
  semantic: semanticLinkSchema.optional(),
  weight: z.number().min(0).max(1).optional(),
  contractId: z.string().min(1).optional(),
  proposalState: proposalStateSchema.optional(),
  ui: jsonRecordSchema.optional(),
})

export const workflowSettingsSchema = z.object({
  timezone: z.string().min(1).default("Asia/Shanghai"),
  deterministicSimulation: z.boolean().default(true),
  maxItemsPerRun: z.number().int().positive().default(20),
})

export const adapterBindingSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["source", "notification", "storage", "agent", "utility"]),
  provider: z.string().min(1),
  mode: z.enum(["fixture", "mock", "webhook", "live"]).default("fixture"),
  config: jsonRecordSchema.default({}),
})

export const agentPermissionsSchema = z.object({
  canFetchNetwork: z.boolean().default(false),
  canSendNotifications: z.boolean().default(false),
  canWriteInbox: z.boolean().default(true),
  allowedDomains: z.array(z.string()).default([]),
})

export const workflowProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  profile: workflowProfileSchema,
  version: z.literal(1).default(1),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
  settings: workflowSettingsSchema.default({
    timezone: "Asia/Shanghai",
    deterministicSimulation: true,
    maxItemsPerRun: 20,
  }),
  adapters: z.array(adapterBindingSchema).default([]),
  agentPermissions: agentPermissionsSchema.default({
    canFetchNetwork: false,
    canSendNotifications: false,
    canWriteInbox: true,
    allowedDomains: [],
  }),
})

export type WorkflowProfile = z.infer<typeof workflowProfileSchema>
export type WorkflowNodeKind = z.infer<typeof workflowNodeKindSchema>
export type WorkflowCapability = z.infer<typeof workflowCapabilitySchema>
export type WorkflowProjectNode = z.infer<typeof workflowNodeSchema>
export type WorkflowProjectEdge = z.infer<typeof workflowEdgeSchema>
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>
export type AdapterBinding = z.infer<typeof adapterBindingSchema>
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>
export type WorkflowProject = z.infer<typeof workflowProjectSchema>

export function parseWorkflowProject(input: unknown): WorkflowProject {
  const project = workflowProjectSchema.parse(input)
  validateWorkflowReferences(project)
  return project
}

export function validateWorkflowReferences(project: WorkflowProject): void {
  const nodeIds = new Set(project.nodes.map((node) => node.id))
  for (const edge of project.edges) {
    if (!nodeIds.has(edge.source)) {
      throw new Error(`Workflow edge "${edge.id}" references missing source "${edge.source}"`)
    }
    if (!nodeIds.has(edge.target)) {
      throw new Error(`Workflow edge "${edge.id}" references missing target "${edge.target}"`)
    }
  }

  const adapterIds = new Set(project.adapters.map((adapter) => adapter.id))
  for (const node of project.nodes) {
    if (node.adapter && !adapterIds.has(node.adapter)) {
      throw new Error(`Workflow node "${node.id}" references missing adapter "${node.adapter}"`)
    }
  }
}
