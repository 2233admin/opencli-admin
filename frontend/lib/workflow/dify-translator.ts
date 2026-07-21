import {
  parseWorkflowProject,
  type WorkflowCapability,
  type WorkflowNodeKind,
  type WorkflowProject,
  type WorkflowProjectEdge,
  type WorkflowProjectNode,
} from "./schema"

type JsonRecord = Record<string, unknown>

type DifyDsl = {
  app?: unknown
  kind?: unknown
  version?: unknown
  workflow: JsonRecord
}

type NodeMapping = {
  kind: WorkflowNodeKind
  capability: WorkflowCapability
  icon: string
  color: string
}

export type DifyTranslationReport = {
  source: "dify"
  workflowName: string
  appMode?: string
  nodeCount: number
  edgeCount: number
  adapterCount: number
  unsupportedEdgeCount: number
  executable: boolean
  runtimeSource: "backend" | "browser-fallback"
  blockers: DifyCompatibilityBlocker[]
  sourceSha256?: string
  inspection?: DifyInspectionSummary
  backendError?: string
}

export type DifyCompatibilityBlocker = {
  code: string
  message: string
  nodeId?: string | null
}

export type DifyInspectionSummary = {
  loadStatus: "ready" | "blocked" | "unsupported" | "failed"
  loadReason?: string | null
  engine: {
    name: string
    version: string
    commit: string
  }
  appMode?: string | null
  nodes: Array<{
    sourceNodeId: string
    type: string
    status: string
  }>
  dependencies: Array<{
    type: string
    id: string
  }>
  blockers: DifyCompatibilityBlocker[]
}

export type DifyTranslationResult =
  | { ok: true; project: WorkflowProject; report: DifyTranslationReport }
  | { ok: false; error: string }

export function isDifyWorkflow(input: unknown): input is DifyDsl {
  if (!isRecord(input) || !isRecord(input.workflow)) return false
  const graph = input.workflow.graph
  return input.kind === "app" && isRecord(graph) && Array.isArray(graph.nodes)
}

export function translateDifyWorkflowToWorkflowProject(input: unknown): DifyTranslationResult {
  if (!isDifyWorkflow(input)) return { ok: false, error: "Input is not a Dify app DSL" }

  const graph = isRecord(input.workflow.graph) ? input.workflow.graph : {}
  const nodeEntries = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : []
  if (nodeEntries.length === 0) return { ok: false, error: "Dify workflow has no nodes" }

  const app = isRecord(input.app) ? input.app : {}
  const workflowName = readString(app.name) ?? "Dify Workflow Import"
  const usedNodeIds = new Set<string>()
  const nodeLookup = new Map<string, string>()
  const nodes = nodeEntries.map((entry, index) => {
    const translated = translateNode(entry, index, usedNodeIds, readString(input.version))
    const sourceId = readString(entry.id)
    if (sourceId) nodeLookup.set(sourceId, translated.id)
    return translated
  })
  const translatedEdges = translateEdges(graph.edges, nodeLookup)
  const packageId = uniqueSlug(`dify-package-${workflowName}`, new Set())
  const project = parseWorkflowProject({
    id: uniqueSlug(`dify-${workflowName}`, new Set()),
    name: workflowName,
    profile: "intelligence",
    version: 1,
    nodes: [
      {
        id: packageId,
        kind: "action",
        capability: "store",
        params: {
          packageFormat: "dify",
          packageExecution: "blocked",
          appMode: readString(app.mode),
          dslVersion: readString(input.version),
          compatRuntime: {
            target: "dify",
            loadStatus: "blocked",
            loadReason: "dify_backend_inspection_required",
          },
        },
        internals: { locked: true, nodes, edges: translatedEdges.edges },
        ui: {
          label: workflowName,
          description: `Dify compatibility package · ${nodes.length} nodes`,
          icon: "Boxes",
          color: "var(--chart-2)",
          catalogId: "package.compat.dify-workflow",
          package: {
            format: "dify",
            expandable: true,
            nodeCount: nodes.length,
            edgeCount: translatedEdges.edges.length,
          },
          builder: {
            capabilityGaps: [
              {
                id: "dify-backend-inspection-required",
                title: "Graphon 后端检查未完成",
                detail: "浏览器翻译仅用于结构预览，不能发布或运行。",
                blockingActions: ["publish", "run"],
              },
            ],
          },
        },
      },
    ],
    edges: [],
    adapters: [],
    settings: {
      timezone: readString(input.workflow.timezone) ?? "Asia/Shanghai",
      deterministicSimulation: true,
      maxItemsPerRun: Math.max(20, nodes.length),
    },
    agentPermissions: {
      canFetchNetwork: false,
      canSendNotifications: false,
      canWriteInbox: true,
      allowedDomains: [],
    },
  })

  return {
    ok: true,
    project,
    report: {
      source: "dify",
      workflowName,
      appMode: readString(app.mode),
      nodeCount: nodes.length,
      edgeCount: translatedEdges.edges.length,
      adapterCount: project.adapters.length,
      unsupportedEdgeCount: translatedEdges.unsupportedEdgeCount,
      executable: false,
      runtimeSource: "browser-fallback",
      blockers: [
        {
          code: "dify_backend_inspection_required",
          message: "浏览器翻译仅用于结构预览；必须经后端 Graphon 检查后才能执行。",
        },
      ],
    },
  }
}

