import type { WorkflowProject } from "./schema"
import type { WorkflowSimulationRun, WorkflowTraceEvent } from "./simulation"
import { buildProjectContractReport, type ProjectContractReport } from "./node-contracts"

export type VerificationStatus = "pass" | "warn" | "fail"

export type VerificationFinding = {
  id: string
  status: VerificationStatus
  summary: string
  evidence: Record<string, unknown>
}

export type VerificationCoverage = {
  node: {
    covered: number
    total: number
    percent: number
    coveredIds: string[]
    missingIds: string[]
  }
  event: {
    covered: string[]
    expected: string[]
    missing: string[]
  }
}

export type VerificationScoreboard = {
  expected: Record<string, number>
  actual: Record<string, number>
  mismatches: Array<{ key: string; expected: number; actual: number }>
}

export type VerificationWaveformEvent = {
  tick: number
  nodeId: string
  kind: string
  signal: WorkflowTraceEvent["event"]
  itemCount: number
  details: WorkflowTraceEvent["details"]
}

export type WorkflowVerificationReport = {
  methodology: "chip-verification-inspired"
  status: VerificationStatus
  testbench: {
    name: string
    fixture: string
    deterministic: boolean
    driver: string
    monitor: string
  }
  assertions: VerificationFinding[]
  coverage: VerificationCoverage
  contracts: ProjectContractReport
  scoreboard: VerificationScoreboard
  scorecard: WorkflowSimulationRun["evaluation"]["scorecard"]
  waveform: VerificationWaveformEvent[]
  agentInterface: {
    primaryPointers: string[]
    reviewOrder: string[]
  }
}

const EXPECTED_EVENTS: WorkflowTraceEvent["event"][] = ["triggered", "fetched", "normalized", "routed", "stored", "sent"]

export function verifyWorkflowRun(project: WorkflowProject, run: WorkflowSimulationRun): WorkflowVerificationReport {
  const coveredNodeIds = [...new Set(run.trace.map((event) => event.nodeId))]
  const missingNodeIds = project.nodes.map((node) => node.id).filter((nodeId) => !coveredNodeIds.includes(nodeId))
  const coveredEvents = [...new Set(run.trace.map((event) => event.event))].sort()
  const expectedEvents = EXPECTED_EVENTS.filter((event) => expectsEvent(project, event)).sort()
  const missingEvents = expectedEvents.filter((event) => !coveredEvents.includes(event))
  const scoreboard = buildScoreboard(project, run)
  const contracts = buildProjectContractReport(project)
  const edgeContractFindings = contracts.findings.filter((finding) => finding.contractId.startsWith("edge:"))
  const assertions: VerificationFinding[] = [
    {
      id: "assert-node-contracts-valid",
      status: contracts.status,
      summary: "Every node should satisfy its variable, port, and form parameter contract.",
      evidence: {
        portCoveragePercent: contracts.portCoverage.percent,
        findingCount: contracts.findings.length,
        findings: contracts.findings,
      },
    },
    {
      id: "assert-edge-port-contracts-valid",
      status: edgeContractFindings.some((finding) => finding.status === "fail") ? "fail" : "pass",
      summary: "Every workflow edge should connect compatible source and target port contracts.",
      evidence: {
        findingCount: edgeContractFindings.length,
        findings: edgeContractFindings,
      },
    },
    {
      id: "assert-no-missing-node-coverage",
      status: missingNodeIds.length === 0 ? "pass" : "warn",
      summary: "Every workflow node should emit at least one monitored trace event.",
      evidence: { coveredNodeIds, missingNodeIds },
    },
    {
      id: "assert-no-scoreboard-mismatch",
      status: scoreboard.mismatches.length === 0 ? "pass" : "fail",
      summary: "Observed run metrics should match the deterministic scoreboard.",
      evidence: { mismatches: scoreboard.mismatches },
    },
    {
      id: "assert-safe-side-effects",
      status: project.agentPermissions.canSendNotifications ? "warn" : "pass",
      summary: "Autonomous verification should not enable real notification side effects by default.",
      evidence: {
        canSendNotifications: project.agentPermissions.canSendNotifications,
        notificationAdapters: project.adapters.filter((adapter) => adapter.type === "notification"),
      },
    },
    {
      id: "assert-trace-order",
      status: isStrictSequence(run.trace.map((event) => event.sequence)) ? "pass" : "fail",
      summary: "Waveform ticks should be strictly ordered.",
      evidence: { sequence: run.trace.map((event) => event.sequence) },
    },
    {
      id: "assert-span-tree-available",
      status: run.spans.length > 0 ? "pass" : "warn",
      summary: "Run artifacts should include span-level observability for prompt/model/tool review.",
      evidence: { spanCount: run.spans.length, spanTypes: [...new Set(run.spans.map((span) => span.type))].sort() },
    },
    {
      id: "assert-regression-gate",
      status: run.evaluation.status,
      summary: "Deterministic evaluation should pass the local regression gate.",
      evidence: run.evaluation,
    },
  ]

  return {
    methodology: "chip-verification-inspired",
    status: aggregateStatus(assertions),
    testbench: {
      name: `${project.id}-deterministic-testbench`,
      fixture: project.id,
      deterministic: project.settings.deterministicSimulation,
      driver: "simulateWorkflowRun",
      monitor: "workflow trace events",
    },
    assertions,
    coverage: {
      node: {
        covered: coveredNodeIds.length,
        total: project.nodes.length,
        percent: project.nodes.length === 0 ? 100 : roundMetric((coveredNodeIds.length / project.nodes.length) * 100),
        coveredIds: coveredNodeIds,
        missingIds: missingNodeIds,
      },
      event: {
        covered: coveredEvents,
        expected: expectedEvents,
        missing: missingEvents,
      },
    },
    contracts,
    scoreboard,
    scorecard: run.evaluation.scorecard,
    waveform: run.trace.map((event) => ({
      tick: event.sequence,
      nodeId: event.nodeId,
      kind: event.kind,
      signal: event.event,
      itemCount: event.itemCount,
      details: event.details,
    })),
    agentInterface: {
      primaryPointers: [
        "/verification/assertions",
        "/verification/contracts",
        "/verification/coverage",
        "/verification/scoreboard",
        "/verification/scorecard",
        "/verification/waveform",
        "/run/spans",
        "/run/evaluation",
      ],
      reviewOrder: ["assertions", "contracts", "scoreboard", "scorecard", "coverage", "waveform", "spans"],
    },
  }
}

