"use client"

import { useMemo, useState } from "react"
import { Activity, Loader2, Play, RotateCcw } from "lucide-react"
import { getApiAuthToken } from "@/lib/api/auth-token"
import { useFlowStore } from "@/lib/flow/store"
import type { WorkflowSimulationRun } from "@/lib/workflow/simulation"
import type { WorkflowRunArtifact } from "@/lib/workflow/run-artifacts"
import { compileWorkflowProject, type WorkflowCompileResponse } from "@/lib/workflow/backend-compile"
import { traceOpenCLIHDAWorkflow, type WorkflowOpenCLIHDATraceResponse } from "@/lib/workflow/backend-opencli-hda-trace"
import { applyRuntimeNodePatches, buildRuntimeNodePatches } from "@/lib/workflow/runtime-bridge"
import { summarizeWorkflowRun } from "@/lib/workflow/run-summary"
import { verifyWorkflowRun } from "@/lib/workflow/verification"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type RunState =
  | { status: "idle"; run: null; artifact: null; error: null }
  | { status: "running"; run: WorkflowSimulationRun | null; artifact: WorkflowRunArtifact | null; error: null }
  | { status: "ready"; run: WorkflowSimulationRun; artifact: WorkflowRunArtifact; error: null }
  | { status: "error"; run: WorkflowSimulationRun | null; artifact: WorkflowRunArtifact | null; error: string }

type BackendPreviewState =
  | { status: "idle"; compile: null; trace: null; error: null }
  | { status: "running"; compile: WorkflowCompileResponse | null; trace: WorkflowOpenCLIHDATraceResponse | null; error: null }
  | { status: "ready"; compile: WorkflowCompileResponse; trace: WorkflowOpenCLIHDATraceResponse | null; error: null }
  | { status: "blocked"; compile: WorkflowCompileResponse; trace: WorkflowOpenCLIHDATraceResponse | null; error: null }
  | { status: "error"; compile: WorkflowCompileResponse | null; trace: WorkflowOpenCLIHDATraceResponse | null; error: string }

