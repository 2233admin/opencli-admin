import type { WorkflowEdge, WorkflowNode } from "./types"

export function findConnectedComponents(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[][] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const adjacency = new Map<string, Set<string>>()
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, new Set())
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }

  const visited = new Set<string>()
  const components: string[][] = []

  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const stack = [node.id]
    const component: string[] = []
    visited.add(node.id)

    while (stack.length > 0) {
      const current = stack.pop()!
      component.push(current)
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        stack.push(next)
      }
    }

    components.push(component)
  }

  return components
}

export function findConnectedComponentForNode(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  return findConnectedComponents(nodes, edges).find((component) => component.includes(nodeId)) ?? []
}

export function connectedComponentEdges(nodeIds: string[], edges: WorkflowEdge[]): string[] {
  const ids = new Set(nodeIds)
  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => edge.id)
}
