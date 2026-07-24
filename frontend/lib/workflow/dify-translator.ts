import {
  parseWorkflowProject,
  type AdapterBinding,
  type WorkflowProject,
  type WorkflowProjectEdge,
  type WorkflowProjectNode,
} from "./schema"
import {
  DIFY_NODE_MAPPING_VERSION,
  isDifyCapabilityGap,
  resolveDifyNodeMapping,
  type DifyNodeMapping,
} from "./dify-node-mapping"

type JsonRecord = Record<string, unknown>

type DifyDsl = {
  app?: unknown
  kind?: unknown
  version?: unknown
  workflow: JsonRecord
}

type NodeMapping = DifyNodeMapping & {
  adapter?: Pick<AdapterBinding, "type" | "mode">
}

export type DifyTranslationReport = {
  source: "dify"
  mappingVersion: typeof DIFY_NODE_MAPPING_VERSION
  workflowName: string
  appMode?: string
  nodeCount: number
  edgeCount: number
  adapterCount: number
  unsupportedEdgeCount: number
  capabilityGapCount: number
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
  const adapters: AdapterBinding[] = []
  const nodes = nodeEntries.map((entry, index) => {
    const translated = translateNode(entry, index, usedNodeIds, readString(input.version))
    const sourceId = readString(entry.id)
    if (sourceId) nodeLookup.set(sourceId, translated.node.id)
    if (translated.adapter) adapters.push(translated.adapter)
    return translated.node
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
          appMode: readString(app.mode),
          dslVersion: readString(input.version),
        },
        internals: { locked: false, nodes, edges: translatedEdges.edges },
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
        },
      },
    ],
    edges: [],
    adapters: dedupeAdapters(adapters),
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
      mappingVersion: DIFY_NODE_MAPPING_VERSION,
      capabilityGapCount: nodeEntries.filter((entry) => {
        const data = isRecord(entry.data) ? entry.data : {}
        const nodeType = readString(data.type) ?? readString(entry.type) ?? "unknown"
        return isDifyCapabilityGap(resolveDifyNodeMapping(nodeType))
      }).length,
    },
  }
}

function translateNode(
  entry: JsonRecord,
  index: number,
  usedIds: Set<string>,
  dslVersion?: string,
): { node: WorkflowProjectNode; adapter?: AdapterBinding } {
  const data = isRecord(entry.data) ? entry.data : {}
  const nodeType = readString(data.type) ?? readString(entry.type) ?? "unknown"
  const title = readString(data.title) ?? `Dify ${nodeType} ${index + 1}`
  const sourceId = readString(entry.id)
  const mapping = classifyNode(nodeType)
  const id = uniqueSlug(`${prefixFor(mapping)}-${title}`, usedIds)
  const adapter = mapping.adapter
    ? {
        id: `dify-${id}`,
        type: mapping.adapter.type,
        provider: providerFor(data, nodeType),
        mode: mapping.adapter.mode,
        config: { nodeType, translatedFrom: "dify" },
      }
    : undefined

  return {
    node: {
      id,
      kind: mapping.kind,
      capability: mapping.capability,
      adapter: adapter?.id,
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
    },
    adapter,
  }
}

function classifyNode(type: string): NodeMapping {
  const mapping = resolveDifyNodeMapping(type)
  const adapter =
    mapping.id === "llm" || mapping.id === "agent"
      ? { type: "agent" as const, mode: "mock" as const }
      : mapping.id === "retrieval" || mapping.id === "http"
        ? { type: "source" as const, mode: "fixture" as const }
        : undefined
  return { ...mapping, adapter }
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

function providerFor(data: JsonRecord, fallback: string): string {
  const model = isRecord(data.model) ? data.model : {}
  return slugify(readString(model.provider) ?? readString(data.provider) ?? fallback).replace(/-/g, "_")
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

function dedupeAdapters(adapters: AdapterBinding[]): AdapterBinding[] {
  return Array.from(new Map(adapters.map((adapter) => [adapter.id, adapter])).values())
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
