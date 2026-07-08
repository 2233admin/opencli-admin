import type { FlowSnapshot, FreehandStroke, WorkflowEdge, WorkflowNode } from "./types"

export const HISTORY_LIMIT = 100

export function snapshot(state: {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  drawings: FreehandStroke[]
}): FlowSnapshot {
  return {
    nodes: JSON.parse(JSON.stringify(state.nodes)),
    edges: JSON.parse(JSON.stringify(state.edges)),
    drawings: JSON.parse(JSON.stringify(state.drawings)),
  }
}