function SectionCaption({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">{children}</p>
}

export function RunTracePanel() {
  const workflowProject = useFlowStore((state) => state.workflowProject)
  const nodeCount = useFlowStore((state) => state.nodes.length)
  const edgeCount = useFlowStore((state) => state.edges.length)
  const setNodes = useFlowStore((state) => state.setNodes)
  const [runState, setRunState] = useState<RunState>({ status: "idle", run: null, artifact: null, error: null })
  const [backendState, setBackendState] = useState<BackendPreviewState>({ status: "idle", compile: null, trace: null, error: null })
  const [view, setView] = useState<"trace" | "waveform" | "scorecard" | "spans">("trace")

  const summary = useMemo(() => (runState.run ? summarizeWorkflowRun(runState.run) : null), [runState.run])
  const readyRun = runState.run!
  const verification = useMemo(
    () => (runState.run ? verifyWorkflowRun(workflowProject, runState.run) : null),
    [runState.run, workflowProject],
  )
  const isRunning = runState.status === "running"
  const isBackendRunning = backendState.status === "running"

  const runSimulation = async () => {
    setRunState((current) => ({ status: "running", run: current.run, artifact: current.artifact, error: null }))
    try {
      const token = getApiAuthToken()
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch("/api/workflow/run", {
        method: "POST",
        headers,
        body: JSON.stringify(workflowProject),
      })
      const artifact = (await response.json()) as WorkflowRunArtifact | { message?: string; errors?: Array<{ code: string; message: string; node_id?: string | null; edge_id?: string | null }> }
      if (!response.ok || !("run" in artifact)) {
        const anchors = "errors" in artifact && artifact.errors?.length
          ? ` (${artifact.errors.map((error) => error.node_id ?? error.edge_id ?? error.code).join(", ")})`
          : ""
        throw new Error(`${"message" in artifact && artifact.message ? artifact.message : "Workflow run failed"}${anchors}`)
      }
      setRunState({ status: "ready", run: artifact.run, artifact, error: null })
    } catch (error) {
      setRunState((current) => ({
        status: "error",
        run: current.run,
        artifact: current.artifact,
        error: error instanceof Error ? error.message : "Simulation failed",
      }))
    }
  }

  const runBackendPreview = async () => {
    setBackendState((current) => ({ status: "running", compile: current.compile, trace: current.trace, error: null }))
    try {
      const token = getApiAuthToken()
      const authorization = token ? `Bearer ${token}` : null
      const compile = await compileWorkflowProject(workflowProject, { authorization })
      const trace = compile.valid ? await traceOpenCLIHDAWorkflow(workflowProject, { authorization }) : null
      const patches = buildRuntimeNodePatches({ compile, trace })
      setNodes((nodes) => applyRuntimeNodePatches(nodes, patches))
      setBackendState({
        status: compile.valid && (trace === null || trace.valid) ? "ready" : "blocked",
        compile,
        trace,
        error: null,
      })
    } catch (error) {
      setBackendState((current) => ({
        status: "error",
        compile: current.compile,
        trace: current.trace,
        error: error instanceof Error ? error.message : "Backend runtime preview failed",
      }))
    }
  }

  const resetRun = () => {
    setRunState({ status: "idle", run: null, artifact: null, error: null })
    setBackendState({ status: "idle", compile: null, trace: null, error: null })
  }

  return (
    <aside
      className="flex max-h-[32rem] w-80 flex-col overflow-hidden rounded-lg border bg-sidebar/95 shadow-xl backdrop-blur-sm"
      aria-label="运行追踪"
    >
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionCaption>Deterministic Run</SectionCaption>
            <h2 className="mt-1 flex items-center gap-2 text-sm font-medium">
              <Activity className="size-3.5 text-muted-foreground" />
              <span>Run Trace</span>
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {workflowProject.id} · {nodeCount}N / {edgeCount}E
            </p>
          </div>
          <Badge variant={runState.status === "error" ? "destructive" : "outline"} className="font-mono uppercase">
            {runState.status}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Button size="sm" variant="outline" onClick={runSimulation} disabled={isRunning || isBackendRunning}>
            {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Sim
          </Button>
          <Button size="sm" onClick={runBackendPreview} disabled={isRunning || isBackendRunning}>
            {isBackendRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
            Backend
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={resetRun}
            disabled={isRunning || isBackendRunning || (runState.status === "idle" && backendState.status === "idle")}
          >
            <RotateCcw className="size-3.5" />
            <span className="sr-only">Reset run trace</span>
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {runState.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {runState.error}
            </div>
          ) : null}
          {backendState.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {backendState.error}
            </div>
          ) : null}

          {backendState.compile || backendState.trace ? (
            <>
              <BackendRuntimePreview
                status={backendState.status}
                compile={backendState.compile}
                trace={backendState.trace}
              />
              <Separator />
            </>
          ) : null}

          {!summary ? (
            <div className="rounded-md border border-dashed p-4 text-center text-xs leading-relaxed text-muted-foreground">
              no run artifact yet
            </div>
          ) : (
            <>
              <MetricGrid title="Quality" metrics={summary.quality} />
              <Separator />
              <MetricGrid title="Runtime" metrics={summary.runtime} />
              <Separator />
              <div className="grid grid-cols-4 gap-1 rounded-md bg-muted p-1 font-mono text-[9px] uppercase">
                {(["trace", "waveform", "scorecard", "spans"] as const).map((nextView) => (
                  <button
                    key={nextView}
                    type="button"
                    onClick={() => setView(nextView)}
                    className={cn(
                      "rounded-sm px-1.5 py-1 transition-colors",
                      view === nextView ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {nextView === "spans" ? "Span Tree" : nextView}
                  </button>
                ))}
              </div>
              <Separator />
              {verification ? (
                <>
                  <div className="space-y-2">
                    <SectionCaption>Verification</SectionCaption>
                    <div className="grid grid-cols-3 gap-2">
                      <Metric label="Status" value={verification.status} tone={verification.status === "pass" ? "good" : "warn"} />
                      <Metric label="Contracts" value={`${verification.contracts.portCoverage.percent}%`} tone="good" />
                      <Metric
                        label="Scoreboard"
                        value={verification.scoreboard.mismatches.length}
                        tone={verification.scoreboard.mismatches.length === 0 ? "good" : "warn"}
                      />
                    </div>
                    <div className="space-y-1.5">
                      {verification.assertions.map((assertion) => (
                        <div key={assertion.id} className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-2">
                          <span className="min-w-0 truncate font-mono text-[10px] text-foreground">{assertion.id}</span>
                          <Badge variant={assertion.status === "pass" ? "secondary" : "outline"} className="font-mono text-[9px]">
                            {assertion.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    {runState.artifact ? (
                      <div className="space-y-1.5 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                        <p>artifact: {runState.artifact.artifactPath}</p>
                        {runState.artifact.backendCompile ? (
                          <p>
                            backend: {runState.artifact.backendCompile.runtime.execution_mode} · {runState.artifact.backendCompile.runtime.node_ids.length} nodes
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <Separator />
                  {view === "waveform" ? (
                  <div className="space-y-2">
                    <SectionCaption>Waveform</SectionCaption>
                    <div className="space-y-1.5">
                      {verification.waveform.map((event) => (
                        <div key={`${event.tick}-${event.nodeId}`} className="grid grid-cols-[2rem_1fr_4rem] items-center gap-2 rounded-md border bg-card px-2.5 py-2 font-mono text-[10px]">
                          <span className="text-muted-foreground">t{event.tick}</span>
                          <div className="min-w-0">
                            <p className="truncate text-foreground">{event.nodeId}</p>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  event.signal === "skipped" ? "bg-[#d97706]" : "bg-[#2f9e44]",
                                )}
                                style={{ width: `${Math.max(12, Math.min(100, event.itemCount * 8))}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-right text-muted-foreground">{event.signal} · {event.itemCount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  ) : null}
                  {view === "scorecard" ? (
                    <div className="space-y-2">
                      <SectionCaption>Scorecard</SectionCaption>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(readyRun.evaluation.scorecard).map(([key, value]) => (
                          <Metric key={key} label={key} value={value.toFixed(2)} tone={value >= 0.85 ? "good" : "warn"} />
                        ))}
                      </div>
                      <div className="rounded-md border bg-card p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">dataset</span>
                          <span className="truncate font-mono text-[10px]">{readyRun.evaluation.dataset}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">cases</span>
                          <span className="font-mono text-[10px]">{readyRun.evaluation.caseCount}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {readyRun.evaluation.regressionFindings.map((finding) => (
                          <div key={finding.id} className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-2">
                            <span className="min-w-0 truncate font-mono text-[10px] text-foreground">{finding.id}</span>
                            <Badge variant={finding.status === "pass" ? "secondary" : "outline"} className="font-mono text-[9px]">
                              {finding.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {view === "spans" ? (
                    <div className="space-y-2">
                      <SectionCaption>Span Tree</SectionCaption>
                      <div className="space-y-1.5">
                        {readyRun.spans.map((span) => (
                          <div key={span.spanId} className={cn("rounded-md border bg-card p-2.5", span.parentSpanId && "ml-4")}>
                            <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                              <span className="min-w-0 truncate text-foreground">{span.type}</span>
                              <Badge variant={span.status === "ok" ? "secondary" : "outline"} className="font-mono text-[9px]">
                                {span.status}
                              </Badge>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                              <span className="truncate">{span.nodeId}</span>
                              <span>{span.durationMs}ms · {span.outputCount}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {view !== "trace" ? (
                  <Separator />
                  ) : null}
                </>
              ) : null}
              {view === "trace" ? (
              <div className="space-y-2">
                <SectionCaption>Trace Events</SectionCaption>
                <div className="space-y-2">
                  {summary.trace.map((event) => (
                    <div key={event.key} className="rounded-md border bg-card p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 font-mono text-[11px]">
                          <span className="text-muted-foreground">{event.sequence}</span>
                          <span className="mx-1.5 text-muted-foreground/50">/</span>
                          <span>{event.label}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {event.itemCount} items
                        </span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{event.nodeId}</p>
                      {event.details ? (
                        <p className="mt-1.5 line-clamp-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground/80">
                          {event.details}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function BackendRuntimePreview({
  status,
  compile,
  trace,
}: {
  status: BackendPreviewState["status"]
  compile: WorkflowCompileResponse | null
  trace: WorkflowOpenCLIHDATraceResponse | null
}) {
  const runtimeNodes = compile?.plan?.runtime.nodes ?? []
  const boundCount = runtimeNodes.filter((node) => Boolean(readRecord(node.runtime.binding))).length
  const missingParameterCount = runtimeNodes.filter((node) => {
    const missingRuntime = readRecord(node.runtime.missing_runtime)
    return missingRuntime?.code === "missing_runtime_parameter"
  }).length
  const dispatches = trace?.dispatches ?? []
  const errors = [...(compile?.errors ?? []), ...(trace?.errors ?? [])]

  return (
    <div className="space-y-3">
      <MetricGrid
        title="Backend Runtime"
        metrics={[
          {
            key: "status",
            label: "Status",
            value: status,
            tone: status === "ready" ? "good" : status === "idle" ? "neutral" : "warn",
          },
          {
            key: "nodes",
            label: "Runtime Nodes",
            value: `${runtimeNodes.length}`,
            tone: runtimeNodes.length > 0 ? "good" : "warn",
          },
          {
            key: "bound",
            label: "Bound",
            value: `${boundCount}`,
            tone: boundCount > 0 ? "good" : "neutral",
          },
          {
            key: "dispatches",
            label: "Dispatches",
            value: `${dispatches.length}`,
            tone: dispatches.length > 0 ? "good" : "neutral",
          },
          {
            key: "missing",
            label: "Blocked",
            value: `${errors.length + missingParameterCount}`,
            tone: errors.length + missingParameterCount === 0 ? "good" : "warn",
          },
          {
            key: "mode",
            label: "Mode",
            value: trace?.dispatch?.mode ?? compile?.plan?.runtime.execution_mode ?? "preview",
            tone: "neutral",
          },
        ]}
      />

      {trace ? (
        <div className="rounded-md border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <SectionCaption>OpenCLI HDA Trace</SectionCaption>
            <Badge variant={trace.valid ? "secondary" : "outline"} className="font-mono text-[9px] uppercase">
              {trace.valid ? "ready" : "blocked"}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] text-muted-foreground">
            <span className="truncate">run {trace.runId}</span>
            <span className="truncate text-right">trace {trace.traceId}</span>
          </div>
          {dispatches.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {dispatches.slice(0, 6).map((dispatch) => (
                <div key={dispatch.taskId} className="rounded-sm border bg-background px-2 py-1.5 font-mono text-[10px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-foreground">{dispatch.nodeId}</span>
                    <span className="shrink-0 text-muted-foreground">{dispatch.sourceGroup}</span>
                  </div>
                  <p className="mt-1 truncate text-muted-foreground">
                    {dispatch.site} · {dispatch.command} · {dispatch.iii.function_id}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {errors.length > 0 ? <RuntimeErrorList errors={errors} /> : null}
    </div>
  )
}

function RuntimeErrorList({ errors }: { errors: Array<{ code: string; message: string; node_id?: string | null; edge_id?: string | null }> }) {
  return (
    <div className="space-y-1.5">
      <SectionCaption>Runtime Blocks</SectionCaption>
      {errors.slice(0, 5).map((error) => (
        <div key={`${error.code}-${error.node_id ?? error.edge_id ?? error.message}`} className="rounded-md border border-destructive/25 bg-destructive/10 p-2.5">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
            <span className="min-w-0 truncate text-destructive">{error.code}</span>
            <span className="shrink-0 text-muted-foreground">{error.node_id ?? error.edge_id ?? "workflow"}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-destructive/90">{error.message}</p>
        </div>
      ))}
    </div>
  )
}

function MetricGrid({ title, metrics }: { title: string; metrics: { key: string; label: string; value: string; tone: string }[] }) {
  return (
    <div className="space-y-2">
      <SectionCaption>{title}</SectionCaption>
      <div className="grid grid-cols-3 gap-2">
        {metrics.map((metric) => (
          <div key={metric.key} className="rounded-md border bg-card p-2">
            <p className="truncate text-[10px] text-muted-foreground">{metric.label}</p>
            <p
              className={cn(
                "mt-1 font-mono text-sm",
                metric.tone === "good" && "text-[#2f9e44]",
                metric.tone === "warn" && "text-[#d97706]",
              )}
            >
              {metric.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-md border bg-card p-2">
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-sm",
          tone === "good" && "text-[#2f9e44]",
          tone === "warn" && "text-[#d97706]",
        )}
      >
        {value}
      </p>
    </div>
  )
}
