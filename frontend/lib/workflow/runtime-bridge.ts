import type { WorkflowEdge, WorkflowNode, WorkflowNodeData } from "@/lib/flow/types"
import type { WorkflowCompileError, WorkflowCompileResponse } from "./backend-compile"
import type { WorkflowOpenCLIHDATraceDispatchItem, WorkflowOpenCLIHDATraceResponse } from "./backend-opencli-hda-trace"
import type { WorkflowEvidenceBatchProjection, WorkflowEvidenceBatchSummary } from "./backend-runs"

export type WorkflowRuntimeBridgePreview = {
  compile?: WorkflowCompileResponse | null
  trace?: WorkflowOpenCLIHDATraceResponse | null
}

export type WorkflowRuntimeNodePatch = {
  nodeId: string
  data: Partial<WorkflowNodeData>
}

export function buildRuntimeNodePatches(preview: WorkflowRuntimeBridgePreview): WorkflowRuntimeNodePatch[] {
  const patches = new Map<string, Partial<WorkflowNodeData>>()

  const mergePatch = (nodeId: string | null | undefined, data: Partial<WorkflowNodeData>) => {
    if (!nodeId) return
    const current = patches.get(nodeId) ?? {}
    patches.set(nodeId, {
      ...current,
      ...data,
      runtimePreview: {
        ...current.runtimePreview,
        ...data.runtimePreview,
        internalNodeIds: mergeStringLists(current.runtimePreview?.internalNodeIds, data.runtimePreview?.internalNodeIds),
        sourceGroups: mergeStringLists(current.runtimePreview?.sourceGroups, data.runtimePreview?.sourceGroups),
      },
    })
  }

  for (const error of preview.compile?.errors ?? []) {
    mergePatch(error.node_id, errorPatch(error))
  }

  for (const node of preview.compile?.plan?.runtime.nodes ?? []) {
    const runtime = node.runtime
    const binding = readRecord(runtime.binding)
    const missingRuntime = readRecord(runtime.missing_runtime)
    const visibleNodeId = readString(runtime.package_parent_id) ?? node.id

    if (binding) {
      mergePatch(visibleNodeId, {
        status: "success",
        runtimePreview: {
          status: "bound",
          worker: readString(binding.worker),
          functionId: readString(binding.function_id),
          internalNodeIds: visibleNodeId === node.id ? [] : [node.id],
        },
      })
      continue
    }

    if (missingRuntime && readString(missingRuntime.code) === "missing_runtime_parameter") {
      mergePatch(visibleNodeId, {
        status: "error",
        runtimePreview: {
          status: "blocked",
          diagnostic: readString(missingRuntime.message) ?? "Missing runtime parameter",
          internalNodeIds: visibleNodeId === node.id ? [] : [node.id],
        },
      })
    }
  }

  for (const error of preview.trace?.errors ?? []) {
    mergePatch(error.node_id, errorPatch(error))
  }

  if (preview.trace?.valid) {
    const dispatchCountByNode = new Map<string, WorkflowOpenCLIHDATraceDispatchItem[]>()
    for (const dispatch of preview.trace.dispatches) {
      const visibleNodeId = dispatch.packageNodeId ?? packageIdFromInternalNode(dispatch.nodeId) ?? dispatch.nodeId
      dispatchCountByNode.set(visibleNodeId, [...(dispatchCountByNode.get(visibleNodeId) ?? []), dispatch])
    }

    for (const [nodeId, dispatches] of dispatchCountByNode) {
      mergePatch(nodeId, {
        status: "running",
        runArtifact: {
          runId: preview.trace.runId,
          artifactPath: `runtime://${preview.trace.traceId}`,
          apiPath: `/api/v1/workflows/opencli-hda/trace`,
        },
        runtimePreview: {
          status: "dispatch-ready",
          runId: preview.trace.runId,
          traceId: preview.trace.traceId,
          dispatchCount: dispatches.length,
          worker: preview.trace.dispatch?.worker,
          functionId: preview.trace.dispatch?.functionId,
          sourceGroups: dispatches.map((dispatch) => dispatch.sourceGroup),
          internalNodeIds: dispatches.map((dispatch) => dispatch.nodeId),
        },
      })
    }
  }

  return Array.from(patches.entries()).map(([nodeId, data]) => ({ nodeId, data }))
}

