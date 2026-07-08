import { createDefaultAdapterRegistry, runWorkflowSourceNode, type AdapterRegistry } from "./adapter-registry"
import type { WorkflowProject, WorkflowProjectNode } from "./schema"

type SimulatedItem = {
  id: string
  title: string
  important: boolean
  score: number
  tags: string[]
}

export type WorkflowTraceEvent = {
  sequence: number
  nodeId: string
  kind: WorkflowProjectNode["kind"]
  event: "triggered" | "fetched" | "normalized" | "routed" | "stored" | "sent" | "skipped"
  itemCount: number
  details: Record<string, string | number | boolean | string[]>
}

export type WorkflowSpanType =
  | "prompt.parse"
  | "model.call"
  | "tool.call"
  | "router.decision"
  | "assertion.check"
  | "delivery.mock"

export type WorkflowSpanEvent = {
  spanId: string
  parentSpanId?: string
  sequence: number
  nodeId: string
  type: WorkflowSpanType
  status: "ok" | "warn" | "error"
  durationMs: number
  inputCount: number
  outputCount: number
  details: Record<string, string | number | boolean | string[]>
}

export type WorkflowEvaluationScorecard = {
  accuracy: number
  relevance: number
  compliance: number
  latency: number
  overall: number
}

export type WorkflowEvaluationSummary = {
  dataset: string
  caseCount: number
  evaluator: string
  status: "pass" | "warn" | "fail"
  scorecard: WorkflowEvaluationScorecard
  regressionFindings: Array<{ id: string; status: "pass" | "warn" | "fail"; summary: string }>
}

export type WorkflowQualityMetrics = {
  fetchedItems: number
  normalizedItems: number
  routedItems: number
  importantItems: number
  storedItems: number
  notifiedItems: number
  droppedItems: number
  routeCoverage: number
  averageScore: number
}

export type WorkflowRuntimeMetrics = {
  nodeCount: number
  edgeCount: number
  executedNodeCount: number
  traceEventCount: number
  sourceAdapterCount: number
  deterministicDurationMs: number
}

export type WorkflowSimulationRun = {
  runId: string
  workflowId: string
  profile: WorkflowProject["profile"]
  trace: WorkflowTraceEvent[]
  spans: WorkflowSpanEvent[]
  evaluation: WorkflowEvaluationSummary
  quality: WorkflowQualityMetrics
  runtime: WorkflowRuntimeMetrics
}

