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
  manifest?: Record<string, unknown>
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

type WorkflowRunBlockReasonLike = {
  message?: string | null
  details?: Record<string, unknown>
}

type WorkflowRunStateLike = {
  status?: string
  blockReasons?: WorkflowRunBlockReasonLike[]
}

export type BlockedActionView = {
  message: string
  actionLabel: string
  href: string
  missingLabels: string[]
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

export function blockedActionViewForRuntime(data: {
  runtimeCapability?: WorkflowRuntimeCapability
  runtimeRunState?: WorkflowRunStateLike
}): BlockedActionView | null {
  const runtimeCapability = data.runtimeCapability
  const runState = data.runtimeRunState
  const blockReasons = runState?.blockReasons ?? []
  const blocked =
    runtimeCapability?.status === "blocked" ||
    runState?.status === "blocked" ||
    blockReasons.length > 0
  if (!blocked) return null

  const missing = safeMissingKeys([
    ...(runtimeCapability?.missing ?? []),
    ...blockReasons.flatMap((reason) => missingKeysFromDetails(reason.details)),
  ])
  const keyText = missing.join(" ")
  const firstReason = blockReasons.find((reason) => reason.message)?.message
  return {
    message: sanitizeResourceText(firstReason ?? runtimeCapability?.reason ?? "Runtime resources must be resolved before this node can run."),
    actionLabel: actionLabelForMissing(keyText),
    href: actionHrefForMissing(keyText),
    missingLabels: missing.map(displayMissingLabel),
  }
}

function missingKeysFromDetails(details: Record<string, unknown> | undefined): string[] {
  if (!details) return []
  return ["required_params", "missing", "missing_params", "resources"].flatMap((key) => {
    const value = details[key]
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string")
    return typeof value === "string" ? [value] : []
  })
}

function safeMissingKeys(values: string[]): string[] {
  const hidden = /(cookie|profile|worker|headless|browser|command)/i
  return Array.from(new Set(values.filter((value) => value && !hidden.test(value)))).slice(0, 4)
}

function displayMissingLabel(value: string): string {
  if (value.includes("turbopush")) return "TurboPush Service"
  if (value.includes("send_permission") || value.includes("notification_permission")) return "Send Permission"
  if (value.includes("webhook")) return "Webhook Config"
  if (value.includes("projection")) return "Runtime Projection"
  if (value.includes("resource")) return "Runtime Resource"
  return value.split("_").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")
}

function actionLabelForMissing(keyText: string): string {
  if (keyText.includes("turbopush")) return "Connect TurboPush"
  if (keyText.includes("send_permission") || keyText.includes("notification_permission")) return "Enable Send"
  if (keyText.includes("webhook")) return "Configure Webhook"
  if (keyText.includes("resource") || keyText.includes("projection")) return "Resolve Resources"
  return "Open Runtime Center"
}

function actionHrefForMissing(keyText: string): string {
  if (keyText.includes("turbopush") || keyText.includes("resource")) return "/nodes"
  if (keyText.includes("webhook")) return "/notifications"
  return "/tasks"
}

function sanitizeResourceText(value: string): string {
  return value
    .replace(/\bcookies?\b/gi, "runtime session")
    .replace(/\bprofiles?\b/gi, "runtime identity")
    .replace(/\bworkers?\b/gi, "runtime capacity")
    .replace(/\bheadless\b/gi, "runtime")
}
