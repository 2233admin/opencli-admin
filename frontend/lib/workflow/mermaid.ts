import {
  parseWorkflowProject,
  workflowCapabilitySchema,
  workflowNodeKindSchema,
  type WorkflowCapability,
  type WorkflowNodeKind,
  type WorkflowProject,
  type WorkflowProjectEdge,
  type WorkflowProjectNode,
} from "./schema"

export type WorkflowMermaidImportResult =
  | { ok: true; project: WorkflowProject }
  | { ok: false; error: string }

const DEFAULT_PROJECT_ID = "mermaid-import"
const DEFAULT_PROJECT_NAME = "Mermaid Import"
const FLOWCHART_HEADER = "flowchart TB"

const KIND_KEYWORDS: Array<[WorkflowNodeKind, RegExp]> = [
  ["schedule", /\b(schedule|cron|timer|interval|trigger)\b/i],
  ["source", /\b(source|feed|fetch|api|rss|jin10|input)\b/i],
  ["agent", /\b(agent|normalize|summari[sz]e|score|tag|dedupe|llm)\b/i],
  ["router", /\b(router|route|branch|condition|decision|filter)\b/i],
  ["flow", /\b(flow|merge|join|fan-?in|split)\b/i],
  ["control", /\b(gate|approval|accept|quality|policy|control)\b/i],
  ["sink", /\b(sink|records|database|write|persist)\b/i],
  ["notify", /\b(notify|notification|webhook|alert|send|slack|email)\b/i],
  ["inbox", /\b(inbox|queue|store|review|archive)\b/i],
  ["action", /\b(action|tool|execute|write|update)\b/i],
]

const CAPABILITY_KEYWORDS: Array<[WorkflowCapability, RegExp]> = [
  ["trigger", /\b(schedule|cron|timer|interval|trigger)\b/i],
  ["fetch", /\b(source|feed|fetch|api|rss|jin10|input)\b/i],
  ["normalize", /\b(normalize|clean|transform)\b/i],
  ["dedupe", /\b(dedupe|duplicate|unique)\b/i],
  ["summarize", /\b(summari[sz]e|brief|digest)\b/i],
  ["score", /\b(score|rank|priority|importance)\b/i],
  ["tag", /\b(tag|label|classify)\b/i],
  ["route", /\b(router|route|branch|condition|decision|filter)\b/i],
  ["merge", /\b(merge|join|fan-?in)\b/i],
  ["accept", /\b(accept|approval|quality|gate)\b/i],
  ["send", /\b(notify|notification|webhook|alert|send|slack|email)\b/i],
  ["store", /\b(inbox|queue|store|review|archive)\b/i],
]

const CAPABILITY_BY_KIND: Record<WorkflowNodeKind, WorkflowCapability> = {
  schedule: "trigger",
  source: "fetch",
  agent: "normalize",
  router: "route",
  flow: "merge",
  control: "accept",
  notify: "send",
  inbox: "store",
  action: "send",
  sink: "store",
}

type DraftNode = {
  id: string
  label?: string
  classes: string[]
}

type DraftEdge = {
  source: string
  target: string
  sourceLabel?: string
  targetLabel?: string
  label?: string
}

export function exportWorkflowProjectToMermaid(project: WorkflowProject): string {
  const parsed = parseWorkflowProject(project)
  const lines = [FLOWCHART_HEADER]

  for (const node of parsed.nodes) {
    lines.push(`  ${node.id}["${escapeMermaidLabel(labelForNode(node))}"]`)
  }

  for (const edge of parsed.edges) {
    const label = edge.label ?? edge.condition
    lines.push(label ? `  ${edge.source} -- "${escapeMermaidLabel(label)}" --> ${edge.target}` : `  ${edge.source} --> ${edge.target}`)
  }

  for (const node of parsed.nodes) {
    lines.push(`  class ${node.id} ${node.kind},${node.capability};`)
  }

  return `${lines.join("\n")}\n`
}

