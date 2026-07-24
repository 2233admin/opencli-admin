"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Activity, Boxes, FileInput, Loader2, Play, RotateCcw } from "lucide-react"
import { getApiAuthToken } from "@/lib/api/auth-token"
import { useFlowStore } from "@/lib/flow/store"
import { fetchWorkflowCapabilities } from "@/lib/workflow/backend-capabilities"
import { compileWorkflowProject, type WorkflowCompileResponse } from "@/lib/workflow/backend-compile"
import {
  findOpenCLIHDAWorkflowPackageNodeId,
  traceOpenCLIHDAWorkflow,
  type WorkflowOpenCLIHDATraceResponse,
} from "@/lib/workflow/backend-opencli-hda-trace"
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
  type WorkflowRunStatus,
} from "@/lib/workflow/backend-runs"
import { fetchWorkflowToolCapabilities } from "@/lib/workflow/backend-tool-capabilities"
import {
  buildNativeIntelligencePreviewEvidence,
  findNativeIntelligenceWorkflowPackageNodeId,
  type NativeIntelligencePreviewEvidence,
} from "@/lib/workflow/native-intelligence-preview"
import { formatNativeIntelligenceResultPreview } from "@/lib/workflow/native-intelligence-result-preview"
import { applyRuntimeNodePatches, buildRuntimeNodePatches } from "@/lib/workflow/runtime-bridge"
import type { WorkflowProject } from "@/lib/workflow/schema"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

type RealRunState =
  | { status: "idle"; projection: null; events: WorkflowNodeRunEvent[]; error: null }
  | { status: "running"; projection: WorkflowRunProjection | null; events: WorkflowNodeRunEvent[]; error: null }
  | { status: "ready"; projection: WorkflowRunProjection; events: WorkflowNodeRunEvent[]; error: null }
  | { status: "error"; projection: WorkflowRunProjection | null; events: WorkflowNodeRunEvent[]; error: string }

type BackendPreviewState =
  | { status: "idle"; compile: null; trace: null; native: null; error: null }
  | { status: "running"; compile: WorkflowCompileResponse | null; trace: WorkflowOpenCLIHDATraceResponse | null; native: NativeIntelligencePreviewEvidence | null; error: null }
  | { status: "ready"; compile: WorkflowCompileResponse; trace: WorkflowOpenCLIHDATraceResponse | null; native: NativeIntelligencePreviewEvidence | null; error: null }
  | { status: "blocked"; compile: WorkflowCompileResponse; trace: WorkflowOpenCLIHDATraceResponse | null; native: NativeIntelligencePreviewEvidence | null; error: null }
  | { status: "error"; compile: WorkflowCompileResponse | null; trace: WorkflowOpenCLIHDATraceResponse | null; native: NativeIntelligencePreviewEvidence | null; error: string }

type EvidenceBatchState = {
  status: "idle" | "loading" | "ready" | "error"
  projection: WorkflowEvidenceBatchProjection | null
  batches: WorkflowEvidenceBatchSummary[]
  detail: WorkflowEvidenceBatchDetail | null
  selectedBatchId: string | null
  error: string | null
}

const INSPECTABLE_NATIVE_ACTIONS = new Set([
  "simulation.timeline",
  "simulation.stats",
  "interviews.history",
  "report.progress",
  "report.read",
  "report.ask",
  "report.answers",
])

function SectionCaption({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">{children}</p>
}

const RUN_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  partial: "处理中",
  partial_success: "部分成功",
  blocked: "已阻止",
  completed: "成功",
  failed: "失败",
}

