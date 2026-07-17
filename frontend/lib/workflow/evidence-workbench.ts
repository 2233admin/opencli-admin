"use client"

import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeData,
} from "@/lib/flow/types"
import type {
  WorkflowEvidenceBatchStatus,
  WorkflowEvidenceBatchSummary,
  WorkflowEvidenceProjection,
} from "./backend-runs"

export type EvidenceWorkbenchState = {
  status: "idle" | "loading" | "ready" | "error"
  projection: WorkflowEvidenceProjection | null
  batches: WorkflowEvidenceBatchSummary[]
  selectedBatchId: string | null
  error: string | null
}

export function emptyEvidenceWorkbenchState(): EvidenceWorkbenchState {
  return {
    status: "idle",
    projection: null,
    batches: [],
    selectedBatchId: null,
    error: null,
  }
}

export function evidenceWorkbenchMetrics(
  state: Pick<EvidenceWorkbenchState, "projection" | "batches">,
) {
  const projection = state.projection
  return {
    batchCount: state.batches.length,
    itemCount: state.batches.reduce((sum, batch) => sum + batch.itemCount, 0),
    recordCount: state.batches.reduce((sum, batch) => sum + batch.recordCount, 0),
    partialCount: state.batches.filter((batch) => batch.status === "partial").length,
    blockedCount: projection?.nodes.filter((node) => node.status === "blocked" || node.status === "failed").length ?? 0,
    missingSourceCount: projection?.missingSources.length ?? 0,
  }
}

export function evidenceBatchStatus(batches: WorkflowEvidenceBatchSummary[]): WorkflowEvidenceBatchStatus {
  if (batches.some((batch) => batch.status === "blocked")) return "blocked"
  if (batches.some((batch) => batch.status === "failed")) return "failed"
  if (batches.some((batch) => batch.status === "partial")) return "partial"
  if (batches.some((batch) => batch.status === "ready")) return "ready"
  if (batches.some((batch) => batch.status === "missing")) return "missing"
  return "completed"
}

export function applyEvidenceWorkbenchNodeState(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  projection: WorkflowEvidenceProjection,
  batches: WorkflowEvidenceBatchSummary[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const batchesByNodeId = new Map<string, WorkflowEvidenceBatchSummary[]>()
  for (const batch of batches) {
    for (const nodeId of visibleNodeIds(batch.nodeId, batch.packageNodeId)) {
      batchesByNodeId.set(nodeId, [...(batchesByNodeId.get(nodeId) ?? []), batch])
    }
  }

  const nextNodes = nodes.map((node) => {
    const nodeBatches = batchesByNodeId.get(node.id)
    if (!nodeBatches) return node
    const status = evidenceBatchStatus(nodeBatches)
    return {
      ...node,
      data: {
        ...node.data,
        status: canvasStatus(status),
        runtimeEvidenceBatches: nodeBatches,
        runtimePreview: {
          ...node.data.runtimePreview,
          status: `evidence-${status}`,
          runId: projection.runId,
          diagnostic: latestMissingSourceMessage(projection, node.id) ?? node.data.runtimePreview?.diagnostic,
        },
      },
    }
  })

  const nextEdges = edges.map((edge) => {
    const nodeBatches = batchesByNodeId.get(edge.source)
    if (!nodeBatches) return edge
    const status = evidenceBatchStatus(nodeBatches)
    return {
      ...edge,
      animated: status === "partial" || status === "ready",
      data: {
        ...edge.data,
        runtimeEvidenceBatch: {
          runId: projection.runId,
          status: toRunStatus(status),
          batchIds: nodeBatches.map((batch) => batch.batchId),
          itemCount: nodeBatches.reduce((sum, batch) => sum + batch.itemCount, 0),
          recordCount: nodeBatches.reduce((sum, batch) => sum + batch.recordCount, 0),
        },
      },
    }
  })

  return { nodes: nextNodes, edges: nextEdges }
}

function visibleNodeIds(nodeId: string, packageNodeId?: string | null): string[] {
  const ids = [nodeId]
  if (packageNodeId) ids.push(packageNodeId)
  const separatorIndex = nodeId.indexOf("::")
  if (separatorIndex > 0) ids.push(nodeId.replace("::", "__"))
  return Array.from(new Set(ids))
}

function latestMissingSourceMessage(projection: WorkflowEvidenceProjection, nodeId: string): string | undefined {
  return projection.missingSources.find((source) =>
    [source.nodeId, source.packageNodeId, source.internalNodeId].includes(nodeId),
  )?.reason ?? undefined
}

function canvasStatus(status: WorkflowEvidenceBatchStatus): WorkflowNodeData["status"] {
  if (status === "completed" || status === "ingested") return "success"
  if (status === "blocked" || status === "failed" || status === "missing") return "error"
  return "running"
}

function toRunStatus(status: WorkflowEvidenceBatchStatus): "queued" | "running" | "partial" | "blocked" | "completed" | "failed" {
  if (status === "ready") return "running"
  if (status === "ingested") return "completed"
  if (status === "missing") return "blocked"
  return status
}