export async function simulateWorkflowRun(
  project: WorkflowProject,
  registry: AdapterRegistry = createDefaultAdapterRegistry(),
): Promise<WorkflowSimulationRun> {
  const orderedNodes = orderWorkflowNodes(project)
  const outgoingEdges = groupOutgoingEdges(project)
  const trace: WorkflowTraceEvent[] = []
  const spans: WorkflowSpanEvent[] = []
  let items: SimulatedItem[] = []
  let fetchedItems = 0
  let normalizedItems = 0
  let routedItems = 0
  let storedItems = 0
  let notifiedItems = 0

  for (const node of orderedNodes) {
    if (node.kind === "schedule") {
      pushTrace(trace, node, "triggered", items.length, {
        interval: readStringParam(node, "interval") ?? "manual",
      })
      pushSpan(spans, node, "tool.call", "ok", 1, 1, {
        tool: "schedule-driver",
        interval: readStringParam(node, "interval") ?? "manual",
      })
      continue
    }

    if (node.kind === "source") {
      const result = await runWorkflowSourceNode(project, node.id, registry)
      if (!result.ok) {
        pushTrace(trace, node, "skipped", 0, { error: result.error })
        pushSpan(spans, node, "tool.call", "error", 0, 0, { tool: node.adapter ?? "source", error: result.error })
        continue
      }
      items = result.items.map((item) => ({
        id: item.id,
        title: item.title,
        important: item.important,
        score: scoreSourceItem(item),
        tags: [...item.tags].sort(),
      }))
      fetchedItems = items.length
      pushTrace(trace, node, "fetched", items.length, {
        adapter: node.adapter ?? "",
        itemIds: items.map((item) => item.id),
      })
      pushSpan(spans, node, "tool.call", "ok", 1, items.length, {
        tool: node.adapter ?? "source",
        itemIds: items.map((item) => item.id),
      })
      continue
    }

    if (node.kind === "agent" && node.capability === "normalize") {
      normalizedItems = items.length
      const promptSpan = pushSpan(spans, node, "prompt.parse", "ok", items.length, items.length, {
        preset: readStringParam(node, "style") ?? "normalize",
        version: readStringParam(node, "promptVersion") ?? "v1",
      })
      pushSpan(spans, node, "model.call", "ok", items.length, items.length, {
        model: readStringParam(node, "model") ?? "deterministic-normalizer",
        parent: promptSpan.spanId,
      }, promptSpan.spanId)
      pushTrace(trace, node, "normalized", items.length, {
        language: readStringParam(node, "language") ?? "und",
        itemIds: items.map((item) => item.id),
      })
      continue
    }

    if (node.kind === "router") {
      routedItems = items.length
      const targets = (outgoingEdges.get(node.id) ?? []).map((edge) => edge.target).sort()
      pushTrace(trace, node, "routed", routedItems, {
        expression: readStringParam(node, "expression") ?? "all",
        targets,
      })
      pushSpan(spans, node, "router.decision", "ok", items.length, routedItems, {
        expression: readStringParam(node, "expression") ?? "all",
        targets,
      })
      continue
    }

    if (node.kind === "inbox") {
      storedItems = items.length
      pushTrace(trace, node, "stored", storedItems, {
        queue: readStringParam(node, "queue") ?? "default",
        itemIds: items.map((item) => item.id),
      })
      pushSpan(spans, node, "assertion.check", "ok", items.length, storedItems, {
        assertion: "items persisted to review queue",
        queue: readStringParam(node, "queue") ?? "default",
      })
      continue
    }

    if (node.kind === "notify") {
      const notificationItems = items.filter((item) => item.important || item.score >= 0.7)
      notifiedItems = notificationItems.length
      pushTrace(trace, node, "sent", notifiedItems, {
        adapter: node.adapter ?? "",
        template: readStringParam(node, "template") ?? "default",
        itemIds: notificationItems.map((item) => item.id),
      })
      pushSpan(spans, node, "delivery.mock", "ok", notificationItems.length, notifiedItems, {
        adapter: node.adapter ?? "",
        template: readStringParam(node, "template") ?? "default",
      })
      continue
    }

    pushTrace(trace, node, "skipped", items.length, { capability: node.capability })
    pushSpan(spans, node, "assertion.check", "warn", items.length, items.length, { capability: node.capability })
  }

  const importantItems = items.filter((item) => item.important).length
  const droppedItems = Math.max(0, fetchedItems - Math.max(storedItems, notifiedItems))
  const executedNodeCount = new Set(trace.map((event) => event.nodeId)).size

  return {
    runId: `sim-${project.id}`,
    workflowId: project.id,
    profile: project.profile,
    trace,
    spans,
    evaluation: buildEvaluationSummary(items, trace, spans),
    quality: {
      fetchedItems,
      normalizedItems,
      routedItems,
      importantItems,
      storedItems,
      notifiedItems,
      droppedItems,
      routeCoverage: fetchedItems === 0 ? 1 : roundMetric(Math.max(storedItems, notifiedItems) / fetchedItems),
      averageScore: averageScore(items),
    },
    runtime: {
      nodeCount: project.nodes.length,
      edgeCount: project.edges.length,
      executedNodeCount,
      traceEventCount: trace.length,
      sourceAdapterCount: project.adapters.filter((adapter) => adapter.type === "source").length,
      deterministicDurationMs: executedNodeCount * 5 + fetchedItems * 3 + notifiedItems,
    },
  }
}

