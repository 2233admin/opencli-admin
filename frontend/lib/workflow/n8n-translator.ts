import {
  parseWorkflowProject,
  type AdapterBinding,
  type WorkflowCapability,
  type WorkflowNodeKind,
  type WorkflowProject,
  type WorkflowProjectEdge,
  type WorkflowProjectNode,
} from "./schema"

type JsonRecord = Record<string, unknown>

type N8nWorkflow = {
  id?: unknown
  name?: unknown
  nodes: N8nNode[]
  connections?: unknown
  active?: unknown
  settings?: unknown
}

type N8nNode = {
  id?: unknown
  name?: unknown
  type?: unknown
  typeVersion?: unknown
  position?: unknown
  parameters?: unknown
  credentials?: unknown
  disabled?: unknown
}

type NodeMapping = {
  kind: WorkflowNodeKind
  capability: WorkflowCapability
  icon: string
  color: string
  catalogId?: string
  adapter?: {
    type: AdapterBinding["type"]
    mode: AdapterBinding["mode"]
  }
}

export type N8nTranslationReport = {
  source: "n8n"
  workflowName: string
  nodeCount: number
  edgeCount: number
  adapterCount: number
  unsupportedConnectionCount: number
}

export type N8nTranslationResult =
  | { ok: true; project: WorkflowProject; report: N8nTranslationReport }
  | { ok: false; error: string }

const DEFAULT_POSITION_X = 520
const DEFAULT_POSITION_Y = 120
const DEFAULT_COLUMN_GAP = 300
const DEFAULT_ROW_GAP = 180

export function isN8nWorkflow(input: unknown): input is N8nWorkflow {
  if (!isRecord(input)) return false
  if (!Array.isArray(input.nodes)) return false
  return "connections" in input || input.nodes.some((node) => isRecord(node) && typeof node.type === "string")
}