export function importWorkflowProjectFromMermaid(source: string): WorkflowMermaidImportResult {
  try {
    const parsed = parseMermaidFlowchart(source)
    if (parsed.nodes.size === 0) {
      return { ok: false, error: "Invalid Mermaid workflow: no nodes found" }
    }

    const nodes = Array.from(parsed.nodes.values()).map((node, index) => toWorkflowNode(node, index))
    const edges = parsed.edges.map((edge, index) => toWorkflowEdge(edge, index))
    const project = parseWorkflowProject({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      profile: "intelligence",
      version: 1,
      nodes,
      edges,
      settings: {
        timezone: "Asia/Shanghai",
        deterministicSimulation: true,
        maxItemsPerRun: 20,
      },
      adapters: [],
      agentPermissions: {
        canFetchNetwork: false,
        canSendNotifications: false,
        canWriteInbox: true,
        allowedDomains: [],
      },
    })

    return { ok: true, project }
  } catch (error) {
    return {
      ok: false,
      error: `Invalid Mermaid workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
    }
  }
}

function parseMermaidFlowchart(source: string): { nodes: Map<string, DraftNode>; edges: DraftEdge[] } {
  const nodes = new Map<string, DraftNode>()
  const edges: DraftEdge[] = []
  let sawHeader = false

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%")) continue
    if (/^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/i.test(line)) {
      sawHeader = true
      continue
    }
    if (/^classDef\b/i.test(line)) continue

    const classMatch = line.match(/^class\s+(.+?)\s+([A-Za-z0-9_, -]+);?$/i)
    if (classMatch) {
      const ids = classMatch[1].split(",").map((id) => id.trim()).filter(Boolean)
      const classes = classMatch[2].split(",").map((name) => name.trim()).filter(Boolean)
      for (const id of ids) {
        ensureNode(nodes, id).classes.push(...classes)
      }
      continue
    }

    const edge = parseEdge(line)
    if (edge) {
      const sourceNode = ensureNode(nodes, edge.source)
      const targetNode = ensureNode(nodes, edge.target)
      sourceNode.label ??= edge.sourceLabel
      targetNode.label ??= edge.targetLabel
      edges.push(edge)
      continue
    }

    const node = parseNode(line)
    if (node) {
      const existing = ensureNode(nodes, node.id)
      existing.label = node.label
      continue
    }

    throw new Error(`Unsupported Mermaid line "${line}"`)
  }

  if (!sawHeader) {
    throw new Error("expected a flowchart or graph header")
  }

  return { nodes, edges }
}

function parseNode(line: string): { id: string; label?: string } | null {
  const match = line.match(/^([A-Za-z][\w-]*)(?:\s*(?:\[\s*"([^"]*)"\s*\]|\[\s*([^\]]*)\s*\]|\(\s*"([^"]*)"\s*\)|\(\s*([^)]+)\s*\)))?;?$/)
  if (!match) return null
  return {
    id: match[1],
    label: firstDefined(match[2], match[3], match[4], match[5]),
  }
}

function parseEdge(line: string): DraftEdge | null {
  const match = line.match(/^(.+?)\s*(?:--\s*(?:"([^"]*)"|([^>-]+?))\s*-->|-->|-\.->|==>)\s*(.+?);?$/)
  if (!match) return null
  const source = parseEndpoint(match[1])
  const target = parseEndpoint(match[4])
  if (!source || !target) return null
  return {
    source: source.id,
    target: target.id,
    sourceLabel: source.label,
    targetLabel: target.label,
    label: cleanLabel(firstDefined(match[2], match[3])),
  }
}

function parseEndpoint(value: string): { id: string; label?: string } | null {
  return parseNode(value.trim())
}

function toWorkflowNode(node: DraftNode, index: number): WorkflowProjectNode {
  const kind = inferKind(node)
  const capability = inferCapability(node, kind)
  return {
    id: node.id,
    kind,
    capability,
    params: node.label ? { label: node.label } : {},
    ui: {
      position: {
        x: 120 + (index % 4) * 280,
        y: 120 + Math.floor(index / 4) * 180,
      },
    },
  }
}

function toWorkflowEdge(edge: DraftEdge, index: number): WorkflowProjectEdge {
  return {
    id: `e-${index + 1}-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    ...(edge.label ? { label: edge.label } : {}),
  }
}

function inferKind(node: DraftNode): WorkflowNodeKind {
  const explicit = node.classes.find((name) => workflowNodeKindSchema.safeParse(stripClassPrefix(name, "kind")).success)
  if (explicit) return workflowNodeKindSchema.parse(stripClassPrefix(explicit, "kind"))

  const haystack = `${node.id} ${node.label ?? ""}`
  return KIND_KEYWORDS.find(([, pattern]) => pattern.test(haystack))?.[0] ?? "action"
}

function inferCapability(node: DraftNode, kind: WorkflowNodeKind): WorkflowCapability {
  const explicit = node.classes.find((name) => workflowCapabilitySchema.safeParse(stripClassPrefix(name, "capability")).success)
  if (explicit) return workflowCapabilitySchema.parse(stripClassPrefix(explicit, "capability"))

  const haystack = `${node.id} ${node.label ?? ""}`
  return CAPABILITY_KEYWORDS.find(([, pattern]) => pattern.test(haystack))?.[0] ?? CAPABILITY_BY_KIND[kind]
}

function stripClassPrefix(name: string, prefix: "kind" | "capability"): string {
  return name.replace(new RegExp(`^(workflow-)?${prefix}-`, "i"), "")
}

function ensureNode(nodes: Map<string, DraftNode>, id: string): DraftNode {
  const existing = nodes.get(id)
  if (existing) return existing
  const node = { id, classes: [] }
  nodes.set(id, node)
  return node
}

function labelForNode(node: WorkflowProjectNode): string {
  return typeof node.params.label === "string" ? node.params.label : node.id
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function cleanLabel(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned ? cleaned : undefined
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined)
}
