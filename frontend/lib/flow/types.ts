import type { Node, Edge, XYPosition } from "@xyflow/react"
import type { WorkflowRuntimeCapability, WorkflowRuntimeIOContract } from "@/lib/workflow/capabilities"
import type {
  WorkflowEvidenceBatchSummary,
  WorkflowNodeRunEvent,
  WorkflowRunNodeState,
} from "@/lib/workflow/backend-runs"
import type { WorkflowCapability, WorkflowNodeKind } from "@/lib/workflow/schema"

export type NodeCategory = "trigger" | "action" | "logic" | "data" | "annotation" | "shape"

export type WorkflowNodeType =
  | "trigger"
  | "action"
  | "condition"
  | "transform"
  | "delay"
  | "http"
  | "note"
  | "group"
  | "shape"

export type ShapeKind = "rectangle" | "round" | "circle" | "diamond" | "hexagon" | "parallelogram" | "cylinder"

export type FieldConfig = {
  id: string
  label: string
  value: string
}

export type SourceAnchor = {
  kind: "artifact" | "url" | "message" | "selector"
  label: string
  href?: string
  artifactPath?: string
  selector?: string
  runId?: string
}

export type MiniNetworkPreview = {
  nodes: number
  edges: number
  mode: "title-only" | "ports" | "contract"
}

export type TopicCollapseState = {
  groupId: string
  nodeCount: number
  mode: "draft" | "locked"
  packageInternal: boolean
}

export type SemanticLinkMeta = {
  relationship: "related" | "depends-on" | "evidence" | "contradicts" | "implements"
  reason?: string
  confidence?: number
}

export type ProposalState = "draft" | "proposed" | "accepted"

export type ParameterFieldType = "text" | "textarea" | "number" | "slider" | "select" | "boolean" | "tokens"

export type ParameterBinding = {
  nodeId: string
  source: "params" | "adapter" | "data"
  fieldId: string
}

export type ParameterInterfaceGroup = {
  id: string
  label: string
  order?: number
}

export type ParameterInterfaceField = {
  id: string
  label: string
  groupId: string
  type: ParameterFieldType
  binding: ParameterBinding
  description?: string
  order?: number
  readonly?: boolean
  value?: unknown
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
}

export type ParameterInterface = {
  groups: ParameterInterfaceGroup[]
  fields: ParameterInterfaceField[]
}

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string
  description?: string
  nodeType: WorkflowNodeType
  category: NodeCategory
  icon: string
  status?: "idle" | "running" | "success" | "error"
  fields?: FieldConfig[]
  /** for condition nodes */
  condition?: string
  /** for group nodes */
  collapsed?: boolean
  expandedHeight?: number
  color?: string
  internalStepId?: string
  canonical?: {
    kind: WorkflowNodeKind
    capability: WorkflowCapability
    adapter?: string
    params?: Record<string, unknown>
    catalogId?: string
  }
  /** for shape nodes */
  shape?: ShapeKind
  /** source anchor / jump-back evidence binding */
  sourceAnchor?: SourceAnchor
  runArtifact?: {
    runId: string
    artifactPath: string
    apiPath?: string
  }
  runtimePreview?: {
    status?: string
    runId?: string
    traceId?: string
    dispatchCount?: number
    worker?: string
    functionId?: string
    sourceGroups?: string[]
    internalNodeIds?: string[]
    diagnostic?: string
  }
  runtimeCapability?: WorkflowRuntimeCapability
  runtimeContract?: WorkflowRuntimeIOContract
  runtimeRunState?: WorkflowRunNodeState
  runtimeLatestEvent?: WorkflowNodeRunEvent
  runtimeEvidenceBatches?: WorkflowEvidenceBatchSummary[]
  /** node-internal mini network preview */
  miniNetwork?: MiniNetworkPreview
  /** topic collapse as package internals */
  topicCollapse?: TopicCollapseState
  proposalState?: ProposalState
  parameterInterface?: ParameterInterface
  externalWorkflow?: {
    source: string
    originalId?: string
    originalName?: string
    type?: string
  }
}

export type WorkflowNode = Node<WorkflowNodeData>

export interface WorkflowEdgeData extends Record<string, unknown> {
  label?: string
  semantic?: SemanticLinkMeta
  weight?: number
  contractId?: string
  proposalState?: ProposalState
  /** editable edge control points (in flow coordinates) */
  waypoints?: XYPosition[]
  /** enable smart orthogonal routing that avoids nodes */
  routed?: boolean
  runtimeEvidenceBatch?: {
    runId: string
    status: "queued" | "running" | "partial" | "blocked" | "completed" | "failed"
    batchIds: string[]
    itemCount: number
    recordCount: number
  }
}

export type WorkflowEdge = Edge<WorkflowEdgeData>

export interface PaletteItem {
  nodeType: WorkflowNodeType
  category: NodeCategory
  label: string
  description: string
  icon: string
  color: string
  defaultData?: Partial<WorkflowNodeData>
  shape?: ShapeKind
}

export interface FreehandStroke {
  id: string
  points: number[][]
  color: string
  size: number
}

export type ToolMode = "select" | "draw" | "connect" | "scissors"

export interface FlowSnapshot {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  drawings?: FreehandStroke[]
}

export interface GeneratedWorkflowSpec {
  title: string
  nodes: { id: string; type: string; label: string; description: string; config?: string }[]
  edges: { source: string; target: string; label?: string }[]
}
