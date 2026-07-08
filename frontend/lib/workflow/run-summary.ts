import type { WorkflowSimulationRun, WorkflowTraceEvent } from "./simulation"

export type RunMetricSummary = {
  key: string
  label: string
  value: string
  tone: "neutral" | "good" | "warn"
}

export type TraceEventSummary = {
  key: string
  sequence: string
  nodeId: string
  label: string
  itemCount: string
  details: string
}

export type WorkflowRunSummary = {
  runId: string
  profile: string
  quality: RunMetricSummary[]
  runtime: RunMetricSummary[]
  trace: TraceEventSummary[]
}

const EVENT_LABELS: Record<WorkflowTraceEvent["event"], string> = {
  triggered: "Triggered",
  fetched: "Fetched",
  normalized: "Normalized",
  routed: "Routed",
  stored: "Stored",
  sent: "Sent",
  skipped: "Skipped",
}

export function summarizeWorkflowRun(run: WorkflowSimulationRun): WorkflowRunSummary {
  return {
    runId: run.runId,
    profile: run.profile,
    quality: [
      metric("fetched", "Fetched", run.quality.fetchedItems),
      metric("normalized", "Normalized", run.quality.normalizedItems),
      metric("routed", "Routed", run.quality.routedItems),
      metric("important", "Important", run.quality.importantItems, run.quality.importantItems > 0 ? "good" : "neutral"),
      metric("stored", "Stored", run.quality.storedItems),
      metric("notified", "Notified", run.quality.notifiedItems),
      metric("dropped", "Dropped", run.quality.droppedItems, run.quality.droppedItems > 0 ? "warn" : "good"),
      metric("coverage", "Coverage", formatPercent(run.quality.routeCoverage), run.quality.routeCoverage >= 1 ? "good" : "warn"),
      metric("score", "Avg score", run.quality.averageScore.toFixed(3)),
    ],
    runtime: [
      metric("nodes", "Nodes", run.runtime.nodeCount),
      metric("edges", "Edges", run.runtime.edgeCount),
      metric("executed", "Executed", run.runtime.executedNodeCount),
      metric("events", "Events", run.runtime.traceEventCount),
      metric("sources", "Sources", run.runtime.sourceAdapterCount),
      metric("duration", "Duration", `${run.runtime.deterministicDurationMs}ms`),
    ],
    trace: run.trace.map((event) => ({
      key: `${event.sequence}-${event.nodeId}-${event.event}`,
      sequence: String(event.sequence).padStart(2, "0"),
      nodeId: event.nodeId,
      label: EVENT_LABELS[event.event],
      itemCount: String(event.itemCount),
      details: formatDetails(event.details),
    })),
  }
}

function metric(
  key: string,
  label: string,
  value: string | number,
  tone: RunMetricSummary["tone"] = "neutral",
): RunMetricSummary {
  return { key, label, value: String(value), tone }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatDetails(details: WorkflowTraceEvent["details"]): string {
  return Object.entries(details)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${formatDetailValue(value)}`)
    .join("  ")
}

function formatDetailValue(value: WorkflowTraceEvent["details"][string]): string {
  if (Array.isArray(value)) return `[${value.join(", ")}]`
  return String(value)
}
