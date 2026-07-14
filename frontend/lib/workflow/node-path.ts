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

function splitRuntimeNodeId(nodeId: string): string[] {
  return nodeId.split(RUNTIME_NODE_PATH_SEPARATOR).filter(Boolean)
}

function startsWithPath(value: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((segment, index) => value[index] === segment)
}