function buildScoreboard(project: WorkflowProject, run: WorkflowSimulationRun): VerificationScoreboard {
  const expected = {
    nodeCount: project.nodes.length,
    edgeCount: project.edges.length,
    sourceAdapterCount: project.adapters.filter((adapter) => adapter.type === "source").length,
    traceEventCount: run.trace.length,
    fetchedItems: itemCountFor(run.trace, "fetched"),
    storedItems: itemCountFor(run.trace, "stored"),
    notifiedItems: itemCountFor(run.trace, "sent"),
  }
  const actual = {
    nodeCount: run.runtime.nodeCount,
    edgeCount: run.runtime.edgeCount,
    sourceAdapterCount: run.runtime.sourceAdapterCount,
    traceEventCount: run.runtime.traceEventCount,
    fetchedItems: run.quality.fetchedItems,
    storedItems: run.quality.storedItems,
    notifiedItems: run.quality.notifiedItems,
  }
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => actual[key as keyof typeof actual] !== value)
    .map(([key, value]) => ({ key, expected: value, actual: actual[key as keyof typeof actual] }))

  return { expected, actual, mismatches }
}

function itemCountFor(trace: WorkflowTraceEvent[], event: WorkflowTraceEvent["event"]): number {
  return trace.find((entry) => entry.event === event)?.itemCount ?? 0
}

function expectsEvent(project: WorkflowProject, event: WorkflowTraceEvent["event"]): boolean {
  if (event === "triggered") return project.nodes.some((node) => node.kind === "schedule")
  if (event === "fetched") return project.nodes.some((node) => node.kind === "source")
  if (event === "normalized") return project.nodes.some((node) => node.kind === "agent" && node.capability === "normalize")
  if (event === "routed") return project.nodes.some((node) => node.kind === "router")
  if (event === "stored") return project.nodes.some((node) => node.kind === "inbox")
  if (event === "sent") return project.nodes.some((node) => node.kind === "notify")
  return false
}

function isStrictSequence(sequence: number[]): boolean {
  return sequence.every((value, index) => value === index + 1)
}

function aggregateStatus(findings: VerificationFinding[]): VerificationStatus {
  if (findings.some((finding) => finding.status === "fail")) return "fail"
  if (findings.some((finding) => finding.status === "warn")) return "warn"
  return "pass"
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}
