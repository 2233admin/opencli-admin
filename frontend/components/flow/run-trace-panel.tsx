"use client"

import { useMemo, useState } from "react"
import { Activity, Boxes, Loader2, Play, RotateCcw } from "lucide-react"
import { getApiAuthToken } from "@/lib/api/auth-token"
import { useFlowStore } from "@/lib/flow/store"
import { compileWorkflowProject, type WorkflowCompileResponse } from "@/lib/workflow/backend-compile"
import { traceOpenCLIHDAWorkflow, type WorkflowOpenCLIHDATraceResponse } from "@/lib/workflow/backend-opencli-hda-trace"
import {
  fetchWorkflowEvidenceBatchDetail,
  fetchWorkflowEvidenceBatchProjection,
  fetchWorkflowEvidenceBatches,
  replayWorkflowRunEventStream,
  startWorkflowRun,
  type WorkflowEvidenceBatchDetail,
  type WorkflowEvidenceBatchProjection,
  type WorkflowEvidenceBatchSummary,
  type WorkflowNodeRunEvent,
  type WorkflowRunProjection,
} from "@/lib/workflow/backend-runs"
import { applyRuntimeNodePatches, buildRuntimeNodePatches } from "@/lib/workflow/runtime-bridge"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type RealRunState =
  | { status: "idle"; projection: null; events: WorkflowNodeRunEvent[]; error: null }
  | { status: "running"; projection: WorkflowRunProjection | null; events: WorkflowNodeRunEvent[]; error: null }
  | { status: "ready"; projection: WorkflowRunProjection; events: WorkflowNodeRunEvent[]; error: null }
  | { status: "error"; projection: WorkflowRunProjection | null; events: WorkflowNodeRunEvent[]; error: string }

type BackendPreviewState =
  | { status: "idle"; compile: null; trace: null; error: null }
  | { status: "running"; compile: WorkflowCompileResponse | null; trace: WorkflowOpenCLIHDATraceResponse | null; error: null }
  | { status: "ready"; compile: WorkflowCompileResponse; trace: WorkflowOpenCLIHDATraceResponse | null; error: null }
  | { status: "blocked"; compile: WorkflowCompileResponse; trace: WorkflowOpenCLIHDATraceResponse | null; error: null }
  | { status: "error"; compile: WorkflowCompileResponse | null; trace: WorkflowOpenCLIHDATraceResponse | null; error: string }

type EvidenceBatchState = {
  status: "idle" | "loading" | "ready" | "error"
  projection: WorkflowEvidenceBatchProjection | null
  batches: WorkflowEvidenceBatchSummary[]
  detail: WorkflowEvidenceBatchDetail | null
  selectedBatchId: string | null
  error: string | null
}