export function RunTracePanel({ runRequestId = 0 }: { runRequestId?: number }) {
  const runButtonRef = useRef<HTMLButtonElement>(null)
  const workflowProject = useFlowStore((state) => state.workflowProject)
  const selectedNodeId = useFlowStore((state) => state.nodes.find((node) => node.selected)?.id ?? null)
  const nodeCount = useFlowStore((state) => state.nodes.length)
  const edgeCount = useFlowStore((state) => state.edges.length)
  const setNodes = useFlowStore((state) => state.setNodes)
  const applyWorkflowNodeRunEvent = useFlowStore((state) => state.applyWorkflowNodeRunEvent)
  const applyWorkflowRunProjection = useFlowStore((state) => state.applyWorkflowRunProjection)
  const applyWorkflowEvidenceBatchProjection = useFlowStore((state) => state.applyWorkflowEvidenceBatchProjection)
  const [runState, setRunState] = useState<RealRunState>({ status: "idle", projection: null, events: [], error: null })
  const [backendState, setBackendState] = useState<BackendPreviewState>({ status: "idle", compile: null, trace: null, native: null, error: null })
  const [evidenceState, setEvidenceState] = useState<EvidenceBatchState>({
    status: "idle",
    projection: null,
    batches: [],
    detail: null,
    selectedBatchId: null,
    error: null,
  })
  const [importNodeId, setImportNodeId] = useState("")
  const [importOutputText, setImportOutputText] = useState("[\n  {\n    \"title\": \"Imported example\",\n    \"url\": \"https://example.com/item\"\n  }\n]")
  const [importError, setImportError] = useState<string | null>(null)

  const outputInputNodes = useMemo(() => collectOutputInputNodes(workflowProject), [workflowProject])
  const selectedSourceId = outputInputNodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : null
  const effectiveImportNodeId = outputInputNodes.some((node) => node.id === importNodeId)
    ? importNodeId
    : selectedSourceId ?? outputInputNodes[0]?.id ?? ""

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

  const runBackendWorkflow = async (sourceOutputs?: Record<string, Array<Record<string, unknown>>>) => {
    setRunState((current) => ({ status: "running", projection: current.projection, events: current.events, error: null }))
    try {
      const token = getApiAuthToken()
      const authorization = token ? `Bearer ${token}` : null
      const started = await startWorkflowRun(workflowProject, { authorization, sourceOutputs })
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

  const runImportedOutput = async () => {
    if (!effectiveImportNodeId) {
      setImportError("当前工作流没有可接收导入输出的输入节点。")
      return
    }
    try {
      const decoded: unknown = JSON.parse(importOutputText)
      const items = Array.isArray(decoded)
        ? decoded
        : decoded && typeof decoded === "object" && Array.isArray((decoded as { items?: unknown }).items)
          ? (decoded as { items: unknown[] }).items
          : null
      if (!items || !items.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
        throw new Error("输出必须是对象数组，或形如 { \"items\": [...] }。")
      }
      setImportError(null)
      await runBackendWorkflow({ [effectiveImportNodeId]: items as Array<Record<string, unknown>> })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入输出格式无效")
    }
  }

  useEffect(() => {
    if (runRequestId > 0) runButtonRef.current?.click()
  }, [runRequestId])

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
    setBackendState((current) => ({ status: "running", compile: current.compile, trace: current.trace, native: current.native, error: null }))
    try {
      const token = getApiAuthToken()
      const authorization = token ? `Bearer ${token}` : null
      const nativePackageNodeId = findNativeIntelligenceWorkflowPackageNodeId(workflowProject)
      const [compile, nativeDependencies] = await Promise.all([
        compileWorkflowProject(workflowProject, { authorization }),
        nativePackageNodeId
          ? Promise.all([
              fetchWorkflowCapabilities({ authorization }),
              fetchWorkflowToolCapabilities({ authorization }),
            ])
          : Promise.resolve(null),
      ])
      const openCLIPackageNodeId = findOpenCLIHDAWorkflowPackageNodeId(workflowProject)
      const trace = compile.valid && openCLIPackageNodeId
        ? await traceOpenCLIHDAWorkflow(workflowProject, {
            authorization,
            packageNodeId: openCLIPackageNodeId,
          })
        : null
      const native = nativeDependencies
        ? buildNativeIntelligencePreviewEvidence({
            project: workflowProject,
            compile,
            capabilities: nativeDependencies[0],
            tools: nativeDependencies[1].tools,
          })
        : null
      const patches = buildRuntimeNodePatches({ compile, trace })
      setNodes((nodes) => applyRuntimeNodePatches(nodes, patches))
      setBackendState({
        status: compile.valid
          && (trace === null || trace.valid)
          && (native === null || native.status === "ready")
          ? "ready"
          : "blocked",
        compile,
        trace,
        native,
        error: null,
      })
    } catch (error) {
      setBackendState((current) => ({
        status: "error",
        compile: current.compile,
        trace: current.trace,
        native: current.native,
        error: error instanceof Error ? error.message : "Backend runtime preview failed",
      }))
    }
  }

  const resetRun = () => {
    setRunState({ status: "idle", projection: null, events: [], error: null })
    setBackendState({ status: "idle", compile: null, trace: null, native: null, error: null })
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
            {projection ? RUN_STATUS_LABELS[projection.status] : runState.status}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Button ref={runButtonRef} size="sm" onClick={() => void runBackendWorkflow()} disabled={isRunning || isBackendRunning}>
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
        <details className="mt-3 rounded-md border bg-card/50 p-2.5" open={Boolean(selectedSourceId)}>
          <summary className="flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            <FileInput className="size-3.5" />导入节点输出
          </summary>
          <div className="mt-2.5 space-y-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">把真实或测试 JSON 输出注入一个源节点，再启动同一条原生运行链路；不会改写节点配置。</p>
            {outputInputNodes.length ? <Select value={effectiveImportNodeId} onValueChange={(value) => setImportNodeId(value ?? "")}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择输入节点" /></SelectTrigger><SelectContent>{outputInputNodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.label}</SelectItem>)}</SelectContent></Select> : null}
            <Textarea value={importOutputText} onChange={(event) => setImportOutputText(event.target.value)} rows={5} className="font-mono text-[10px]" aria-label="导入节点输出 JSON" />
            {importError ? <p className="text-[11px] text-destructive">{importError}</p> : null}
            <Button size="sm" variant="outline" className="w-full" onClick={() => void runImportedOutput()} disabled={!outputInputNodes.length || isRunning || isBackendRunning}>
              <FileInput className="size-3.5" />导入输出并运行
            </Button>
          </div>
        </details>
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

          {backendState.compile || backendState.trace || backendState.native ? (
            <>
              <Separator />
              <BackendRuntimePreview
                status={backendState.status}
                compile={backendState.compile}
                trace={backendState.trace}
                native={backendState.native}
              />
            </>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}

type OutputInputNode = { id: string; label: string }

function collectOutputInputNodes(project: WorkflowProject): OutputInputNode[] {
  const inputNodes: OutputInputNode[] = []
  for (const node of project.nodes) {
    if (canReceiveImportedOutput(node)) inputNodes.push({ id: node.id, label: nodeLabel(node) })
    for (const internalNode of node.internals?.nodes ?? []) {
      const parsed = readWorkflowProjectNode(internalNode)
      if (parsed && canReceiveImportedOutput(parsed)) {
        inputNodes.push({ id: `${node.id}::${parsed.id}`, label: `${nodeLabel(node)} / ${nodeLabel(parsed)}` })
      }
    }
  }
  return inputNodes
}

function canReceiveImportedOutput(node: WorkflowProject["nodes"][number]): boolean {
  return node.kind === "source" || node.capability === "fetch" || Array.isArray(node.params.sources)
}

function readWorkflowProjectNode(value: unknown): WorkflowProject["nodes"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === "string" && typeof candidate.kind === "string" && typeof candidate.capability === "string"
    && candidate.params && typeof candidate.params === "object" && !Array.isArray(candidate.params)
    ? candidate as WorkflowProject["nodes"][number]
    : null
}

function nodeLabel(node: WorkflowProject["nodes"][number]): string {
  const label = node.ui?.label
  return typeof label === "string" && label.trim() ? label : node.id
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
  const sample = Array.isArray(event.details.sampleOutputs)
    ? readRecord(event.details.sampleOutputs[0])
    : null
  const native = sample?.action ? sample : event.details
  const nativeAction = typeof native.action === "string" ? native.action : null
  const domainState = typeof native.state === "string"
    ? native.state
    : typeof native.domainState === "string"
      ? native.domainState
      : null
  const sessionId = typeof native.sessionId === "string" ? native.sessionId : null
  const command = typeof native.command === "string" ? native.command : null
  const artifactIds = Array.isArray(native.artifactIds)
    ? native.artifactIds.filter((value): value is string => typeof value === "string")
    : []
  const provenance = readRecord(native.provenance)
  const nativeResult = native.result
  const result = readRecord(native.result)
  const artifacts = Array.isArray(result?.artifacts)
    ? result.artifacts.map(readRecord).filter((value): value is Record<string, unknown> => Boolean(value))
    : []
  const simulated = artifacts.some((artifact) => artifact.simulated === true)
  const groundingIds = artifacts.flatMap((artifact) =>
    Array.isArray(artifact.groundingArtifactIds)
      ? artifact.groundingArtifactIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  )
  const nativeResultPreview =
    nativeAction && INSPECTABLE_NATIVE_ACTIONS.has(nativeAction) && nativeResult !== undefined
      ? formatNativeIntelligenceResultPreview(nativeResult)
      : null
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
      {nativeAction || command || domainState || sessionId || artifactIds.length ? (
        <div className="mt-2 rounded-sm border bg-background/70 p-2 font-mono text-[9px] text-muted-foreground">
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {nativeAction ? <span>action {nativeAction}</span> : null}
            {command ? <span>transition {command}</span> : null}
            {domainState ? <span>state {domainState}</span> : null}
            {provenance?.credentialFree === true ? <span>credential-free</span> : null}
            {provenance?.offline === true ? <span>offline</span> : null}
            {simulated ? <span>simulated</span> : null}
          </div>
          {sessionId ? <p className="mt-1 truncate">session {sessionId}</p> : null}
          {artifactIds.length ? (
            <p className="mt-1 truncate" title={artifactIds.join(", ")}>
              artifacts {artifactIds.join(", ")}
            </p>
          ) : null}
          {groundingIds.length ? (
            <p className="mt-1 truncate" title={groundingIds.join(", ")}>
              grounding {groundingIds.join(", ")}
            </p>
          ) : null}
          {nativeResultPreview ? (
            <div className="mt-2">
              <p className="mb-1 uppercase">result</p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-sm border bg-card p-2 text-[9px] leading-relaxed text-foreground">
                {nativeResultPreview}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function BackendRuntimePreview({
  status,
  compile,
  trace,
  native,
}: {
  status: BackendPreviewState["status"]
  compile: WorkflowCompileResponse | null
  trace: WorkflowOpenCLIHDATraceResponse | null
  native: NativeIntelligencePreviewEvidence | null
}) {
  const runtimeNodes = compile?.plan?.runtime.nodes ?? []
  const boundCount = runtimeNodes.filter((node) => Boolean(readRecord(node.runtime.binding))).length
  const missingParameterCount = runtimeNodes.filter((node) => {
    const missingRuntime = readRecord(node.runtime.missing_runtime)
    return missingRuntime?.code === "missing_runtime_parameter"
  }).length
  const dispatches = trace?.dispatches ?? []
  const errors = [...(compile?.errors ?? []), ...(trace?.errors ?? [])]
  const nativeBlockedCount = native?.status === "blocked"
    ? Math.max(native.blockedActions.length, 1)
    : 0
  const blockedCount = errors.length + missingParameterCount + nativeBlockedCount

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
            value: `${blockedCount}`,
            tone: blockedCount === 0 ? "good" : "warn",
          },
          {
            key: "mode",
            label: "Mode",
            value: native ? "native-preview" : trace?.dispatch?.mode ?? compile?.plan?.runtime.execution_mode ?? "preview",
            tone: "neutral",
          },
        ]}
      />

      {native ? (
        <div className="rounded-md border bg-card p-3" aria-label="Native Intelligence Preview">
          <div className="flex items-center justify-between gap-2">
            <SectionCaption>Native Intelligence Preview</SectionCaption>
            <Badge variant={native.status === "ready" ? "secondary" : "outline"} className="font-mono text-[9px] uppercase">
              {native.status}
            </Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{native.actions.length}/{native.expectedActionCount} actions</span>
            <span className="text-right">{native.compiledNodeIds.length} compiled nodes</span>
            <span>readiness {native.readiness.status}</span>
            <span className="text-right">dispatch none · mutation none</span>
          </div>
          <div className="mt-3 max-h-52 space-y-1.5 overflow-auto">
            {native.actions.map((action) => (
              <div key={action.action} className="flex items-center justify-between gap-2 rounded-sm border bg-background px-2 py-1.5 font-mono text-[10px]">
                <span className="min-w-0 truncate text-foreground">{action.action}</span>
                <span className={action.status === "runnable" ? "text-[#4ade80]" : "text-[#d97706]"}>
                  {action.status}
                </span>
              </div>
            ))}
          </div>
          {native.missingReasons.length > 0 ? (
            <div className="mt-3 rounded-sm border border-[#d97706]/30 bg-[#d97706]/10 p-2 font-mono text-[9px] text-[#d97706]">
              {native.missingReasons.join(" · ")}
            </div>
          ) : null}
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Capability/readiness evidence only. Preview does not execute or mutate an intelligence session.
          </p>
        </div>
      ) : null}

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