function translateNode(
  entry: JsonRecord,
  index: number,
  usedIds: Set<string>,
  dslVersion?: string,
): WorkflowProjectNode {
  const data = isRecord(entry.data) ? entry.data : {}
  const nodeType = readString(data.type) ?? readString(entry.type) ?? "unknown"
  const title = readString(data.title) ?? `Dify ${nodeType} ${index + 1}`
  const sourceId = readString(entry.id)
  const mapping = classifyNode(nodeType)
  const id = uniqueSlug(`${prefixFor(mapping)}-${title}`, usedIds)
  return {
      id,
      kind: mapping.kind,
      capability: mapping.capability,
      params: {
        difyType: nodeType,
        title,
        config: compactData(data),
        compatRuntime: {
          target: "dify",
          dslVersion,
          nodeType,
          sourceNodeId: sourceId,
        },
      },
      sourceAnchor: {
        kind: "artifact",
        label: `dify:${title}`,
        artifactPath: "dify-workflow.yml",
        selector: sourceId ?? title,
      },
      ui: {
        label: title,
        description: readString(data.desc) ?? `${nodeType} from Dify import`,
        icon: mapping.icon,
        color: mapping.color,
        position: readPosition(entry.position) ?? { x: 420 + (index % 4) * 300, y: 100 + Math.floor(index / 4) * 180 },
        dify: { source: "dify", originalId: sourceId, type: nodeType },
      },
  }
}

function classifyNode(type: string): NodeMapping {
  const value = type.toLowerCase()
  if (["start", "trigger", "trigger-webhook"].includes(value)) {
    return { kind: "schedule", capability: "trigger", icon: "Play", color: "var(--chart-1)" }
  }
  if (["if-else", "question-classifier", "iteration", "loop"].includes(value)) {
    return { kind: "router", capability: "route", icon: "GitBranch", color: "var(--chart-5)" }
  }
  if (["llm", "agent"].includes(value)) {
    return {
      kind: "agent",
      capability: "summarize",
      icon: "Sparkles",
      color: "var(--chart-2)",
    }
  }
  if (["knowledge-retrieval", "http-request", "tool"].includes(value)) {
    return {
      kind: "source",
      capability: "fetch",
      icon: "Globe",
      color: "var(--chart-4)",
    }
  }
  if (["answer", "end"].includes(value)) {
    return { kind: "notify", capability: "send", icon: "Send", color: "var(--chart-1)" }
  }
  if (["code", "template-transform", "variable-aggregator", "parameter-extractor", "document-extractor"].includes(value)) {
    return { kind: "agent", capability: "normalize", icon: "ArrowRightLeft", color: "var(--chart-2)" }
  }
  return { kind: "action", capability: "send", icon: "Play", color: "var(--chart-3)" }
}

function translateEdges(
  input: unknown,
  nodeLookup: Map<string, string>,
): { edges: WorkflowProjectEdge[]; unsupportedEdgeCount: number } {
  if (!Array.isArray(input)) return { edges: [], unsupportedEdgeCount: 0 }
  const usedIds = new Set<string>()
  const edges: WorkflowProjectEdge[] = []
  let unsupportedEdgeCount = 0

  for (const [index, entry] of input.entries()) {
    if (!isRecord(entry)) {
      unsupportedEdgeCount += 1
      continue
    }
    const source = nodeLookup.get(readString(entry.source) ?? "")
    const target = nodeLookup.get(readString(entry.target) ?? "")
    if (!source || !target) {
      unsupportedEdgeCount += 1
      continue
    }
    const data = isRecord(entry.data) ? entry.data : {}
    edges.push({
      id: uniqueSlug(readString(entry.id) ?? `e-${source}-${target}-${index}`, usedIds),
      source,
      target,
      sourcePort: readString(entry.sourceHandle),
      targetPort: readString(entry.targetHandle),
      label: readString(data.sourceType),
      semantic: { relationship: "implements", confidence: 0.72 },
      weight: 0.7,
      contractId: "edge.contract.dify",
      proposalState: "accepted",
      ui: { dify: { source: "dify", originalId: readString(entry.id) } },
    })
  }
  return { edges, unsupportedEdgeCount }
}

function compactData(data: JsonRecord): JsonRecord {
  const compact: JsonRecord = {}
  for (const key of ["type", "title", "model", "provider", "query_variable_selector", "dataset_ids", "method", "url", "code_language"]) {
    if (key in data) compact[key] = compactValue(data[key])
  }
  return compact
}

function compactValue(value: unknown): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  return serialized.length > 400 ? `${serialized.slice(0, 399)}...` : serialized
}

function prefixFor(mapping: NodeMapping): string {
  if (mapping.kind === "schedule") return "trigger"
  if (mapping.kind === "source") return "source"
  if (mapping.kind === "router") return "router"
  if (mapping.kind === "notify") return "notify"
  if (mapping.capability === "normalize") return "transform"
  if (mapping.capability === "summarize") return "agent"
  return "tool"
}

function uniqueSlug(input: string, used: Set<string>): string {
  const base = slugify(input)
  let candidate = base
  let index = 2
  while (used.has(candidate)) candidate = `${base}-${index++}`
  used.add(candidate)
  return candidate
}

function slugify(input: string): string {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)
  if (!slug) return "dify-node"
  return /^[0-9]/.test(slug) ? `d-${slug}` : slug
}

function readPosition(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined
  return typeof value.x === "number" && typeof value.y === "number" ? { x: value.x, y: value.y } : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
