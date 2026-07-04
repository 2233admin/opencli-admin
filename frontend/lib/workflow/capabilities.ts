export type WorkflowCapabilitySurface =
  | "catalog"
  | "primitive"
  | "channel"
  | "notifier"
  | "trigger"
  | "resource"

export type WorkflowCapabilityStatus = "runnable" | "blocked" | "preview_only" | "design_only"

export type WorkflowRuntimeCapability = {
  id: string
  label: string
  surface: WorkflowCapabilitySurface
  status: WorkflowCapabilityStatus
  backendAvailable: boolean
  kind?: string | null
  capability?: string | null
  provider?: string | null
  channelType?: string | null
  notifierType?: string | null
  runtimeBinding?: string | null
  reason?: string | null
  missing: string[]
  tags: string[]
  source?: string | null
}

export type WorkflowCapabilitiesResponse = {
  version: string
  catalog: WorkflowRuntimeCapability[]
  primitives: WorkflowRuntimeCapability[]
  channels: WorkflowRuntimeCapability[]
  notifiers: WorkflowRuntimeCapability[]
  triggers: WorkflowRuntimeCapability[]
  resources: WorkflowRuntimeCapability[]
}

export type WorkflowCapabilitiesIndex = {
  catalog: Map<string, WorkflowRuntimeCapability>
  primitives: Map<string, WorkflowRuntimeCapability>
}

export function indexWorkflowCapabilities(
  capabilities: WorkflowCapabilitiesResponse | null | undefined,
): WorkflowCapabilitiesIndex {
  return {
    catalog: new Map((capabilities?.catalog ?? []).map((item) => [item.id, item])),
    primitives: new Map((capabilities?.primitives ?? []).map((item) => [item.id, item])),
  }
}

export function catalogRuntimeCapability(
  capabilities: WorkflowCapabilitiesResponse | null | undefined,
  catalogId: string,
): WorkflowRuntimeCapability | undefined {
  return indexWorkflowCapabilities(capabilities).catalog.get(catalogId)
}

export function primitiveRuntimeCapability(
  capabilities: WorkflowCapabilitiesResponse | null | undefined,
  primitiveId: string,
): WorkflowRuntimeCapability | undefined {
  return indexWorkflowCapabilities(capabilities).primitives.get(primitiveId)
}

export function runtimeStatusLabel(status: WorkflowCapabilityStatus | undefined): string {
  switch (status) {
    case "runnable":
      return "REAL"
    case "blocked":
      return "BLOCKED"
    case "preview_only":
      return "PREVIEW"
    case "design_only":
      return "DESIGN"
    default:
      return "UNKNOWN"
  }
}

export function runtimeStatusTone(status: WorkflowCapabilityStatus | undefined): string {
  switch (status) {
    case "runnable":
      return "border-[#4ade80]/50 bg-[#4ade80]/10 text-[#4ade80]"
    case "blocked":
      return "border-[#f87171]/50 bg-[#f87171]/10 text-[#f87171]"
    case "preview_only":
      return "border-[#ffb86b]/50 bg-[#ffb86b]/10 text-[#ffb86b]"
    case "design_only":
      return "border-muted-foreground/40 bg-muted/30 text-muted-foreground"
    default:
      return "border-border bg-background/60 text-muted-foreground"
  }
}
