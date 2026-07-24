import type { WorkflowCompileResponse } from "./backend-compile"
import type {
  WorkflowToolCapability,
  WorkflowToolCapabilitiesResponse,
} from "./backend-tool-capabilities"
import type { WorkflowCapabilitiesResponse } from "./capabilities"
import type { WorkflowProject, WorkflowProjectNode } from "./schema"

export const NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS = [
  "research",
  "ontology",
  "graph",
  "personas",
  "simulation.start",
  "simulation.run",
  "simulation.timeline",
  "simulation.stats",
  "interviews.all",
  "interviews.run",
  "interviews.history",
  "report.start",
  "report.progress",
  "report.run",
  "report.read",
  "report.ask",
  "report.answers",
  "close",
] as const

type NativeIntelligenceLifecycleAction =
  (typeof NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS)[number]

export type NativeIntelligencePreviewAction = {
  action: NativeIntelligenceLifecycleAction
  toolId: string
  label: string
  status: "runnable" | "blocked" | "missing"
  missingReasons: string[]
}

export type NativeIntelligencePreviewEvidence = {
  kind: "native_intelligence"
  packageNodeId: string
  status: "ready" | "blocked"
  dispatch: "none"
  mutates: false
  expectedActionCount: 18
  compiledNodeIds: string[]
  readiness: {
    status: string
    childCount: number
    expectedChildCount: number
    blockedChildren: string[]
  }
  actions: NativeIntelligencePreviewAction[]
  blockedActions: NativeIntelligenceLifecycleAction[]
  missingReasons: string[]
}

export function findNativeIntelligenceWorkflowPackageNodeId(
  project: WorkflowProject,
): string | null {
  const visit = (
    nodes: WorkflowProjectNode[],
    parentPath: string[] = [],
  ): string | null => {
    for (const node of nodes) {
      const nodePath = [...parentPath, node.id]
      if (node.params.template === "native-intelligence-lifecycle") {
        return nodePath.join("::")
      }
      const nested = visit(
        (node.internals?.nodes ?? []) as WorkflowProjectNode[],
        nodePath,
      )
      if (nested) return nested
    }
    return null
  }

  return visit(project.nodes)
}

export function buildNativeIntelligencePreviewEvidence({
  project,
  compile,
  capabilities,
  tools,
}: {
  project: WorkflowProject
  compile: WorkflowCompileResponse
  capabilities: WorkflowCapabilitiesResponse
  tools: WorkflowToolCapabilitiesResponse["tools"]
}): NativeIntelligencePreviewEvidence | null {
  const packageNodeId = findNativeIntelligenceWorkflowPackageNodeId(project)
  if (!packageNodeId) return null

  const packageCapability = capabilities.catalog.find(
    (capability) => capability.id === "package.intelligence.native-lifecycle",
  )
  const readiness = readRecord(packageCapability?.manifest?.readiness)
  const toolsByAction = new Map<string, WorkflowToolCapability>()
  for (const tool of tools) {
    const action = tool.executor.params?.action
    if (typeof action === "string" && !toolsByAction.has(action)) {
      toolsByAction.set(action, tool)
    }
  }

  const actions = NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS.map((action) => {
    const expectedToolId = `tool.intelligence.native.${action}`
    const tool = toolsByAction.get(action)
    const toolReadiness = readRecord(tool?.manifest.readiness)
    const exactTool = tool?.id === expectedToolId ? tool : undefined
    const status = exactTool
      ? exactTool.status === "runnable" && toolReadiness?.status !== "blocked"
        ? "runnable"
        : "blocked"
      : "missing"
    const missingReasons = uniqueStrings([
      ...readStrings(toolReadiness?.missingReasons),
      ...(status === "missing"
        ? [`missing_native_intelligence_action:${action}`]
        : []),
    ])
    return {
      action,
      toolId: expectedToolId,
      label: exactTool?.label ?? action,
      status,
      missingReasons,
    } satisfies NativeIntelligencePreviewAction
  })
  const blockedActions = actions
    .filter((action) => action.status !== "runnable")
    .map((action) => action.action)
  const childCount = readNumber(readiness?.childCount)
  const expectedChildCount = readNumber(readiness?.expectedChildCount)
  const readinessStatus = readString(readiness?.status) ?? "missing"
  const missingReasons = uniqueStrings([
    ...(compile.valid ? [] : compile.errors.map((error) => error.code)),
    ...(packageCapability?.missing ?? []),
    ...readStrings(readiness?.missingReasons),
    ...actions.flatMap((action) => action.missingReasons),
    ...(!packageCapability ? ["native_intelligence_package_capability_missing"] : []),
  ])
  const blocked =
    !compile.valid
    || compile.plan === null
    || packageCapability?.status !== "runnable"
    || readinessStatus !== "runnable"
    || childCount !== NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS.length
    || expectedChildCount !== NATIVE_INTELLIGENCE_LIFECYCLE_ACTIONS.length
    || blockedActions.length > 0

  return {
    kind: "native_intelligence",
    packageNodeId,
    status: blocked ? "blocked" : "ready",
    dispatch: "none",
    mutates: false,
    expectedActionCount: 18,
    compiledNodeIds: compile.plan?.runtime.node_ids ?? [],
    readiness: {
      status: readinessStatus,
      childCount,
      expectedChildCount,
      blockedChildren: readStrings(readiness?.blockedChildren),
    },
    actions,
    blockedActions,
    missingReasons,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function readNumber(value: unknown): number {
  return typeof value === "number" ? value : 0
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}