export function applyRuntimeNodePatches(nodes: WorkflowNode[], patches: WorkflowRuntimeNodePatch[]): WorkflowNode[] {
  if (patches.length === 0) return nodes
  const byId = new Map(patches.map((patch) => [patch.nodeId, patch.data]))
  return nodes.map((node) => {
    const patch = byId.get(node.id)
    if (!patch) return node
    return {
      ...node,
      data: {
        ...node.data,
        ...patch,
        runtimePreview: {
          ...node.data.runtimePreview,
          ...patch.runtimePreview,
        },
      },
    }
  })
}

export function applyEvidenceBatchRuntimePatches(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  projection: WorkflowEvidenceBatchProjection,
  batches: WorkflowEvidenceBatchSummary[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const batchesByNodeId = new Map<string, WorkflowEvidenceBatchSummary[]>()
  for (const batch of batches) {
    const nodeId = batch.packageNodeId ?? visibleRuntimeNodeId(batch.nodeId)
    batchesByNodeId.set(nodeId, [...(batchesByNodeId.get(nodeId) ?? []), batch])
  }

  const nextNodes = nodes.map((node) => {
    const batches = batchesByNodeId.get(node.id) ?? batchesByNodeId.get(node.id.replace("__", "::"))
    if (!batches) return node
    const status = evidenceBatchStatus(batches)
    const nodeStatus: WorkflowNodeData["status"] =
      status === "completed" ? "success" : status === "blocked" || status === "failed" ? "error" : "running"
    return {
      ...node,
      data: {
        ...node.data,
        status: nodeStatus,
        runtimeEvidenceBatches: batches,
        runtimePreview: {
          ...node.data.runtimePreview,
          status: `evidence-${status}`,
          runId: projection.runId,
          traceId: projection.traceId,
          diagnostic:
            projection.missingSources
              .filter((source) => visibleRuntimeNodeId(source.nodeId) === node.id)
              .flatMap((source) => source.reasons)
              .at(-1)?.message ?? node.data.runtimePreview?.diagnostic,
        },
      },
    }
  })

  const nextEdges = edges.map((edge) => {
    const batches = batchesByNodeId.get(edge.source) ?? batchesByNodeId.get(edge.source.replace("__", "::"))
    if (!batches) return edge
    return {
      ...edge,
      animated: evidenceBatchStatus(batches) === "partial",
      data: {
        ...edge.data,
        runtimeEvidenceBatch: {
          runId: projection.runId,
          status: evidenceBatchStatus(batches),
          batchIds: batches.map((batch) => batch.batchId),
          itemCount: batches.reduce((sum, batch) => sum + batch.itemCount, 0),
          recordCount: batches.reduce((sum, batch) => sum + batch.recordCount, 0),
        },
      },
    }
  })

  return { nodes: nextNodes, edges: nextEdges }
}

function errorPatch(error: WorkflowCompileError): Partial<WorkflowNodeData> {
  return {
    status: "error",
    runtimePreview: {
      status: "blocked",
      diagnostic: error.message,
    },
  }
}

function packageIdFromInternalNode(nodeId: string): string | null {
  const separatorIndex = nodeId.indexOf("::")
  if (separatorIndex <= 0) return null
  return nodeId.slice(0, separatorIndex)
}

function visibleRuntimeNodeId(nodeId: string): string {
  return packageIdFromInternalNode(nodeId) ?? nodeId
}

function evidenceBatchStatus(batches: WorkflowEvidenceBatchSummary[]): WorkflowEvidenceBatchSummary["status"] {
  if (batches.some((batch) => batch.status === "blocked")) return "blocked"
  if (batches.some((batch) => batch.status === "failed")) return "failed"
  if (batches.some((batch) => batch.status === "partial")) return "partial"
  if (batches.some((batch) => batch.status === "running")) return "running"
  if (batches.some((batch) => batch.status === "queued")) return "queued"
  return "completed"
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function mergeStringLists(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const values = [...(left ?? []), ...(right ?? [])].filter(Boolean)
  if (values.length === 0) return undefined
  return Array.from(new Set(values))
}