export function translateN8nWorkflowToWorkflowProject(input: unknown): N8nTranslationResult {
  const workflow = pickN8nWorkflow(input)
  if (!workflow) return { ok: false, error: "Input is not an n8n workflow export" }

  const workflowName = readString(workflow.name) ?? "n8n Workflow Import"
  const nodeEntries = workflow.nodes.filter(isRecord)
  if (nodeEntries.length === 0) return { ok: false, error: "n8n workflow has no nodes" }

  const usedNodeIds = new Set<string>()
  const nodeLookup = new Map<string, string>()
  const adapters: AdapterBinding[] = []
  const nodes = nodeEntries.map((node, index) => {
    const translated = translateN8nNode(node, index, usedNodeIds)
    const originalId = readString(node.id)
    const originalName = readString(node.name)
    if (originalId) nodeLookup.set(originalId, translated.node.id)
    if (originalName) nodeLookup.set(originalName, translated.node.id)
    if (translated.adapter) adapters.push(translated.adapter)
    return translated.node
  })

  const { edges, unsupportedConnectionCount } = translateN8nConnections(workflow.connections, nodeLookup)
  const packageId = uniqueSlug(`n8n-package-${workflowName}`, new Set())
  const project = parseWorkflowProject({
    id: uniqueSlug(`n8n-${workflowName}`, new Set()),
    name: workflowName,
    profile: "intelligence",
    version: 1,
    nodes: [
      {
        id: packageId,
        kind: "action",
        capability: "store",
        params: {
          packageFormat: "n8n",
          sourceWorkflowId: readString(workflow.id),
        },
        internals: {
          locked: false,
          nodes,
          edges,
        },
        ui: {
          label: workflowName,
          description: `n8n compatibility package · ${nodes.length} nodes`,
          icon: "Boxes",
          color: "var(--chart-3)",
          catalogId: "package.compat.n8n-workflow",
          package: {
            format: "n8n",
            expandable: true,
            nodeCount: nodes.length,
            edgeCount: edges.length,
          },
        },
      },
    ],
    edges: [],
    adapters: dedupeAdapters(adapters),
    settings: {
      timezone: "Asia/Shanghai",
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
      source: "n8n",
      workflowName,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      adapterCount: project.adapters.length,
      unsupportedConnectionCount,
    },
  }
}

function pickN8nWorkflow(input: unknown): N8nWorkflow | undefined {
  if (isN8nWorkflow(input)) return input
  if (Array.isArray(input)) return input.find(isN8nWorkflow)
  return undefined
}

function translateN8nNode(
  node: JsonRecord,
  index: number,
  usedNodeIds: Set<string>,
): { node: WorkflowProjectNode; adapter?: AdapterBinding } {
  const originalName = readString(node.name) ?? `n8n node ${index + 1}`
  const originalId = readString(node.id)
  const nodeType = readString(node.type) ?? "n8n-nodes-base.noOp"
  const provider = providerFromType(nodeType)
  const mapping = classifyN8nNode(nodeType, originalName)
  const id = uniqueSlug(`${idPrefixForMapping(mapping)}-${originalName || provider}`, usedNodeIds)
  const position = readPosition(node.position) ?? {
    x: DEFAULT_POSITION_X + (index % 4) * DEFAULT_COLUMN_GAP,
    y: DEFAULT_POSITION_Y + Math.floor(index / 4) * DEFAULT_ROW_GAP,
  }
  const parameters = isRecord(node.parameters) ? node.parameters : {}
  const compactParams = compactN8nParams({
    nodeName: originalName,
    nodeType,
    provider,
    parameters,
    mapping,
  })
  compactParams.compatRuntime = {
    target: "n8n",
    nodeType,
    sourceNodeId: originalId,
    sourceNodeName: originalName,
  }
  const credentials = summarizeCredentials(node.credentials)
  const adapter = mapping.adapter
    ? buildAdapter({
        nodeId: id,
        provider,
        nodeType,
        nodeName: originalName,
        adapterType: mapping.adapter.type,
        mode: mapping.adapter.mode,
      })
    : undefined

  return {
    node: {
      id,
      kind: mapping.kind,
      capability: mapping.capability,
      adapter: adapter?.id,
      params: compactParams,
      sourceAnchor: {
        kind: "artifact",
        label: `n8n:${originalName}`,
        artifactPath: "n8n-workflow.json",
        selector: originalId ?? originalName,
      },
      ui: {
        label: originalName,
        description: `${provider} from n8n import`,
        icon: mapping.icon,
        color: mapping.color,
        position,
        catalogId: mapping.catalogId,
        n8n: {
          source: "n8n",
          originalId,
          originalName,
          type: nodeType,
          typeVersion: node.typeVersion,
          disabled: node.disabled === true,
          isStickyNote: provider === "stickyNote",
          credentials,
          parameters,
        },
      },
    },
    adapter,
  }
}

function classifyN8nNode(type: string, name: string): NodeMapping {
  const provider = providerFromType(type)
  const haystack = `${provider} ${type} ${name}`.toLowerCase()

  if (haystack.includes("stickynote")) {
    return { kind: "action", capability: "store", icon: "StickyNote", color: "var(--muted-foreground)" }
  }
  if (matches(haystack, ["if", "switch", "condition", "router", "filter"])) {
    return { kind: "router", capability: "route", icon: "GitBranch", color: "var(--chart-5)" }
  }
  if (matches(haystack, ["schedule", "cron", "interval", "manualtrigger", "webhook", "trigger"])) {
    return {
      kind: "schedule",
      capability: "trigger",
      icon: "Clock",
      color: "var(--chart-1)",
      catalogId: "intelligence.schedule.cron",
    }
  }
  if (matches(haystack, ["openai", "anthropic", "gemini", "langchain", "lmchat", "chain", "agent", "summar"])) {
    return { kind: "agent", capability: "summarize", icon: "Sparkles", color: "var(--chart-2)" }
  }
  if (matches(haystack, ["dedupe", "removeduplicates"])) {
    return { kind: "agent", capability: "dedupe", icon: "Filter", color: "var(--chart-2)" }
  }
  if (matches(haystack, ["set", "editfields", "code", "function", "merge", "aggregate", "splitout", "itemlists", "html", "xml", "json"])) {
    return { kind: "agent", capability: "normalize", icon: "ArrowRightLeft", color: "var(--chart-2)" }
  }
  if (matches(haystack, ["slack", "telegram", "discord", "email", "gmail", "sendgrid", "twilio", "whatsapp", "notify"])) {
    return {
      kind: "notify",
      capability: "send",
      icon: "Bell",
      color: "var(--chart-1)",
      catalogId: "intelligence.output.webhook",
      adapter: { type: "notification", mode: "mock" },
    }
  }
  if (matches(haystack, ["airtable", "googlesheets", "postgres", "mysql", "notion", "redis", "mongodb", "database", "spreadsheet"])) {
    return {
      kind: "inbox",
      capability: "store",
      icon: "Inbox",
      color: "var(--chart-4)",
      adapter: { type: "storage", mode: "mock" },
    }
  }
  if (matches(haystack, ["http", "rss", "read", "fetch", "request", "search", "list", "get"])) {
    return {
      kind: "source",
      capability: "fetch",
      icon: "Globe",
      color: "var(--chart-4)",
      adapter: { type: "source", mode: "fixture" },
    }
  }

  return { kind: "action", capability: "send", icon: "Play", color: "var(--chart-3)" }
}

function translateN8nConnections(
  connections: unknown,
  nodeLookup: Map<string, string>,
): { edges: WorkflowProjectEdge[]; unsupportedConnectionCount: number } {
  if (!isRecord(connections)) return { edges: [], unsupportedConnectionCount: 0 }

  const usedEdgeIds = new Set<string>()
  const edges: WorkflowProjectEdge[] = []
  let unsupportedConnectionCount = 0

  for (const [sourceKey, sourceOutputs] of Object.entries(connections)) {
    const source = nodeLookup.get(sourceKey)
    if (!source || !isRecord(sourceOutputs)) {
      unsupportedConnectionCount += 1
      continue
    }

    for (const [outputName, lanes] of Object.entries(sourceOutputs)) {
      if (!Array.isArray(lanes)) {
        unsupportedConnectionCount += 1
        continue
      }
      lanes.forEach((lane, outputIndex) => {
        if (!Array.isArray(lane)) {
          unsupportedConnectionCount += 1
          return
        }
        lane.forEach((targetRef, laneIndex) => {
          const targetName = isRecord(targetRef) ? readString(targetRef.node) : undefined
          const target = targetName ? nodeLookup.get(targetName) : undefined
          if (!target) {
            unsupportedConnectionCount += 1
            return
          }
          const id = uniqueSlug(`e-${source}-${target}-${outputName}-${outputIndex}-${laneIndex}`, usedEdgeIds)
          edges.push({
            id,
            source,
            target,
            label: outputName === "main" && outputIndex === 0 ? undefined : `${outputName}:${outputIndex}`,
            sourcePort: outputName,
            targetPort: readString(isRecord(targetRef) ? targetRef.type : undefined) ?? "main",
            semantic: { relationship: "implements", confidence: 0.72 },
            weight: 0.7,
            contractId: "edge.contract.n8n",
            proposalState: "accepted",
            ui: {
              n8n: {
                outputName,
                outputIndex,
                targetIndex: isRecord(targetRef) ? targetRef.index : undefined,
              },
            },
          })
        })
      })
    }
  }

  return { edges, unsupportedConnectionCount }
}

function compactN8nParams({
  nodeName,
  nodeType,
  provider,
  parameters,
  mapping,
}: {
  nodeName: string
  nodeType: string
  provider: string
  parameters: JsonRecord
  mapping: NodeMapping
}): JsonRecord {
  const params: JsonRecord = {
    n8nType: provider,
    n8nName: nodeName,
  }

  for (const key of [
    "operation",
    "resource",
    "method",
    "url",
    "path",
    "events",
    "event",
    "mode",
    "authentication",
    "model",
    "prompt",
    "text",
    "subject",
    "toEmail",
    "fromEmail",
    "message",
    "query",
    "fieldToSplitOut",
    "aggregate",
    "interval",
    "rule",
    "schedule",
  ]) {
    if (key in parameters) params[key] = compactValue(parameters[key])
  }

  if (provider === "stickyNote" && "content" in parameters) {
    params.content = compactValue(parameters.content, 500)
  }
  if (mapping.kind === "router" && "conditions" in parameters) {
    params.expression = compactValue(parameters.conditions, 500)
  }
  if (mapping.kind === "schedule" && !("interval" in params)) {
    params.interval = compactValue(parameters.rule ?? parameters.triggerTimes ?? "manual")
  }
  if (Object.keys(params).length === 2) {
    params.config = compactValue(parameters, 500)
  }
  params.originalNodeType = nodeType
  return params
}

function compactValue(value: unknown, maxLength = 240): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") return truncate(value, maxLength)
  if (Array.isArray(value)) {
    const compact = value.slice(0, 8).map((item) => compactValue(item, 80))
    return value.length > compact.length ? [...compact, `+${value.length - compact.length} more`] : compact
  }
  if (isRecord(value)) return truncate(JSON.stringify(value), maxLength)
  return truncate(String(value), maxLength)
}