function buildEvaluationSummary(
  items: SimulatedItem[],
  trace: WorkflowTraceEvent[],
  spans: WorkflowSpanEvent[],
): WorkflowEvaluationSummary {
  const skipped = trace.filter((event) => event.event === "skipped").length
  const errorSpans = spans.filter((span) => span.status === "error").length
  const accuracy = skipped === 0 ? 0.94 : 0.78
  const relevance = items.length > 0 ? 0.91 : 0.72
  const compliance = errorSpans === 0 ? 0.98 : 0.7
  const latency = spans.length === 0 ? 1 : Math.max(0.65, 1 - spans.reduce((sum, span) => sum + span.durationMs, 0) / 1000)
  const overall = roundMetric((accuracy + relevance + compliance + latency) / 4)
  const findings: WorkflowEvaluationSummary["regressionFindings"] = [
    {
      id: "regression-no-span-errors",
      status: errorSpans === 0 ? "pass" : "fail",
      summary: errorSpans === 0 ? "No span-level errors observed." : `${errorSpans} span-level errors observed.`,
    },
    {
      id: "regression-overall-score",
      status: overall >= 0.85 ? "pass" : "warn",
      summary: `Overall deterministic score is ${overall}.`,
    },
  ]
  return {
    dataset: "intelligence-fixture-regression",
    caseCount: Math.max(1, items.length),
    evaluator: "deterministic-cozeloop-inspired-evaluator",
    status: findings.some((finding) => finding.status === "fail") ? "fail" : findings.some((finding) => finding.status === "warn") ? "warn" : "pass",
    scorecard: {
      accuracy: roundMetric(accuracy),
      relevance: roundMetric(relevance),
      compliance: roundMetric(compliance),
      latency: roundMetric(latency),
      overall,
    },
    regressionFindings: findings,
  }
}

function orderWorkflowNodes(project: WorkflowProject): WorkflowProjectNode[] {
  const byId = new Map(project.nodes.map((node) => [node.id, node]))
  const indegree = new Map(project.nodes.map((node) => [node.id, 0]))
  for (const edge of project.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }

  const nodeIndex = new Map(project.nodes.map((node, index) => [node.id, index]))
  const queue = project.nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => compareNodeIds(left.id, right.id, nodeIndex))
  const ordered: WorkflowProjectNode[] = []

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) break
    ordered.push(node)

    const nextNodes = project.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.target)
      .sort((left, right) => compareNodeIds(left, right, nodeIndex))

    for (const targetId of nextNodes) {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, nextIndegree)
      const target = byId.get(targetId)
      if (target && nextIndegree === 0) {
        queue.push(target)
        queue.sort((left, right) => compareNodeIds(left.id, right.id, nodeIndex))
      }
    }
  }

  if (ordered.length === project.nodes.length) return ordered
  const orderedIds = new Set(ordered.map((node) => node.id))
  return [...ordered, ...project.nodes.filter((node) => !orderedIds.has(node.id))]
}

function groupOutgoingEdges(project: WorkflowProject) {
  const grouped = new Map<string, WorkflowProject["edges"]>()
  for (const edge of project.edges) {
    grouped.set(edge.source, [...(grouped.get(edge.source) ?? []), edge])
  }
  return grouped
}

function compareNodeIds(left: string, right: string, nodeIndex: Map<string, number>): number {
  return (nodeIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (nodeIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
}

function pushTrace(
  trace: WorkflowTraceEvent[],
  node: WorkflowProjectNode,
  event: WorkflowTraceEvent["event"],
  itemCount: number,
  details: WorkflowTraceEvent["details"],
): void {
  trace.push({
    sequence: trace.length + 1,
    nodeId: node.id,
    kind: node.kind,
    event,
    itemCount,
    details,
  })
}

function pushSpan(
  spans: WorkflowSpanEvent[],
  node: WorkflowProjectNode,
  type: WorkflowSpanType,
  status: WorkflowSpanEvent["status"],
  inputCount: number,
  outputCount: number,
  details: WorkflowSpanEvent["details"],
  parentSpanId?: string,
): WorkflowSpanEvent {
  const sequence = spans.length + 1
  const span: WorkflowSpanEvent = {
    spanId: `span-${String(sequence).padStart(3, "0")}-${node.id}`,
    ...(parentSpanId ? { parentSpanId } : {}),
    sequence,
    nodeId: node.id,
    type,
    status,
    durationMs: 5 + sequence * 3 + outputCount,
    inputCount,
    outputCount,
    details,
  }
  spans.push(span)
  return span
}

function scoreSourceItem(item: { important: boolean; tags: string[] }): number {
  if (item.important) return 0.9
  if (item.tags.includes("macro")) return 0.55
  return 0.4
}

function averageScore(items: SimulatedItem[]): number {
  if (items.length === 0) return 0
  return roundMetric(items.reduce((sum, item) => sum + item.score, 0) / items.length)
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}

function readStringParam(node: WorkflowProjectNode, key: string): string | undefined {
  const value = node.params[key]
  return typeof value === "string" ? value : undefined
}
