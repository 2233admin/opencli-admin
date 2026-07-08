import { createDefaultAdapterRegistry, type AdapterRegistry } from "./adapter-registry"
import { summarizeWorkflowRun } from "./run-summary"
import { readLatestWorkflowRunArtifact } from "./run-artifacts"
import { parseWorkflowProject, type WorkflowProject } from "./schema"
import { simulateWorkflowRun, type WorkflowSimulationRun } from "./simulation"
import { verifyWorkflowRun, type WorkflowVerificationReport } from "./verification"

export type AgentSelfCheckStatus = "pass" | "warn" | "fail"

export type AgentSelfCheckItem = {
  id: string
  status: AgentSelfCheckStatus
  summary: string
  evidence: Record<string, unknown>
}

export type AgentSelfCheckReport = {
  schemaVersion: 1
  generatedAt: string
  status: AgentSelfCheckStatus
  project: {
    id: string
    name: string
    profile: WorkflowProject["profile"]
    version: number
  }
  contract: {
    endpoint: string
    commands: string[]
    intendedReaders: string[]
  }
  checks: AgentSelfCheckItem[]
  graph: {
    nodeCount: number
    edgeCount: number
    nodeIds: string[]
    edgeIds: string[]
    missingTraceNodeIds: string[]
  }
  adapters: {
    sourceBindings: Array<{ id: string; provider: string; mode: string; registered: boolean }>
    notificationBindings: Array<{ id: string; provider: string; mode: string; simulated: boolean }>
  }
  permissions: WorkflowProject["agentPermissions"]
  run: WorkflowSimulationRun
  runSummary: ReturnType<typeof summarizeWorkflowRun>
  verification: WorkflowVerificationReport
  agentEvidence: {
    handoffSummary: string
    latestRunArtifact: {
      runId: string
      artifactPath: string
      apiPath: string
      generatedAt: string
    } | null
    observations: Array<{ id: string; jsonPointer: string; description: string }>
    traceByNode: Record<string, Array<{ sequence: number; event: string; itemCount: number; details: Record<string, unknown> }>>
    nextActions: string[]
  }
}

export type AgentSelfCheckOptions = {
  now?: Date
  endpoint?: string
  registry?: AdapterRegistry
}