function summarizeCredentials(credentials: unknown): JsonRecord | undefined {
  if (!isRecord(credentials)) return undefined
  const summary: JsonRecord = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (!isRecord(value)) {
      summary[key] = "[redacted]"
      continue
    }
    summary[key] = {
      id: readString(value.id) ? "[redacted]" : undefined,
      name: readString(value.name) ? "[redacted]" : undefined,
    }
  }
  return summary
}

function buildAdapter({
  nodeId,
  provider,
  nodeType,
  nodeName,
  adapterType,
  mode,
}: {
  nodeId: string
  provider: string
  nodeType: string
  nodeName: string
  adapterType: AdapterBinding["type"]
  mode: AdapterBinding["mode"]
}): AdapterBinding {
  return {
    id: `n8n-${nodeId}`,
    type: adapterType,
    provider: sanitizeProvider(provider),
    mode,
    config: {
      nodeType,
      nodeName,
      translatedFrom: "n8n",
    },
  }
}

function dedupeAdapters(adapters: AdapterBinding[]): AdapterBinding[] {
  const byId = new Map<string, AdapterBinding>()
  for (const adapter of adapters) byId.set(adapter.id, adapter)
  return Array.from(byId.values())
}

function providerFromType(type: string): string {
  const compact = type
    .replace(/^n8n-nodes-base\./, "")
    .replace(/^@n8n\/n8n-nodes-langchain\./, "")
  return compact.split(".").filter(Boolean).at(-1) ?? "n8n"
}

function idPrefixForMapping(mapping: NodeMapping): string {
  if (mapping.kind === "schedule") return "trigger"
  if (mapping.kind === "source") return "source"
  if (mapping.kind === "router") return "router"
  if (mapping.kind === "notify") return "notify"
  if (mapping.kind === "inbox") return "store"
  if (mapping.capability === "normalize") return "transform"
  if (mapping.capability === "summarize") return "agent"
  return "tool"
}

function uniqueSlug(input: string, used: Set<string>): string {
  const base = slugify(input)
  let candidate = base
  let index = 2
  while (used.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }
  used.add(candidate)
  return candidate
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
  if (!slug) return "n8n-node"
  return /^[0-9]/.test(slug) ? `n-${slug}` : slug
}

function sanitizeProvider(provider: string): string {
  return slugify(provider).replace(/-/g, "_")
}

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

function readPosition(position: unknown): { x: number; y: number } | undefined {
  if (!Array.isArray(position) || position.length < 2) return undefined
  const [x, y] = position
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}