function SectionCaption({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">{children}</p>
}

export function RunTracePanel() {
  const workflowProject = useFlowStore((state) => state.workflowProject)
  const nodeCount = useFlowStore((state) => state.nodes.length)
  const edgeCount = useFlowStore((state) => state.edges.length)
  const setNodes = useFlowStore((state) => state.setNodes)
  const applyWorkflowNodeRunEvent = useFlowStore((state) => state.applyWorkflowNodeRunEvent)
  const applyWorkflowRunProjection = useFlowStore((state) => state.applyWorkflowRunProjection)
  const applyWorkflowEvidenceBatchProjection = useFlowStore((state) => state.applyWorkflowEvidenceBatchProjection)
  const [runState, setRunState] = useState<RealRunState>({ status: "idle", projection: null, events: [], error: null })
  const [backendState, setBackendState] = useState<BackendPreviewState>({ status: "idle", compile: null, trace: null, error: null })
  const [evidenceState, setEvidenceState] = useState<EvidenceBatchState>({
    status: "idle",
    projection: null,
    batches: [],
    detail: null,
    selectedBatchId: null,
    error: null,
  })

  const projection = runState.projection
  const errors = projection?.errors ?? []
  const blockedCount = projection?.nodeStates.filter((node) => node.status === "blocked" || node.status === "failed").length ?? 0
  const batchCount = projection?.nodeStates.reduce((sum, node) => sum + node.batches.length, 0) ?? 0
  const itemCount = projection?.nodeStates.reduce(
    (sum, node) => sum + node.batches.reduce((inner, batch) => inner + batch.itemCount, 0),
    0,
  ) ?? 0
  const latestEvents = useMemo(() => runState.events.slice(-8).reverse(), [runState.events])
  const isRunning = runState.status === "running"
  const isBackendRunning = backendState.status === "running"

  const runBackendWorkflow = async () => {
    setRunState((current) => ({ status: "running", projection: current.projection, events: current.events, error: null }))
    try {
      const token = getApiAuthToken()
      const authorization = token ? `Bearer ${token}` : null
      const started = await startWorkflowRun(workflowProject, { authorization })
      applyWorkflowRunProjection(started)
      setRunState({ status: "running", projection: started, events: [], error: null })

      const replay = await replayWorkflowRunEventStream(started.runId, { authorization })
      for (const event of replay.events) {
        applyWorkflowNodeRunEvent(event)
      }
      const finalProjection = replay.projection ?? started
      applyWorkflowRunProjection(finalProjection)
      setRunState({ status: "ready", projection: finalProjection, events: replay.events, error: null })
      await loadEvidenceBatchResults(finalProjection.runId, authorization)
    } catch (error) {
      setRunState((current) => ({
        status: "error",
        projection: current.projection,
        events: current.events,
        error: error instanceof Error ? error.message : "Workflow run failed",
      }))
    }
  }

  const loadEvidenceBatchResults = async (runId: string, authorization: string | null) => {
    setEvidenceState((current) => ({ ...current, status: "loading", error: null, detail: null, selectedBatchId: null }))
    try {
      const [batchList, projection] = await Promise.all([
        fetchWorkflowEvidenceBatches(runId, { authorization }),
        fetchWorkflowEvidenceBatchProjection(runId, { authorization }),
      ])
      applyWorkflowEvidenceBatchProjection(projection, batchList.batches)
      setEvidenceState({
        status: "ready",
        projection,
        batches: batchList.batches,
        detail: null,
        selectedBatchId: null,
        error: null,
      })
    } catch (error) {
      setEvidenceState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "EvidenceBatch projection failed",
      }))
    }
  }

  const selectEvidenceBatch = async (batchId: string) => {
    if (!projection) return
    setEvidenceState((current) => ({ ...current, status: "loading", selectedBatchId: batchId, detail: null, error: null }))
    try {
      const token = getApiAuthToken()
      const detail = await fetchWorkflowEvidenceBatchDetail(projection.runId, batchId, {
        authorization: token ? `Bearer ${token}` : null,
      })
      setEvidenceState((current) => ({ ...current, status: "ready", detail, error: null }))
    } catch (error) {
      setEvidenceState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "EvidenceBatch detail failed",
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
    setRunState({ status: "idle", projection: null, events: [], error: null })
    setBackendState({ status: "idle", compile: null, trace: null, error: null })
    setEvidenceState({
      status: "idle",
      projection: null,
      batches: [],
      detail: null,
      selectedBatchId: null,
      error: null,
    })
  }

  return (
    <aside
      className="flex max-h-[32rem] w-80 flex-col overflow-hidden rounded-lg border bg-sidebar/95 shadow-xl backdrop-blur-sm"
      aria-label="运行追踪"
    >
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SectionCaption>Backend Run</SectionCaption>
            <h2 className="mt-1 flex items-center gap-2 text-sm font-medium">
              <Activity className="size-3.5 text-muted-foreground" />
              <span>Run Trace</span>
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {workflowProject.id} · {nodeCount}N / {edgeCount}E
            </p>
          </div>
          <Badge variant={runState.status === "error" ? "destructive" : "outline"} className="font-mono uppercase">
            {projection?.status ?? runState.status}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Button size="sm" onClick={runBackendWorkflow} disabled={isRunning || isBackendRunning}>
            {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run
          </Button>
          <Button size="sm" variant="outline" onClick={runBackendPreview} disabled={isRunning || isBackendRunning}>
            {isBackendRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
            Preview
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
          {projection ? (
            <RealRunProjection
              projection={projection}
              eventCount={runState.events.length}
              blockedCount={blockedCount}
              batchCount={batchCount}
              itemCount={itemCount}
            />
          ) : (
            <div className="rounded-md border border-dashed p-4 text-center text-xs leading-relaxed text-muted-foreground">
              no backend run yet
            </div>
          )}

          {latestEvents.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-2">
                <SectionCaption>SSE Events</SectionCaption>
                <div className="space-y-2">
                  {latestEvents.map((event) => (
                    <RunEventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {evidenceState.status !== "idle" ? (
            <>
              <Separator />
              <EvidenceBatchWorkbench state={evidenceState} onSelectBatch={selectEvidenceBatch} />
            </>
          ) : null}

          {errors.length > 0 ? (
            <>
              <Separator />
              <RuntimeErrorList errors={errors} />
            </>
          ) : null}

          {backendState.compile || backendState.trace ? (
            <>
              <Separator />
              <BackendRuntimePreview
                status={backendState.status}
                compile={backendState.compile}
                trace={backendState.trace}
              />
            </>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}

function EvidenceBatchWorkbench({
  state,
  onSelectBatch,
}: {
  state: EvidenceBatchState
  onSelectBatch: (batchId: string) => void
}) {
  const projection = state.projection
  const batches = state.batches
  const recordCount = batches.reduce((sum, batch) => sum + batch.recordCount, 0)
  const partialCount = projection?.summaries.filter((summary) => summary.status === "partial").length ?? 0
  const blockedCount = projection?.nodes.filter((node) => node.status === "blocked" || node.status === "failed").length ?? 0
  return (
    <div className="space-y-3" aria-label="EvidenceBatch results">
      <div className="flex items-center justify-between gap-2">
        <SectionCaption>Result Workbench</SectionCaption>
        {state.status === "loading" ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
      </div>

      {projection ? (
        <MetricGrid
          title="EvidenceBatch Projection"
          metrics={[
            { key: "status", label: "Status", value: projection.status, tone: projection.status === "completed" ? "good" : "warn" },
            { key: "batches", label: "Batches", value: `${batches.length}`, tone: batches.length > 0 ? "good" : "neutral" },
            { key: "records", label: "Records", value: `${recordCount}`, tone: recordCount > 0 ? "good" : "neutral" },
            { key: "partial", label: "Partial", value: `${partialCount}`, tone: partialCount === 0 ? "good" : "warn" },
            { key: "missing", label: "Missing", value: `${projection.missingSources.length}`, tone: projection.missingSources.length === 0 ? "good" : "warn" },
            { key: "blocked", label: "Blocked", value: `${blockedCount}`, tone: blockedCount === 0 ? "good" : "warn" },
          ]}
        />
      ) : null}

      {state.error ? (
        <div className="rounded-md border border-[#d97706]/30 bg-[#d97706]/10 p-2.5 text-[11px] leading-relaxed text-[#d97706]">
          {state.error}
        </div>
      ) : null}

      {projection?.missingSources.length ? (
        <div className="space-y-1.5">
          {projection.missingSources.slice(0, 4).map((source) => (
            <div
              key={`${source.nodeId}-${source.sourceGroup ?? "source"}`}
              className="rounded-md border border-[#d97706]/25 bg-[#d97706]/10 p-2.5"
            >
              <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                <span className="min-w-0 truncate text-[#d97706]">{source.nodeId}</span>
                <span className="shrink-0 uppercase text-muted-foreground">{source.status}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                {source.reasons[0]?.message ?? `Missing source ${source.sourceGroup ?? "output"}`}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {batches.length > 0 ? (
        <div className="space-y-1.5">
          {batches.map((batch) => (
            <button
              key={batch.batchId}
              type="button"
              onClick={() => onSelectBatch(batch.batchId)}
              className={cn(
                "block w-full rounded-md border bg-card p-2.5 text-left transition-colors hover:border-foreground/30",
                state.selectedBatchId === batch.batchId && "border-foreground/40 bg-accent/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10px]">
                  <Boxes className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{batch.batchId}</span>
                </span>
                <span className={cn(
                  "shrink-0 font-mono text-[9px] uppercase",
                  batch.status === "completed" ? "text-[#2f9e44]" : "text-[#d97706]",
                )}>
                  {batch.status}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                {batch.nodeId} · {batch.sourceGroup ?? "ungrouped"} · {batch.recordCount} records
              </p>
              {batch.manifestUri || batch.odpRef ? (
                <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/80">
                  {batch.manifestUri ?? batch.odpRef}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      ) : state.status === "ready" ? (
        <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          no EvidenceBatch output
        </div>
      ) : null}

      {state.detail ? <EvidenceBatchDetailCard detail={state.detail} /> : null}
    </div>
  )
}

function EvidenceBatchDetailCard({ detail }: { detail: WorkflowEvidenceBatchDetail }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <SectionCaption>Batch Detail</SectionCaption>
        <Badge variant="outline" className="font-mono text-[9px] uppercase">{detail.sourceCoverage.status}</Badge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] text-muted-foreground">
        <span>{detail.itemCount} items</span>
        <span className="text-right">{detail.recordCount} records</span>
      </div>
      <p className="mt-2 line-clamp-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
        source {detail.sourceCoverage.sourceGroup ?? "ungrouped"} · {detail.sourceCoverage.batchCount} batches
      </p>
      {detail.manifestUri || detail.odpRef ? (
        <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground/80">
          {detail.manifestUri ?? detail.odpRef}
        </p>
      ) : null}
    </div>
  )
}

function RealRunProjection({
  projection,
  eventCount,
  blockedCount,
  batchCount,
  itemCount,
}: {
  projection: WorkflowRunProjection
  eventCount: number
  blockedCount: number
  batchCount: number
  itemCount: number
}) {
  return (
    <div className="space-y-3">
      <MetricGrid
        title="Run Projection"
        metrics={[
          { key: "status", label: "Status", value: projection.status, tone: projection.status === "completed" ? "good" : projection.status === "failed" || projection.status === "blocked" ? "warn" : "neutral" },
          { key: "events", label: "Events", value: `${eventCount || projection.eventCount}`, tone: eventCount > 0 ? "good" : "neutral" },
          { key: "nodes", label: "Nodes", value: `${projection.nodeStates.length}`, tone: projection.nodeStates.length > 0 ? "good" : "neutral" },
          { key: "blocked", label: "Blocked", value: `${blockedCount}`, tone: blockedCount === 0 ? "good" : "warn" },
          { key: "batches", label: "Batches", value: `${batchCount}`, tone: batchCount > 0 ? "good" : "neutral" },
          { key: "items", label: "Items", value: `${itemCount}`, tone: itemCount > 0 ? "good" : "neutral" },
        ]}
      />
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
          <span className="min-w-0 truncate text-foreground">run {projection.runId}</span>
          <Badge variant={projection.valid ? "secondary" : "outline"} className="font-mono text-[9px] uppercase">
            {projection.valid ? "valid" : "invalid"}
          </Badge>
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">trace {projection.traceId}</p>
      </div>
      <div className="space-y-1.5">
        {projection.nodeStates.map((node) => (
          <div key={node.nodeId} className="rounded-md border bg-card px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="min-w-0 truncate text-foreground">{node.nodeId}</span>
              <span className={cn("shrink-0 uppercase", node.status === "completed" ? "text-[#2f9e44]" : node.status === "blocked" || node.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {node.status}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {node.eventCount} events · {node.batches.length} batches
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function RunEventCard({ event }: { event: WorkflowNodeRunEvent }) {
  const itemCount = event.batch?.itemCount ?? 0
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 font-mono text-[11px]">
          <span className="text-muted-foreground">{event.sequence}</span>
          <span className="mx-1.5 text-muted-foreground/50">/</span>
          <span>{event.eventType}</span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {itemCount} items
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{event.nodeId}</p>
      {event.message ?? event.blockReason?.message ? (
        <p className="mt-1.5 line-clamp-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground/80">
          {event.message ?? event.blockReason?.message}
        </p>
      ) : null}
    </div>
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
        title="Backend Preview"
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
