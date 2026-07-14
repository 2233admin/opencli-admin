import type {
  WorkflowProject,
  WorkflowProjectEdge,
  WorkflowProjectNode,
} from "../workflow/schema"

export type CanonicalNetworkScope = {
  nodes: WorkflowProjectNode[]
  edges: WorkflowProjectEdge[]
}

export const NETWORK_CANVAS_ORIGIN = { x: 520, y: 80 } as const
export type CanonicalScopeId = string | null

export function canonicalPositionFromNetworkCanvas(position: { x: number; y: number }) {
  return {
    x: position.x - NETWORK_CANVAS_ORIGIN.x,
    y: position.y - NETWORK_CANVAS_ORIGIN.y,
  }
}

export function canonicalLocalNodeId(parentCanvasId: CanonicalScopeId, canvasNodeId: string): string | null {
  if (parentCanvasId === null) return canvasNodeId
  const prefix = `${parentCanvasId}__`
  return canvasNodeId.startsWith(prefix) ? canvasNodeId.slice(prefix.length) : null
}

export function canonicalLocalEdgeId(parentCanvasId: CanonicalScopeId, canvasEdgeId: string): string | null {
  if (parentCanvasId === null) return canvasEdgeId
  const prefix = `e-${parentCanvasId}__`
  return canvasEdgeId.startsWith(prefix) ? canvasEdgeId.slice(prefix.length) : null
}

export function readCanonicalNetworkScope(
  project: WorkflowProject,
  parentCanvasId: CanonicalScopeId,
): CanonicalNetworkScope | undefined {
  if (parentCanvasId === null) return { nodes: project.nodes, edges: project.edges }
  const parent = findCanonicalProjectNodeByCanvasId(project, parentCanvasId)
  if (!parent) return undefined
  return {
    nodes: (parent.internals?.nodes ?? []).filter(isCanonicalProjectNode),
    edges: (parent.internals?.edges ?? []).filter(isCanonicalProjectEdge),
  }
}

export function updateCanonicalProjectNodeByCanvasId(
  project: WorkflowProject,
  canvasNodeId: string,
  updater: (node: WorkflowProjectNode) => WorkflowProjectNode,
): WorkflowProject {
  const result = updateNodeList(project.nodes, "", canvasNodeId, updater)
  return result.changed ? { ...project, nodes: result.nodes } : project
}

export function updateCanonicalNetworkScope(
  project: WorkflowProject,
  parentCanvasId: CanonicalScopeId,
  updater: (scope: CanonicalNetworkScope) => CanonicalNetworkScope,
): WorkflowProject {
  if (parentCanvasId === null) {
    const next = updater({ nodes: project.nodes, edges: project.edges })
    return { ...project, nodes: next.nodes, edges: next.edges }
  }
  return updateCanonicalProjectNodeByCanvasId(project, parentCanvasId, (parent) => {
    const current = {
      nodes: (parent.internals?.nodes ?? []).filter(isCanonicalProjectNode),
      edges: (parent.internals?.edges ?? []).filter(isCanonicalProjectEdge),
    }
    const next = updater(current)
    return {
      ...parent,
      internals: {
        ...parent.internals,
        nodes: next.nodes,
        edges: next.edges,
      },
    }
  })
}

export function appendCanonicalNetworkNode(
  project: WorkflowProject,
  parentCanvasId: CanonicalScopeId,
  node: WorkflowProjectNode,
): WorkflowProject {
  return updateCanonicalNetworkScope(project, parentCanvasId, (scope) => ({
    ...scope,
    nodes: [...scope.nodes, node],
  }))
}

export function appendCanonicalNetworkEdge(
  project: WorkflowProject,
  parentCanvasId: CanonicalScopeId,
  edge: WorkflowProjectEdge,
): WorkflowProject {
  return updateCanonicalNetworkScope(project, parentCanvasId, (scope) => ({
    ...scope,
    edges: [...scope.edges, edge],
  }))
}

export function removeCanonicalNetworkItems(
  project: WorkflowProject,
  parentCanvasId: CanonicalScopeId,
  nodeIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>,
): WorkflowProject {
  if (nodeIds.size === 0 && edgeIds.size === 0) return project
  return updateCanonicalNetworkScope(project, parentCanvasId, (scope) => ({
    nodes: scope.nodes.filter((node) => !nodeIds.has(node.id)),
    edges: scope.edges.filter(
      (edge) =>
        !edgeIds.has(edge.id) &&
        !nodeIds.has(edge.source) &&
        !nodeIds.has(edge.target),
    ),
  }))
}

export function syncCanonicalNetworkNodePositions(
  project: WorkflowProject,
  parentCanvasId: CanonicalScopeId,
  nodes: ReadonlyArray<{ id: string; position: { x: number; y: number } }>,
): WorkflowProject {
  return nodes.reduce((nextProject, node) => {
    if (canonicalLocalNodeId(parentCanvasId, node.id) === null) return nextProject
    return updateCanonicalProjectNodeByCanvasId(nextProject, node.id, (canonicalNode) => ({
      ...canonicalNode,
      ui: {
        ...canonicalNode.ui,
        position:
          parentCanvasId === null
            ? node.position
            : canonicalPositionFromNetworkCanvas(node.position),
      },
    }))
  }, project)
}

function findCanonicalProjectNodeByCanvasId(
  project: WorkflowProject,
  canvasNodeId: string,
): WorkflowProjectNode | undefined {
  const visit = (nodes: WorkflowProjectNode[], canvasParentId: string): WorkflowProjectNode | undefined => {
    for (const node of nodes) {
      const scopedId = canvasParentId ? `${canvasParentId}__${node.id}` : node.id
      if (scopedId === canvasNodeId) return node
      const child = visit((node.internals?.nodes ?? []).filter(isCanonicalProjectNode), scopedId)
      if (child) return child
    }
    return undefined
  }
  return visit(project.nodes, "")
}

function updateNodeList(
  nodes: WorkflowProjectNode[],
  canvasParentId: string,
  targetCanvasId: string,
  updater: (node: WorkflowProjectNode) => WorkflowProjectNode,
): { nodes: WorkflowProjectNode[]; changed: boolean } {
  let changed = false
  const nextNodes = nodes.map((node) => {
    const scopedId = canvasParentId ? `${canvasParentId}__${node.id}` : node.id
    if (scopedId === targetCanvasId) {
      changed = true
      return updater(node)
    }

    const children = (node.internals?.nodes ?? []).filter(isCanonicalProjectNode)
    if (children.length === 0) return node
    const nested = updateNodeList(children, scopedId, targetCanvasId, updater)
    if (!nested.changed) return node
    changed = true
    return {
      ...node,
      internals: {
        ...node.internals,
        nodes: nested.nodes,
        edges: node.internals?.edges ?? [],
      },
    }
  })
  return { nodes: changed ? nextNodes : nodes, changed }
}

function isCanonicalProjectNode(value: unknown): value is WorkflowProjectNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const node = value as Partial<WorkflowProjectNode>
  return typeof node.id === "string" && typeof node.kind === "string" && typeof node.capability === "string"
}

function isCanonicalProjectEdge(value: unknown): value is WorkflowProjectEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const edge = value as Partial<WorkflowProjectEdge>
  return typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string"
}