export async function createAgentSelfCheckReport(
  input: unknown,
  options: AgentSelfCheckOptions = {},
): Promise<AgentSelfCheckReport> {
  const project = parseWorkflowProject(input)
  const registry = options.registry ?? createDefaultAdapterRegistry()
  const run = await simulateWorkflowRun(project, registry)
  const runSummary = summarizeWorkflowRun(run)
  const verification = verifyWorkflowRun(project, run)
  const traceNodeIds = new Set(run.trace.map((event) => event.nodeId))
  const missingTraceNodeIds = project.nodes.map((node) => node.id).filter((nodeId) => !traceNodeIds.has(nodeId))
  const sourceBindings = project.adapters
    .filter((binding) => binding.type === "source")
    .map((binding) => ({
      id: binding.id,
      provider: binding.provider,
      mode: binding.mode,
      registered: Boolean(registry.sourceAdapters[binding.provider]),
    }))
  const notificationBindings = project.adapters
    .filter((binding) => binding.type === "notification")
    .map((binding) => ({
      id: binding.id,
      provider: binding.provider,
      mode: binding.mode,
      simulated: binding.mode === "mock" || binding.mode === "webhook",
    }))
  const skippedEvents = run.trace.filter((event) => event.event === "skipped")
  const latestRunArtifact = await readLatestWorkflowRunArtifact()
  const checks: AgentSelfCheckItem[] = [
    {
      id: "workflow-schema",
      status: "pass",
      summary: "Canonical workflow parsed and references are valid.",
      evidence: { version: project.version, profile: project.profile },
    },
    {
      id: "adapter-registry",
      status: sourceBindings.every((binding) => binding.registered) ? "pass" : "fail",
      summary: "Source adapter bindings are resolvable through the registry.",
      evidence: { sourceBindings },
    },
    {
      id: "headless-simulation",
      status: skippedEvents.length === 0 ? "pass" : "warn",
      summary: "Deterministic simulation can run without the visual editor.",
      evidence: {
        runId: run.runId,
        traceEventCount: run.runtime.traceEventCount,
        spanCount: run.spans.length,
        evaluationStatus: run.evaluation.status,
        skippedEvents,
      },
    },
    {
      id: "middle-state-evidence",
      status: missingTraceNodeIds.length === 0 ? "pass" : "warn",
      summary: "Trace events preserve per-node intermediate state for another agent.",
      evidence: {
        tracedNodeIds: [...traceNodeIds],
        missingTraceNodeIds,
      },
    },
    {
      id: "verification-harness",
      status: verification.status,
      summary: "Chip-verification-inspired assertions, coverage, scoreboard, and waveform are available.",
      evidence: {
        methodology: verification.methodology,
        assertionCount: verification.assertions.length,
        nodeCoveragePercent: verification.coverage.node.percent,
        scoreboardMismatches: verification.scoreboard.mismatches.length,
        contractCoveragePercent: verification.contracts.portCoverage.percent,
        contractFindings: verification.contracts.findings.length,
        waveformTicks: verification.waveform.length,
        spanCount: run.spans.length,
        evaluationStatus: run.evaluation.status,
        scorecard: run.evaluation.scorecard,
      },
    },
    {
      id: "side-effect-safety",
      status: project.agentPermissions.canSendNotifications ? "warn" : "pass",
      summary: "Notification side effects stay controlled for autonomous runs.",
      evidence: {
        canSendNotifications: project.agentPermissions.canSendNotifications,
        notificationBindings,
      },
    },
  ]
  const status = aggregateStatus(checks)

  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    status,
    project: {
      id: project.id,
      name: project.name,
      profile: project.profile,
      version: project.version,
    },
    contract: {
      endpoint: options.endpoint ?? "/api/agent/self-check",
      commands: ["npm run agent:self-check", "curl http://127.0.0.1:8080/api/agent/self-check"],
      intendedReaders: ["AI agent", "automation runner", "human reviewer"],
    },
    checks,
    graph: {
      nodeCount: project.nodes.length,
      edgeCount: project.edges.length,
      nodeIds: project.nodes.map((node) => node.id),
      edgeIds: project.edges.map((edge) => edge.id),
      missingTraceNodeIds,
    },
    adapters: {
      sourceBindings,
      notificationBindings,
    },
    permissions: project.agentPermissions,
    run,
    runSummary,
    verification,
    agentEvidence: {
      handoffSummary: buildHandoffSummary(project, run, status),
      latestRunArtifact: latestRunArtifact
        ? {
            runId: latestRunArtifact.runId,
            artifactPath: latestRunArtifact.artifactPath,
            apiPath: `/api/workflow/runs/${latestRunArtifact.runId}`,
            generatedAt: latestRunArtifact.generatedAt,
          }
        : null,
      observations: [
        {
          id: "checks",
          jsonPointer: "/checks",
          description: "Machine-readable pass/warn/fail checks with evidence for each subsystem.",
        },
        {
          id: "trace",
          jsonPointer: "/run/trace",
          description: "Ordered intermediate workflow states, including node id, event, item count, and details.",
        },
        {
          id: "span-tree",
          jsonPointer: "/run/spans",
          description: "Span-level prompt, model, tool, router, assertion, and delivery evidence.",
        },
        {
          id: "evaluation",
          jsonPointer: "/run/evaluation",
          description: "Deterministic evaluation dataset, scorecard, and regression findings.",
        },
        {
          id: "verification",
          jsonPointer: "/verification",
          description: "Chip-verification-inspired testbench, assertions, coverage, scoreboard, and waveform.",
        },
        {
          id: "contracts",
          jsonPointer: "/verification/contracts",
          description: "Variable, port, form parameter, and node assertion contracts for each workflow node.",
        },
        {
          id: "trace-by-node",
          jsonPointer: "/agentEvidence/traceByNode",
          description: "Trace events grouped by node id for targeted agent inspection.",
        },
        {
          id: "latest-run-artifact",
          jsonPointer: "/agentEvidence/latestRunArtifact",
          description: "Latest durable run artifact pointer if a workflow run has been persisted.",
        },
        {
          id: "next-actions",
          jsonPointer: "/agentEvidence/nextActions",
          description: "Suggested machine-safe follow-up actions based on the self-check status.",
        },
      ],
      traceByNode: groupTraceByNode(run),
      nextActions: buildNextActions(status, missingTraceNodeIds, skippedEvents.length),
    },
  }
}

function aggregateStatus(checks: AgentSelfCheckItem[]): AgentSelfCheckStatus {
  if (checks.some((check) => check.status === "fail")) return "fail"
  if (checks.some((check) => check.status === "warn")) return "warn"
  return "pass"
}

function groupTraceByNode(run: WorkflowSimulationRun): AgentSelfCheckReport["agentEvidence"]["traceByNode"] {
  const grouped: AgentSelfCheckReport["agentEvidence"]["traceByNode"] = {}
  for (const event of run.trace) {
    grouped[event.nodeId] ??= []
    grouped[event.nodeId].push({
      sequence: event.sequence,
      event: event.event,
      itemCount: event.itemCount,
      details: event.details,
    })
  }
  return grouped
}

function buildHandoffSummary(project: WorkflowProject, run: WorkflowSimulationRun, status: AgentSelfCheckStatus): string {
  return [
    `${project.name} self-check status=${status}.`,
    `${run.runtime.executedNodeCount}/${run.runtime.nodeCount} nodes executed.`,
    `${run.quality.fetchedItems} items fetched, ${run.quality.notifiedItems} notification candidates, ${run.quality.storedItems} stored.`,
  ].join(" ")
}

function buildNextActions(status: AgentSelfCheckStatus, missingTraceNodeIds: string[], skippedEventCount: number): string[] {
  if (status === "pass") {
    return [
      "Use /run/trace as the execution evidence for downstream Agent review.",
      "Use /run/spans to inspect prompt/model/tool intermediate states.",
      "Use /run/evaluation and /verification/scorecard before accepting optimization proposals.",
      "Use /agentEvidence/traceByNode when investigating a specific node.",
    ]
  }

  const actions = ["Inspect /checks for failing or warning evidence before changing workflow behavior."]
  if (missingTraceNodeIds.length > 0) {
    actions.push(`Add trace coverage for nodes: ${missingTraceNodeIds.join(", ")}.`)
  }
  if (skippedEventCount > 0) {
    actions.push("Inspect skipped trace events and adapter errors before enabling live execution.")
  }
  return actions
}
