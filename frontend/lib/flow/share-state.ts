import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string"
import type { WorkflowProject } from "@/lib/workflow/schema"
import type { FlowSnapshot, WorkflowEdge, WorkflowNode } from "./types"

const SHARE_PARAM = "flow"

export interface ShareState {
  schema: "react-flow-powerpack.share.v1"
  workflowProject: WorkflowProject
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  drawings?: FlowSnapshot["drawings"]
}

export function encodeShareState(state: Omit<ShareState, "schema">): string {
  return compressToEncodedURIComponent(JSON.stringify({ schema: "react-flow-powerpack.share.v1", ...state }))
}

export function decodeShareState(encoded: string): ShareState | null {
  try {
    const raw = decompressFromEncodedURIComponent(encoded)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ShareState
    return parsed.schema === "react-flow-powerpack.share.v1" ? parsed : null
  } catch {
    return null
  }
}

export function buildShareUrl(state: Omit<ShareState, "schema">, baseHref: string): string {
  const url = new URL(baseHref)
  url.searchParams.set(SHARE_PARAM, encodeShareState(state))
  return url.toString()
}

export function loadShareStateFromUrl(href: string): ShareState | null {
  const url = new URL(href)
  const encoded = url.searchParams.get(SHARE_PARAM)
  return encoded ? decodeShareState(encoded) : null
}
