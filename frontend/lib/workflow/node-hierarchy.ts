export const MAX_WORKFLOW_NODE_DEPTH = 4
export const NODE_NETWORK_DEPTH_LIMIT_REACHED = -1

export type WorkflowNodeLayerRole = "operator" | "implementation" | "component" | "primitive"

export type WorkflowNodeLayer = {
  depth: number
  role: WorkflowNodeLayerRole
  label: string
  description: string
}

const WORKFLOW_NODE_LAYERS: readonly WorkflowNodeLayer[] = [
  { depth: 1, role: "operator", label: "业务节点", description: "Dify 风格的业务编排层" },
  { depth: 2, role: "implementation", label: "实现节点", description: "现有 OpenCLI 节点层" },
  { depth: 3, role: "component", label: "组件节点", description: "实现节点的内部组件层" },
  { depth: 4, role: "primitive", label: "原子节点", description: "常规最深执行层" },
]

type HierarchyNode = {
  id: string
  kind: string
  capability: string
  adapter?: string
  internals?: unknown
}

type HierarchyEdge = {
  id: string
  source: string
  target: string
}

export function workflowNodeDepthFromNetworkStack(networkStackLength: number): number {
  return Math.min(MAX_WORKFLOW_NODE_DEPTH, Math.max(1, networkStackLength + 1))
}

export function workflowNodeLayerAtDepth(depth: number): WorkflowNodeLayer {
  const layer = WORKFLOW_NODE_LAYERS[depth - 1]
  if (!layer) throw new RangeError(`Workflow node depth must be between 1 and ${MAX_WORKFLOW_NODE_DEPTH}`)
  return layer
}

export function validateWorkflowNodeHierarchy(
  values: readonly unknown[],
  options: { adapterIds?: ReadonlySet<string> } = {},
): void {
  visitNodeScope(values, 1, [], options.adapterIds)
}

function visitNodeScope(
  values: readonly unknown[],
  depth: number,
  parentPath: readonly string[],
  adapterIds: ReadonlySet<string> | undefined,
): void {
  if (depth > MAX_WORKFLOW_NODE_DEPTH) {
    throw new Error(`Workflow node hierarchy exceeds the ${MAX_WORKFLOW_NODE_DEPTH}-layer limit at "${parentPath.join(" > ")}"`)
  }

  const nodes = values.map((value, index) => readHierarchyNode(value, [...parentPath, `#${index + 1}`]))
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Workflow node scope "${scopeLabel(parentPath)}" contains duplicate node id "${node.id}"`)
    }
    nodeIds.add(node.id)
    if (node.adapter && adapterIds && !adapterIds.has(node.adapter)) {
      throw new Error(`Workflow node "${[...parentPath, node.id].join(" > ")}" references missing adapter "${node.adapter}"`)
    }
  }

  for (const node of nodes) {
    if (node.internals === undefined) continue
    const nodePath = [...parentPath, node.id]
    const internals = readRecord(node.internals, `Workflow node "${nodePath.join(" > ")}" internals`)
    const children = internals.nodes
    const edges = internals.edges
    if (!Array.isArray(children) || !Array.isArray(edges)) {
      throw new Error(`Workflow node "${nodePath.join(" > ")}" internals must contain node and edge arrays`)
    }
    if (depth === MAX_WORKFLOW_NODE_DEPTH && children.length > 0) {
      throw new Error(`Workflow node "${nodePath.join(" > ")}" exceeds the ${MAX_WORKFLOW_NODE_DEPTH}-layer limit`)
    }

    const childNodes = children.map((value, index) => readHierarchyNode(value, [...nodePath, `#${index + 1}`]))
    const childIds = new Set(childNodes.map((child) => child.id))
    const edgeIds = new Set<string>()
    for (const [index, value] of edges.entries()) {
      const edge = readHierarchyEdge(value, [...nodePath, `edge #${index + 1}`])
      if (edgeIds.has(edge.id)) {
        throw new Error(`Workflow node scope "${nodePath.join(" > ")}" contains duplicate edge id "${edge.id}"`)
      }
      edgeIds.add(edge.id)
      if (!childIds.has(edge.source)) {
        throw new Error(`Workflow internal edge "${edge.id}" references missing source "${edge.source}" in "${nodePath.join(" > ")}"`)
      }
      if (!childIds.has(edge.target)) {
        throw new Error(`Workflow internal edge "${edge.id}" references missing target "${edge.target}" in "${nodePath.join(" > ")}"`)
      }
    }
    if (children.length > 0) visitNodeScope(children, depth + 1, nodePath, adapterIds)
  }
}

function readHierarchyNode(value: unknown, path: readonly string[]): HierarchyNode {
  const node = readRecord(value, `Workflow node "${path.join(" > ")}"`)
  if (typeof node.id !== "string" || typeof node.kind !== "string" || typeof node.capability !== "string") {
    throw new Error(`Workflow node "${path.join(" > ")}" must define id, kind, and capability`)
  }
  if (node.id.includes("::") || node.id.includes("__")) {
    throw new Error(`Workflow node "${path.join(" > ")}" id must not contain reserved path separators "::" or "__"`)
  }
  if (node.adapter !== undefined && typeof node.adapter !== "string") {
    throw new Error(`Workflow node "${path.join(" > ")}" adapter must be a string`)
  }
  return node as HierarchyNode
}

function readHierarchyEdge(value: unknown, path: readonly string[]): HierarchyEdge {
  const edge = readRecord(value, `Workflow edge "${path.join(" > ")}"`)
  if (typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string") {
    throw new Error(`Workflow edge "${path.join(" > ")}" must define id, source, and target`)
  }
  return edge as HierarchyEdge
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function scopeLabel(path: readonly string[]): string {
  return path.length > 0 ? path.join(" > ") : "root"
}
