"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, PlugZap } from "lucide-react"
import { useFlowStore } from "@/lib/flow/store"
import type { WorkflowNodeData, FieldConfig } from "@/lib/flow/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { NodeInternalStatus } from "@/lib/workflow/node-internals"
import { getNodeTemplate } from "@/lib/workflow/node-templates"
import { buildParameterInterfaceView, type ParameterInterfaceViewField } from "@/lib/workflow/parameter-interface"
import { blockedActionViewForRuntime } from "@/lib/workflow/capabilities"
import { buildCanonicalNodeViewContract } from "@/lib/workflow/canonical-node-contract"
import { MonoRow, PanelShell, SectionCaption } from "./inspector-shell"
import { cn } from "@/lib/utils"

const edgeTypeOptions = [
  { value: "workflow", label: "默认（贝塞尔曲线）" },
  { value: "editable", label: "可编辑路径" },
  { value: "routed", label: "智能避障（正交路由）" },
]

const edgeTypeHints: Record<string, string> = {
  workflow: "标准平滑曲线连线。",
  editable: "选中后可拖动控制点调整路径，双击线条添加控制点、双击控制点删除。",
  routed: "自动绕开中间节点的正交折线，适合密集流程图。",
}

const internalStatusLabel: Record<NodeInternalStatus, string> = {
  ready: "READY",
  simulated: "SIM",
  future: "NEXT",
}

const internalStatusClass: Record<NodeInternalStatus, string> = {
  ready: "border-[#4ade80]/30 bg-[#4ade80]/10 text-[#4ade80]",
  simulated: "border-[#a0c3ec]/30 bg-[#a0c3ec]/10 text-[#a0c3ec]",
  future: "border-border bg-muted text-muted-foreground",
}

const houdiniInputClass =
  "h-7 rounded-[2px] border-[#2c3036] bg-[#07080a] px-2 font-mono text-[11px] text-foreground shadow-inner outline-none transition-colors placeholder:text-muted-foreground/45 focus-visible:border-[#5f6976] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60 read-only:opacity-80"

const houdiniSelectTriggerClass =
  "h-7 rounded-[2px] border-[#2c3036] bg-[#07080a] px-2 font-mono text-[11px] shadow-inner focus:ring-0 focus:ring-offset-0"

const houdiniTextareaClass =
  "min-h-20 rounded-[2px] border-[#2c3036] bg-[#07080a] px-2 py-1.5 font-mono text-[11px] leading-relaxed shadow-inner focus-visible:ring-0 focus-visible:ring-offset-0"

const houdiniDetailsClass = "overflow-hidden rounded-[3px] border border-[#20242a] bg-[#111317]/74"

const houdiniSummaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 bg-[#171a1f] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"

type ProjectNodeWithIdentity = {
  params: Record<string, unknown>
  ui?: Record<string, unknown>
}

function hydrateProjectNodeIdentity<T extends ProjectNodeWithIdentity>(
  projectNode: T | undefined,
  data: WorkflowNodeData,
): T | undefined {
  const canonical = readCanonical(data)
  if (!projectNode || !canonical) return projectNode
  const catalogId = typeof projectNode.ui?.catalogId === "string" ? projectNode.ui.catalogId : canonical.catalogId
  const params = canonical.params ? { ...canonical.params, ...projectNode.params } : projectNode.params
  return {
    ...projectNode,
    params,
    ui: {
      ...projectNode.ui,
      ...(catalogId ? { catalogId } : {}),
    },
  }
}

type CanonicalNodeData = {
  catalogId?: string
  params?: Record<string, unknown>
}

function readCanonical(data: WorkflowNodeData): CanonicalNodeData | undefined {
  const canonical = data.canonical
  if (!canonical || typeof canonical !== "object" || Array.isArray(canonical)) return undefined
  return canonical as CanonicalNodeData
}

export function Inspector() {
  const nodes = useFlowStore((s) => s.nodes)
  const edges = useFlowStore((s) => s.edges)
  const workflowProject = useFlowStore((s) => s.workflowProject)
  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const updateEdgeData = useFlowStore((s) => s.updateEdgeData)
  const updateEdgeType = useFlowStore((s) => s.updateEdgeType)
  const toggleEdgeAnimated = useFlowStore((s) => s.toggleEdgeAnimated)
  const updateWorkflowNodeParams = useFlowStore((s) => s.updateWorkflowNodeParams)
  const updateParameterInterfaceField = useFlowStore((s) => s.updateParameterInterfaceField)
  const takeSnapshot = useFlowStore((s) => s.takeSnapshot)
  const setNodes = useFlowStore((s) => s.setNodes)
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const [nodeTab, setNodeTab] = useState<"config" | "prompt" | "run" | "trace">("config")
  const [parameterGroupTab, setParameterGroupTab] = useState("")

  const selected = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)

  const deselectAll = () => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
    onEdgesChange(edges.filter((e) => e.selected).map((e) => ({ id: e.id, type: "select" as const, selected: false })))
  }

  /* ---- edge parameter interface ---- */
  if (selected.length === 0 && selectedEdges.length === 1) {
    const edge = selectedEdges[0]
    const edgeType = edge.type ?? "workflow"
    return (
      <PanelShell
        title="Connection"
        typeLine={`EDGE::${edgeType.toUpperCase()}`}
        onClose={deselectAll}
      >
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="edge-label" className="font-mono text-[10px] uppercase tracking-wider">
              Label
            </Label>
            <Input
              id="edge-label"
              value={(edge.data?.label as string) ?? ""}
              onFocus={takeSnapshot}
              onChange={(e) => updateEdgeData(edge.id, { label: e.target.value })}
              placeholder="例如：成功 / 失败"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-wider">Type</Label>
            <Select value={edgeType} onValueChange={(v) => v && updateEdgeType(edge.id, v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {edgeTypeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{edgeTypeHints[edgeType]}</p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="edge-anim" className="font-mono text-[10px] uppercase tracking-wider">
                Flow Animation
              </Label>
              <p className="text-[11px] text-muted-foreground">显示流向的虚线动画</p>
            </div>
            <input
              id="edge-anim"
              type="checkbox"
              checked={!!edge.animated}
              onChange={() => toggleEdgeAnimated(edge.id)}
              className="houdini-checkbox"
            />
          </div>

          <Separator />
          <div className="space-y-1.5 rounded-md border bg-card p-3">
            <SectionCaption>Debug</SectionCaption>
            <MonoRow k="id" v={edge.id} />
            <MonoRow k="wire" v={`${edge.source} → ${edge.target}`} />
          </div>
        </div>
      </PanelShell>
    )
  }

  /* ---- nothing (or multiple) selected: stay out of the way ---- */
  if (selected.length !== 1) return null

  /* ---- node parameter interface ---- */
  const node = selected[0]
  const data = node.data as WorkflowNodeData
  const canonical = data.canonical as { kind?: string; capability?: string; adapter?: string; params?: Record<string, unknown> } | undefined
  const projectNode = hydrateProjectNodeIdentity(
    workflowProject.nodes.find((candidate) => candidate.id === node.id),
    data,
  )
  const projectAdapter = projectNode?.adapter
    ? workflowProject.adapters.find((candidate) => candidate.id === projectNode.adapter)
    : undefined
  const nodeTemplate = getNodeTemplate(projectNode)
  const nodeViewContract = buildCanonicalNodeViewContract(projectNode, data, node.id)
  const parameterInterfaceView = buildParameterInterfaceView({
    node: projectNode,
    adapter: projectAdapter,
    nodes,
    allowedParamIds: nodeViewContract.params.map((param) => param.id),
  })
  const nodeInternals = nodeViewContract.internals
  const nodeContract = nodeViewContract.staticContract
  const promptCapable =
    canonical?.kind === "agent" ||
    typeof data.primitiveId === "string" && (data.primitiveId.includes("prompt") || data.primitiveId.includes("model"))

  const update = (patch: Partial<WorkflowNodeData>) => updateNodeData(node.id, patch)

  const updateField = (fieldId: string, value: string) => {
    const fields = (data.fields ?? []).map((f: FieldConfig) =>
      f.id === fieldId ? { ...f, value } : f,
    )
    update({ fields })
  }

  const updateParameterField = (field: ParameterInterfaceViewField, value: unknown) => {
    if (field.readonly) return
    if (parameterInterfaceView?.mode === "template") {
      if (field.binding.source === "adapter") {
        if (field.binding.fieldId === "mode") {
          updateWorkflowNodeParams(node.id, {}, { mode: value as never })
          return
        }
        updateWorkflowNodeParams(node.id, {}, { config: { [field.binding.fieldId]: value } })
        return
      }
      if (field.binding.source === "data") {
        update({ [field.binding.fieldId]: value } as Partial<WorkflowNodeData>)
        return
      }
      updateWorkflowNodeParams(node.id, { [field.binding.fieldId]: value })
      return
    }
    updateParameterInterfaceField(node.id, field.id, value)
  }

  const renderParameterField = (field: ParameterInterfaceViewField) => {
    const raw = field.value
    const fieldId = `parameter-${field.id}`
    const label = (
      <div className="min-w-0 pt-1 text-right">
        <Label
          htmlFor={fieldId}
          title={field.description}
          className="block truncate font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground"
        >
          {field.label}
        </Label>
      </div>
    )
    const readonlyTone = field.readonly ? "opacity-70" : ""
    const row = (control: React.ReactNode, align = "items-start") => (
      <div
        key={field.id}
        className={cn(
          "grid grid-cols-[118px_minmax(0,1fr)] gap-3 border-b border-[#24282f] px-1 py-2 last:border-b-0",
          align,
          readonlyTone,
        )}
      >
        {label}
        <div className="min-w-0">{control}</div>
      </div>
    )

    if (field.type === "boolean") {
      const checked = raw === true || raw === "true"
      return row(
        <div className="flex h-7 items-center">
          <input
            id={fieldId}
            type="checkbox"
            checked={checked}
            disabled={field.readonly}
            onChange={(event) => updateParameterField(field, event.target.checked)}
            className="houdini-checkbox"
          />
        </div>,
        "items-center",
      )
    }

    if (field.type === "select") {
      const value = typeof raw === "string" ? raw : field.options?.[0]?.value
      const selectedLabel = field.options?.find((option) => option.value === value)?.label ?? value ?? ""
      return row(
        field.readonly ? (
          <Input
            id={fieldId}
            readOnly
            value={selectedLabel}
            className={houdiniInputClass}
          />
        ) : (
          <Select value={value} onValueChange={(next) => updateParameterField(field, next)}>
            <SelectTrigger id={fieldId} className={houdiniSelectTriggerClass}>
              <span className="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
            </SelectTrigger>
            <SelectContent className="rounded-[2px] border border-[#2c3036] bg-[#0d0f12] font-mono text-[11px]">
              {(field.options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value} className="rounded-[2px] text-[11px]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      )
    }

    if (field.type === "textarea") {
      return row(
          <Textarea
            id={fieldId}
            rows={3}
            readOnly={field.readonly}
            className={houdiniTextareaClass}
            value={typeof raw === "string" ? raw : ""}
            onChange={(e) => updateParameterField(field, e.target.value)}
          />,
      )
    }

    if (field.type === "tokens") {
      const selectedValues = new Set(
        Array.isArray(raw)
          ? raw.filter((value): value is string => typeof value === "string")
          : typeof raw === "string" && raw
            ? raw.split(",").map((value) => value.trim()).filter(Boolean)
            : [],
      )
      return row(
        <div className="flex flex-wrap gap-1">
          {(field.options ?? []).map((option) => {
            const selectedToken = selectedValues.has(option.value)
            return (
              <button
                key={option.value}
                type="button"
                disabled={field.readonly}
                onClick={() => {
                  const next = new Set(selectedValues)
                  if (next.has(option.value)) next.delete(option.value)
                  else next.add(option.value)
                  updateParameterField(field, Array.from(next))
                }}
                className={cn(
                  "h-6 rounded-[2px] border px-2 font-mono text-[10px] transition-colors disabled:pointer-events-none disabled:opacity-60",
                  selectedToken
                    ? "border-[#8694a5] bg-[#2b3138] text-foreground"
                    : "border-[#2c3036] bg-[#07080a] text-muted-foreground hover:border-[#4a515c] hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>,
      )
    }

    if (field.type === "slider") {
      const value = typeof raw === "number" ? raw : Number(raw ?? field.min ?? 0)
      const safeValue = Number.isFinite(value) ? value : field.min ?? 0
      return row(
        <div className="flex h-7 items-center gap-2">
          <div className="min-w-0 flex-1">
            <input
              id={fieldId}
              type="range"
              min={field.min ?? 0}
              max={field.max ?? 1}
              step={field.step ?? 0.01}
              value={safeValue}
              disabled={field.readonly}
              onChange={(e) => updateParameterField(field, Number(e.target.value))}
              className="houdini-range w-full disabled:opacity-60"
            />
          </div>
          <Input
            type="number"
            min={field.min ?? 0}
            max={field.max ?? 1}
            step={field.step ?? 0.01}
            value={safeValue}
            readOnly={field.readonly}
            onChange={(e) => updateParameterField(field, Number(e.target.value))}
            className={cn(houdiniInputClass, "h-7 w-[4.25rem] px-1.5 text-right")}
            aria-label={`${field.label} numeric value`}
          />
        </div>,
        "items-center",
      )
    }

    if (field.type === "number") {
      const value = typeof raw === "number" ? raw : Number(raw ?? 0)
      return row(
          <Input
            id={fieldId}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            readOnly={field.readonly}
            value={Number.isFinite(value) ? value : 0}
            onChange={(e) => updateParameterField(field, Number(e.target.value))}
            className={houdiniInputClass}
          />,
      )
    }

    return row(
        <Input
          id={fieldId}
          value={typeof raw === "string" || typeof raw === "number" ? String(raw) : ""}
          placeholder={field.placeholder}
          readOnly={field.readonly}
          onChange={(e) => updateParameterField(field, e.target.value)}
          className={houdiniInputClass}
        />,
    )
  }

  const isCondition = data.nodeType === "condition"
  const ports = nodeViewContract.ports.map((port) => ({
    name: port.id,
    dir: port.direction,
    type: port.type,
    description: port.description,
  }))
  const parameterGroups = parameterInterfaceView?.groups ?? []
  const activeParameterGroupId = parameterGroups.some((group) => group.id === parameterGroupTab)
    ? parameterGroupTab
    : parameterGroups[0]?.id
  const activeParameterFields = parameterInterfaceView?.fields.filter((field) => field.groupId === activeParameterGroupId) ?? []
  const blockedAction = blockedActionViewForRuntime(data)
  return (
    <PanelShell
      title={data.label}
      typeLine={`${nodeViewContract.identity.kind}::${nodeViewContract.identity.capability}`.toUpperCase() + " · V1.0"}
      status={data.status}
      onClose={deselectAll}
    >
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-4 overflow-hidden rounded-[3px] border border-[#20242a] bg-[#171a1f] font-mono text-[10px] uppercase">
          {(["config", "prompt", "run", "trace"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                if (tab === "prompt" && !promptCapable) return
                setNodeTab(tab)
              }}
              className={cn(
                "border-r border-[#2b3037] px-2 py-2 transition-colors last:border-r-0",
                nodeTab === tab ? "bg-[#050607] text-foreground" : "text-muted-foreground hover:bg-[#252a31] hover:text-foreground",
                tab === "prompt" && !promptCapable && "opacity-40",
              )}
            >
              {tab === "config" ? "配置" : tab === "prompt" ? "提示词" : tab === "run" ? "运行结果" : "执行过程"}
            </button>
          ))}
        </div>

        {nodeTab === "prompt" ? (
          <div className="space-y-3">
            <SectionCaption>Prompt Playground</SectionCaption>
            <div className="rounded-md border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
              Prompt edits are staged through Agent proposal before they update the canonical workflow.
            </div>
            <MonoRow k="preset" v={String(canonical?.params?.style ?? data.fields?.find((field) => field.id === "preset")?.value ?? "macro-brief")} />
            <MonoRow k="version" v={String(canonical?.params?.promptVersion ?? data.fields?.find((field) => field.id === "version")?.value ?? "v1")} />
            <MonoRow k="model" v={String(canonical?.params?.model ?? data.fields?.find((field) => field.id === "model")?.value ?? "deepseek/mock")} />
            <Separator />
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Test Input</Label>
              <Textarea readOnly rows={3} className="font-mono text-xs" value="JIN10 macro news sample with policy/market impact." />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-[10px] uppercase tracking-wider">Mock Output</Label>
              <Textarea readOnly rows={4} className="font-mono text-xs" value="3-bullet macro brief, impact score, source refs, and risk note." />
            </div>
            <div className="rounded-md border bg-card p-3">
              <SectionCaption>Version Note</SectionCaption>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Baseline prompt version for deterministic local evaluation and regression gate.
              </p>
            </div>
          </div>
        ) : nodeTab === "run" ? (
          <div className="space-y-3">
            <SectionCaption>Run Result</SectionCaption>
            <div className="rounded-md border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
              Explicit run results live in Run Trace. This node is ready for deterministic simulation.
            </div>
            <MonoRow k="node" v={node.id} />
            {canonical?.capability ? <MonoRow k="capability" v={canonical.capability} /> : null}
            {canonical?.adapter ? <MonoRow k="adapter" v={canonical.adapter} /> : null}
            <MonoRow k="artifacts" v={nodeViewContract.outputs.artifacts.join(", ") || "none"} />
            <MonoRow k="batches" v={nodeViewContract.outputs.evidenceBatchCount} />
          </div>
        ) : nodeTab === "trace" ? (
          <div className="space-y-3">
            <SectionCaption>Trace</SectionCaption>
            <div className="rounded-md border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
              Open Run Trace, press Run, then inspect ordered node events by id.
            </div>
            <MonoRow k="profile" v={workflowProject.profile} />
            {canonical?.kind ? <MonoRow k="kind" v={canonical.kind} /> : null}
            <MonoRow k="events" v={nodeViewContract.trace.events.join(", ") || "none"} />
            {nodeViewContract.trace.runId ? <MonoRow k="run" v={nodeViewContract.trace.runId} /> : null}
            {nodeViewContract.trace.traceId ? <MonoRow k="trace" v={nodeViewContract.trace.traceId} /> : null}
          </div>
        ) : (
          <>
        {blockedAction ? (
          <div className="overflow-hidden rounded-[3px] border border-[#7f1d1d]/60 bg-[#180b0b]/70">
            <div className="flex items-center justify-between gap-3 border-b border-[#7f1d1d]/50 bg-[#2a1010]/72 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <AlertTriangle className="size-3.5 shrink-0 text-[#f87171]" />
                <SectionCaption>Blocked Action</SectionCaption>
              </div>
              <Link
                href={blockedAction.href}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[2px] border border-[#f87171]/35 bg-[#3a1515] px-2 font-mono text-[10px] uppercase tracking-[0.06em] text-[#fecaca] transition-colors hover:border-[#fecaca]/50 hover:bg-[#4a1717]"
              >
                <PlugZap className="size-3" />
                <span>{blockedAction.actionLabel}</span>
              </Link>
            </div>
            <div className="space-y-2 p-3">
              <p className="line-clamp-2 text-[11px] leading-relaxed text-[#fecaca]/85">{blockedAction.message}</p>
              {blockedAction.missingLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {blockedAction.missingLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-[2px] border border-[#7f1d1d]/60 bg-[#120707] px-2 py-1 font-mono text-[10px] text-[#fecaca]/75"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {parameterInterfaceView ? (
          <div className="overflow-hidden rounded-[3px] border border-[#20242a] bg-[#101216]/84">
            <div className="flex flex-wrap gap-0 border-b border-[#24282f] bg-[#1d2025] p-0 font-mono text-[10px] uppercase">
              {parameterGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setParameterGroupTab(group.id)}
                  className={cn(
                    "border-r border-[#2b3037] px-3 py-1.5 transition-colors",
                    activeParameterGroupId === group.id
                      ? "bg-[#07080a] text-foreground"
                      : "text-muted-foreground hover:bg-[#252a31] hover:text-foreground",
                  )}
                >
                  {group.label}
                </button>
              ))}
            </div>
            <div className="px-2 py-1">{activeParameterFields.map((field) => renderParameterField(field))}</div>
            {activeParameterFields.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-muted-foreground">No public parameters in this group.</p>
            ) : null}
          </div>
        ) : null}

        {nodeContract || data.runtimeContract ? (
          <details className={houdiniDetailsClass}>
            <summary className={houdiniSummaryClass}>
              <span>Contract</span>
              <span className="truncate text-[10px] normal-case tracking-normal">
                {data.runtimeContract?.bindingId ?? nodeContract?.dataModel}
              </span>
            </summary>
            <div className="space-y-3 border-t p-3">
              <div className="space-y-1">
                <h3 className="text-xs font-medium text-foreground">{nodeContract?.title ?? nodeViewContract.identity.label}</h3>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {data.runtimeContract?.status ?? nodeContract?.dataModel}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MonoRow k="ports" v={nodeViewContract.ports.length} />
                <MonoRow k="params" v={nodeViewContract.params.length} />
              </div>
              <Separator />
              <div className="space-y-1.5">
                {nodeViewContract.params.slice(0, 4).map((param) => (
                  <div key={param.id} className="flex items-center justify-between gap-2 font-mono text-[10px]">
                    <span className="truncate text-foreground">{param.id}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {param.type ?? "runtime"}{param.required ? " · required" : ""}
                    </span>
                  </div>
                ))}
              </div>
              {nodeContract?.assertions.length ? (
                <>
                  <Separator />
                  <div className="space-y-1">
                    {nodeContract.assertions.slice(0, 3).map((assertion) => (
                      <p key={assertion} className="line-clamp-1 text-[11px] text-muted-foreground">
                        {assertion}
                      </p>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </details>
        ) : null}

        {nodeInternals ? (
          <details className={houdiniDetailsClass}>
            <summary className={houdiniSummaryClass}>
              <span>Internals</span>
              <span className="text-[10px] normal-case tracking-normal">{nodeInternals.steps.length} steps</span>
            </summary>
            <div className="space-y-3 border-t p-3">
              <div className="space-y-1">
                <h3 className="text-xs font-medium text-foreground">{nodeInternals.title}</h3>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{nodeInternals.summary}</p>
              </div>
              <div className="space-y-2">
                {nodeInternals.steps.map((step, index) => (
                  <div key={step.id} className="rounded-[3px] border border-[#252a31] bg-[#090a0c]/70 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <p className="truncate text-xs font-medium text-foreground">{step.label}</p>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{step.description}</p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[9px]",
                          internalStatusClass[step.status],
                        )}
                      >
                        {internalStatusLabel[step.status]}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground/80">
                      <span>{step.capability}</span>
                      <span className="truncate">{step.evidence}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        ) : null}

        <details className={houdiniDetailsClass}>
          <summary className={houdiniSummaryClass}>
            <span>{nodeTemplate ? "Identity" : "Parameters"}</span>
            <span className="truncate text-[10px] normal-case tracking-normal">{data.label}</span>
          </summary>
          <div className="space-y-3 border-t p-3">
            <div className="space-y-1.5">
              <Label htmlFor="node-label" className="font-mono text-[10px] uppercase tracking-wider">
                Name
              </Label>
              <Input
                id="node-label"
                value={data.label}
                onFocus={takeSnapshot}
                onChange={(e) => update({ label: e.target.value })}
                className={houdiniInputClass}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="node-desc" className="font-mono text-[10px] uppercase tracking-wider">
                Description
              </Label>
              <Textarea
                id="node-desc"
                rows={3}
                value={data.description ?? ""}
                onFocus={takeSnapshot}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="添加描述..."
                className={houdiniTextareaClass}
              />
            </div>

            {isCondition ? (
              <div className="space-y-1.5">
                <Label htmlFor="node-cond" className="font-mono text-[10px] uppercase tracking-wider">
                  Expression
                </Label>
                <Textarea
                  id="node-cond"
                  rows={2}
                  className={houdiniTextareaClass}
                  value={data.condition ?? ""}
                  onFocus={takeSnapshot}
                  onChange={(e) => update({ condition: e.target.value })}
                />
              </div>
            ) : null}

            {!nodeTemplate && data.fields && data.fields.length > 0
              ? data.fields.map((f: FieldConfig) => (
                  <div key={f.id} className="space-y-1.5">
                    <Label
                      htmlFor={`field-${f.id}`}
                      className="font-mono text-[10px] uppercase tracking-wider"
                    >
                      {f.label}
                    </Label>
                    <Input
                      id={`field-${f.id}`}
                      value={f.value}
                      onFocus={takeSnapshot}
                      onChange={(e) => updateField(f.id, e.target.value)}
                      className={houdiniInputClass}
                    />
                  </div>
                ))
              : null}
          </div>
        </details>

        {data.nodeType !== "note" && data.nodeType !== "group" ? (
          <details className={houdiniDetailsClass}>
            <summary className={houdiniSummaryClass}>
              <span>Ports</span>
              <span className="text-[10px] normal-case tracking-normal">{ports.length} ports</span>
            </summary>
            <div className="space-y-1.5 border-t p-3">
              {ports.map((p) => (
                <div
                  key={`${p.dir}-${p.name}`}
                  className="flex items-center justify-between font-mono text-[11px]"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "size-1.5 rounded-[2px]",
                        p.dir === "input" ? "bg-[#a0c3ec]" : "bg-[#3a3d42]",
                      )}
                      aria-hidden
                    />
                    <span className="text-foreground">{p.name}</span>
                  </span>
                  <span className="text-muted-foreground/70">
                    {p.dir.toUpperCase()} · {p.type.toUpperCase()}
                  </span>
                </div>
              ))}
              {ports.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-[#f87171]">
                  No backend node I/O contract is projected for this node.
                </p>
              ) : null}
            </div>
          </details>
        ) : null}

        <details className={houdiniDetailsClass}>
          <summary className={houdiniSummaryClass}>
            <span>Debug</span>
            <span className="truncate text-[10px] normal-case tracking-normal">{node.id}</span>
          </summary>
          <div className="space-y-1.5 border-t p-3">
            <MonoRow k="id" v={node.id} />
            <MonoRow k="pos" v={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
            {node.parentId ? <MonoRow k="parent" v={node.parentId} /> : null}
          </div>
        </details>
          </>
        )}
      </div>
    </PanelShell>
  )
}
