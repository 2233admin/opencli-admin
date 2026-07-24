import type { WorkflowProject, WorkflowProjectNode } from "./schema"

const RUNTIME_NODE_PATH_SEPARATOR = "::"
const CANVAS_NODE_PATH_SEPARATOR = "__"

export type WorkflowRuntimeNodeLocation = {
  nodeId: string
  nodePath?: readonly string[] | null
  packageNodeId?: string | null
  internalNodeId?: string | null
}

export function normalizeWorkflowRuntimeNodePath(location: WorkflowRuntimeNodeLocation): string[] {
  if (location.nodePath?.length) return [...location.nodePath]

  const nodePath = splitRuntimeNodeId(location.nodeId)
  if (nodePath.length > 1) return nodePath

  if (location.packageNodeId && location.internalNodeId) {
    const packagePath = splitRuntimeNodeId(location.packageNodeId)
    const internalPath = splitRuntimeNodeId(location.internalNodeId)
    return startsWithPath(internalPath, packagePath) ? internalPath : [...packagePath, ...internalPath]
  }

  return nodePath
}

/**
 * Return every visible canvas ancestor for a runtime node, from the L1 operator
 * through the exact L2-L4 scoped node. This lets one event update both the
 * collapsed business node and whichever implementation layer is currently open.
 */
export function workflowRuntimeCanvasNodeIds(location: WorkflowRuntimeNodeLocation): string[] {
  const path = normalizeWorkflowRuntimeNodePath(location)
  const ids = path.map((_, index) => path.slice(0, index + 1).join(CANVAS_NODE_PATH_SEPARATOR))
  return Array.from(new Set([...ids, location.nodeId.replaceAll(RUNTIME_NODE_PATH_SEPARATOR, CANVAS_NODE_PATH_SEPARATOR)]))
}

/**
 * Resolve a visible canvas id back to the canonical project node at any
 * implementation depth. Internal canvas ids are scoped as parent__child.
 */
export function findWorkflowProjectNodeByCanvasId(
  project: WorkflowProject,
  canvasNodeId: string,
): WorkflowProjectNode | undefined {
  const visit = (node: WorkflowProjectNode, scopedId: string): WorkflowProjectNode | undefined => {
    if (scopedId === canvasNodeId) return node
    for (const child of workflowProjectNodeChildren(node)) {
      const match = visit(child, `${scopedId}${CANVAS_NODE_PATH_SEPARATOR}${child.id}`)
      if (match) return match
    }
    return undefined
  }

  for (const node of project.nodes) {
    const match = visit(node, node.id)
    if (match) return match
  }
  return undefined
}

export function mapWorkflowProjectNodeTree(
  node: WorkflowProjectNode,
  mapper: (node: WorkflowProjectNode) => WorkflowProjectNode,
): WorkflowProjectNode {
  const internals = node.internals
  const nodeWithMappedChildren = internals
    ? {
        ...node,
        internals: {
          ...internals,
          nodes: internals.nodes.map((child) =>
            isWorkflowProjectNode(child) ? mapWorkflowProjectNodeTree(child, mapper) : child,
          ),
        },
      }
    : node
  return mapper(nodeWithMappedChildren)
}

export function workflowProjectNodeChildren(node: WorkflowProjectNode): WorkflowProjectNode[] {
  return node.internals?.nodes.filter(isWorkflowProjectNode) ?? []
}

function isWorkflowProjectNode(value: unknown): value is WorkflowProjectNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const node = value as Partial<WorkflowProjectNode>
  return (
    typeof node.id === "string" &&
    typeof node.kind === "string" &&
    typeof node.capability === "string" &&
    (!("params" in node) || Boolean(node.params && typeof node.params === "object" && !Array.isArray(node.params)))
  )
}

function splitRuntimeNodeId(nodeId: string): string[] {
  return nodeId.split(RUNTIME_NODE_PATH_SEPARATOR).filter(Boolean)
}

function startsWithPath(value: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((segment, index) => value[index] === segment)
}
