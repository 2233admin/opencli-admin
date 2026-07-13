import type { WorkflowNodeData } from "@/lib/flow/types"
import {
  isUserFacingRuntimeParam,
  runtimeContractForCapability,
  type WorkflowCapabilityStatus,
  type WorkflowRuntimeContractStatus,
} from "./capabilities"
import { getNodeContract, type NodeContract } from "./node-contracts"
import { getNodeInternals, type NodeInternals } from "./node-internals"
import type { WorkflowProjectNode } from "./schema"

export type CanonicalNodePort = {
  id: string
  direction: "input" | "output"
  type: string
  required: boolean
  description?: string
}

export type CanonicalNodeParam = {
  id: string
  value: unknown
  required: boolean
  type?: string
  description?: string
}

export type CanonicalNodeViewContract = {
  identity: {
    id: string
    catalogId?: string
    label: string
    kind: string
    capability: string
  }
  status: {
    capability?: WorkflowCapabilityStatus
    contract?: WorkflowRuntimeContractStatus
    reason?: string | null
    missing: string[]
  }
  ports: CanonicalNodePort[]
  params: CanonicalNodeParam[]
  internals?: NodeInternals
  outputs: {
    artifacts: string[]
    evidenceBatchCount: number
    evidenceItemCount: number
  }
  trace: {
    events: string[]
    runId?: string
    traceId?: string
    latestEventType?: string
  }
  staticContract?: NodeContract
}

export function buildCanonicalNodeViewContract(
  projectNode: WorkflowProjectNode | undefined,
  data: WorkflowNodeData,
  fallbackNodeId?: string,
): CanonicalNodeViewContract {
  const canonical = readRecord(data.canonical)
  const catalogId = readString(projectNode?.ui?.catalogId) ?? readString(canonical?.catalogId)
  const staticContract = getNodeContract(projectNode)
  const runtimeContract = data.runtimeContract ?? runtimeContractForCapability(data.runtimeCapability)
  const ports = runtimeContract
    ? [
        ...runtimeContract.inputShape.ports.map((port) => ({ ...port, direction: "input" as const })),
        ...runtimeContract.outputShape.ports.map((port) => ({ ...port, direction: "output" as const })),
      ].map((port) => ({
        id: port.name,
        direction: port.direction,
        type: port.type,
        required: true,
      }))
    : (staticContract?.ports ?? [])

  const paramIds = runtimeContract?.inputShape.params ?? staticContract?.params.map((param) => param.id) ?? []
  const params = paramIds.filter(isUserFacingRuntimeParam).map((id) => {
    const spec = staticContract?.params.find((param) => param.id === id)
    return {
      id,
      value: projectNode?.params[id] ?? spec?.defaultValue,
      required: spec?.required ?? false,
      type: spec?.type,
      description: spec?.description,
    }
  })
  const batches = data.runtimeEvidenceBatches ?? []

  return {
    identity: {
      id: projectNode?.id ?? fallbackNodeId ?? data.runtimeRunState?.nodeId ?? "unknown",
      catalogId,
      label: data.label,
      kind: projectNode?.kind ?? readString(canonical?.kind) ?? data.category,
      capability: projectNode?.capability ?? readString(canonical?.capability) ?? data.nodeType,
    },
    status: {
      capability: data.runtimeCapability?.status,
      contract: runtimeContract?.status,
      reason: data.runtimeCapability?.reason,
      missing: data.runtimeCapability?.missing ?? [],
    },
    ports,
    params,
    internals: getNodeInternals(projectNode),
    outputs: {
      artifacts: runtimeContract?.outputShape.artifacts ?? [],
      evidenceBatchCount: batches.length,
      evidenceItemCount: batches.reduce((sum, batch) => sum + batch.itemCount, 0),
    },
    trace: {
      events: runtimeContract?.eventShape.events ?? [],
      runId: data.runtimePreview?.runId,
      traceId: data.runtimePreview?.traceId,
      latestEventType: data.runtimeLatestEvent?.eventType,
    },
    staticContract,
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
