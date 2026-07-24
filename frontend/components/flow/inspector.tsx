"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, Bot, CheckCircle2, Database, ExternalLink, Loader2, Plus, PlugZap, Trash2 } from "lucide-react"
import { useFlowStore } from "@/lib/flow/store"
import { useSources } from "@/lib/api/hooks"
import type {
  FieldConfig,
  GeneratedWorkflowEdgeMapping,
  WorkflowNodeData,
} from "@/lib/flow/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
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
import { businessNodeName } from "@/lib/workflow/business-node-experience"
import { buildCanonicalNodeViewContract } from "@/lib/workflow/canonical-node-contract"
import { findWorkflowProjectNodeByCanvasId } from "@/lib/workflow/node-path"
import { requestWorkflowNodeEditDraft, type WorkflowNodeEditDraft } from "@/lib/workflow/node-edit-draft"
import {
  isOpenCLISourceSlotArray,
  type OpenCLISourceSlot,
} from "@/lib/workflow/node-catalog"
import {
  openCLISlotFromDataSource,
  SOURCE_ARGUMENT_LABELS,
  SOURCE_MARKET_OPTIONS,
  sourceBusinessArguments,
  sourceBusinessQuery,
  sourceMarket,
  sourceSlotKey,
  updateSourceBusinessQuery,
  updateSourceMarket,
} from "@/lib/workflow/source-business-config"
import type {
  WorkflowCapability,
  WorkflowNodeKind,
  WorkflowProjectNode,
} from "@/lib/workflow/schema"
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

type NodeAiEditState =
  | { status: "idle"; result: null; error: null }
  | { status: "loading"; result: null; error: null }
  | { status: "ready"; result: WorkflowNodeEditDraft; error: null }
  | { status: "error"; result: null; error: string }

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

function nodeParameterDisplayValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

export function Inspector() {
  const nodes = useFlowStore((s) => s.nodes)
  const edges = useFlowStore((s) => s.edges)
  const workflowProject = useFlowStore((s) => s.workflowProject)
  const networkStackLength = useFlowStore((s) => s.networkStack.length)
  const updateNodeData = useFlowStore((s) => s.updateNodeData)
  const updateEdgeData = useFlowStore((s) => s.updateEdgeData)
  const updateEdgeType = useFlowStore((s) => s.updateEdgeType)
  const toggleEdgeAnimated = useFlowStore((s) => s.toggleEdgeAnimated)
  const updateWorkflowNodeParams = useFlowStore((s) => s.updateWorkflowNodeParams)
  const updateParameterInterfaceField = useFlowStore((s) => s.updateParameterInterfaceField)
  const importWorkflowProject = useFlowStore((s) => s.importWorkflowProject)
  const takeSnapshot = useFlowStore((s) => s.takeSnapshot)
  const setNodes = useFlowStore((s) => s.setNodes)
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange)
  const [nodeTab, setNodeTab] = useState<"config" | "prompt" | "run" | "trace">("config")
  const [parameterGroupTab, setParameterGroupTab] = useState("")
  const [aiEditMessage, setAiEditMessage] = useState("")
  const [aiEditState, setAiEditState] = useState<NodeAiEditState>({ status: "idle", result: null, error: null })

  const selected = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)
  const selectedNodeId = selected.length === 1 ? selected[0].id : null

  useEffect(() => {
    setAiEditMessage("")
    setAiEditState({ status: "idle", result: null, error: null })
  }, [selectedNodeId])

  const deselectAll = () => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
    onEdgesChange(edges.filter((e) => e.selected).map((e) => ({ id: e.id, type: "select" as const, selected: false })))
  }

  /* ---- edge parameter interface ---- */
  if (selected.length === 0 && selectedEdges.length === 1) {
    const edge = selectedEdges[0]
    const edgeType = edge.type ?? "workflow"
    const mapping: GeneratedWorkflowEdgeMapping = edge.data?.mapping ?? {
      mode: "auto",
      fields: [],
      preserveRaw: true,
      compatible: true,
      conflicts: [],
    }
    const updateMapping = (patch: Partial<GeneratedWorkflowEdgeMapping>) => {
      const nextFields = patch.fields ?? mapping.fields
      const structuralConflicts = nextFields.flatMap((field, index) => {
        if (!field.source.trim() || !field.target.trim()) {
          return [`映射 ${index + 1} 必须同时填写来源与目标字段。`]
        }
        return []
      })
      updateEdgeData(edge.id, {
        mapping: {
          ...mapping,
          ...patch,
          ...(patch.fields
            ? {
                compatible: structuralConflicts.length === 0,
                conflicts: structuralConflicts,
              }
            : {}),
          preserveRaw: true,
        },
      })
    }
    const updateMappingField = (
      index: number,
      patch: Partial<GeneratedWorkflowEdgeMapping["fields"][number]>,
    ) => {
      updateMapping({
        mode: "override",
        fields: mapping.fields.map((field, fieldIndex) =>
          fieldIndex === index ? { ...field, ...patch } : field,
        ),
      })
    }
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

          <div className="space-y-3 rounded-md border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionCaption>Field Mapping</SectionCaption>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  自动映射可改为人工覆盖；原始结构始终保留在 data.raw。
                </p>
              </div>
              <Select
                value={mapping.mode}
                onValueChange={(value) =>
                  value && updateMapping({ mode: value as GeneratedWorkflowEdgeMapping["mode"] })
                }
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  <SelectItem value="override">覆盖</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mapping.fields.map((field, index) => (
              <div key={index} className="space-y-2 rounded-md border bg-background p-2">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <Input
                    aria-label={`映射 ${index + 1} 来源字段`}
                    value={field.source}
                    onFocus={takeSnapshot}
                    onChange={(event) => updateMappingField(index, { source: event.target.value })}
                    placeholder="data.source"
                  />
                  <span className="font-mono text-xs text-muted-foreground">→</span>
                  <Input
                    aria-label={`映射 ${index + 1} 目标字段`}
                    value={field.target}
                    onFocus={takeSnapshot}
                    onChange={(event) => updateMappingField(index, { target: event.target.value })}
                    placeholder="data.target"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`映射 ${index + 1} 转换`}
                    value={field.transform ?? ""}
                    onFocus={takeSnapshot}
                    onChange={(event) => updateMappingField(index, { transform: event.target.value || undefined })}
                    placeholder="可选转换表达式"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => updateMapping({ mode: "override", fields: mapping.fields.filter((_, fieldIndex) => fieldIndex !== index) })}
                  >
                    移除
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => updateMapping({
                mode: "override",
                fields: [...mapping.fields, { source: "data.", target: "data." }],
              })}
            >
              添加字段映射
            </Button>

            <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="text-muted-foreground">兼容性</span>
              <span className={mapping.compatible ? "text-success" : "text-destructive"}>
                {mapping.compatible ? "可编译" : "阻止发布 / 运行"}
              </span>
            </div>
            {mapping.conflicts.map((conflict) => (
              <p key={conflict} className="text-[11px] leading-relaxed text-destructive">
                {conflict}
              </p>
            ))}
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
    findWorkflowProjectNodeByCanvasId(workflowProject, node.id),
    data,
  )
  const implementationNode = findImplementationNode(projectNode)
  const configurationNode = implementationNode ?? projectNode
  const configurationNodeId = implementationNode
    ? `${node.id}__${implementationNode.id}`
    : node.id
  const projectAdapter = configurationNode?.adapter
    ? workflowProject.adapters.find((candidate) => candidate.id === configurationNode.adapter)
    : undefined
  const nodeTemplate = getNodeTemplate(configurationNode)
  const nodeViewContract = buildCanonicalNodeViewContract(projectNode, data, node.id)
  const isBusinessLevel = networkStackLength === 0
  const businessLabel = businessNodeName({
    label: data.label,
    kind: nodeViewContract.identity.kind as WorkflowNodeKind,
    capability: nodeViewContract.identity.capability as WorkflowCapability,
    params: configurationNode?.params ?? canonical?.params,
  })
  const parameterInterfaceView = buildParameterInterfaceView({
    node: configurationNode,
    adapter: projectAdapter,
    nodes,
    allowedParamIds: implementationNode
      ? undefined
      : nodeViewContract.params.map((param) => param.id),
  })
  const nodeInternals = nodeViewContract.internals
  const nodeContract = nodeViewContract.staticContract
  const promptCapable =
    canonical?.kind === "agent" ||
    typeof data.primitiveId === "string" && (data.primitiveId.includes("prompt") || data.primitiveId.includes("model"))
  const promptParameter = (id: string) =>
    projectNode?.params[id] ?? canonical?.params?.[id] ?? data.fields?.find((field) => field.id === id)?.value
  const promptConfiguration: Array<{ key: string; value: string }> = [
    { key: "preset", value: promptParameter("style") },
    { key: "version", value: promptParameter("promptVersion") ?? promptParameter("version") },
    { key: "model", value: promptParameter("model") },
  ].flatMap(({ key, value }) => {
    const displayValue = nodeParameterDisplayValue(value)
    return displayValue ? [{ key, value: displayValue }] : []
  })
  const configuredPrompt = nodeParameterDisplayValue(promptParameter("prompt") ?? promptParameter("systemPrompt"))
  const testInput = nodeParameterDisplayValue(promptParameter("input"))
  const expectedOutput = nodeParameterDisplayValue(promptParameter("expected"))

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
          updateWorkflowNodeParams(configurationNodeId, {}, { mode: value as never })
          return
        }
        updateWorkflowNodeParams(configurationNodeId, {}, { config: { [field.binding.fieldId]: value } })
        return
      }
      if (field.binding.source === "data") {
        update({ [field.binding.fieldId]: value } as Partial<WorkflowNodeData>)
        return
      }
      updateWorkflowNodeParams(configurationNodeId, { [field.binding.fieldId]: value })
      return
    }
    updateParameterInterfaceField(configurationNodeId, field.id, value)
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
  const requestAiEdit = async () => {
    const message = aiEditMessage.trim()
    if (!message) return
    setAiEditState({ status: "loading", result: null, error: null })
    try {
      const result = await requestWorkflowNodeEditDraft(workflowProject, node.id.replaceAll("__", "::"), message)
      setAiEditState({ status: "ready", result, error: null })
    } catch (error) {
      setAiEditState({ status: "error", result: null, error: error instanceof Error ? error.message : "节点 AI 编辑失败" })
    }
  }
  const applyAiEdit = () => {
    const project = aiEditState.status === "ready" ? aiEditState.result.patch?.project : null
    if (!project) return
    importWorkflowProject(project)
    setAiEditState({ status: "idle", result: null, error: null })
    setAiEditMessage("")
  }
  const openCLISources = isOpenCLISourceSlotArray(configurationNode?.params.sources)
    ? configurationNode.params.sources
    : undefined
  return (
    <PanelShell
      title={isBusinessLevel ? businessLabel : data.label}
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
            <SectionCaption>节点提示词配置</SectionCaption>
            <div className="rounded-md border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
              这里只显示节点已保存的提示词配置和测试用例，不会注入演示文本。通过 AI 编辑生成的是待审阅提案，确认应用后才会更新工作流。
            </div>
            {promptConfiguration.map(({ key, value }) => <MonoRow key={key} k={key} v={value} />)}
            {configuredPrompt ? (
              <div className="space-y-1.5">
                <Label className="font-mono text-[10px] uppercase tracking-wider">已配置提示词</Label>
                <Textarea readOnly rows={4} className="font-mono text-xs" value={configuredPrompt} />
              </div>
            ) : null}
            {testInput || expectedOutput ? <Separator /> : null}
            {testInput ? (
              <div className="space-y-1.5">
                <Label className="font-mono text-[10px] uppercase tracking-wider">测试输入</Label>
                <Textarea readOnly rows={3} className="font-mono text-xs" value={testInput} />
              </div>
            ) : null}
            {expectedOutput ? (
              <div className="space-y-1.5">
                <Label className="font-mono text-[10px] uppercase tracking-wider">期望输出</Label>
                <Textarea readOnly rows={4} className="font-mono text-xs" value={expectedOutput} />
              </div>
            ) : null}
            {!configuredPrompt && !testInput && !expectedOutput ? (
              <div className="rounded-md border border-dashed bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
                当前节点未配置提示词测试用例。真实运行输入和输出只在执行时产生，请在“运行结果”或 Run Trace 中查看。
              </div>
            ) : null}
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
        <section className="overflow-hidden rounded-[3px] border border-[#2f4055] bg-[#0b121c]" aria-label="与 AI 对话编辑节点">
          <div className="flex items-center gap-2 border-b border-[#26394d] bg-[#101b29] px-3 py-2">
            <Bot className="size-3.5 text-[#a0c3ec]" />
            <SectionCaption>与 AI 对话编辑此节点</SectionCaption>
          </div>
          <div className="space-y-2.5 p-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">基于已绑定的对话模型生成参数变更提案；不会自动保存，需先审阅再应用。</p>
            <Textarea
              value={aiEditMessage}
              onChange={(event) => setAiEditMessage(event.target.value)}
              rows={3}
              placeholder="例如：把最大条数改为 50，并保留来源引用"
              className={houdiniTextareaClass}
              aria-label="告诉 AI 如何编辑当前节点"
            />
            <Button type="button" size="sm" className="w-full" onClick={() => void requestAiEdit()} disabled={!aiEditMessage.trim() || aiEditState.status === "loading"}>
              {aiEditState.status === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
              生成编辑提案
            </Button>
            {aiEditState.status === "error" ? <p className="text-[11px] leading-relaxed text-destructive">{aiEditState.error}</p> : null}
            {aiEditState.status === "ready" ? (
              <div className="space-y-2 rounded-[2px] border border-[#314864] bg-[#0a1018] p-2.5">
                <p className="text-[11px] leading-relaxed text-foreground">{aiEditState.result.reply}</p>
                {aiEditState.result.patch?.patch.operations.length ? (
                  <>
                    <p className="font-mono text-[10px] text-muted-foreground">{aiEditState.result.patch.patch.operations.length} 项参数变更 · {aiEditState.result.patch.valid ? "已通过校验" : "未通过校验"}</p>
                    {aiEditState.result.patch.valid && aiEditState.result.patch.project ? (
                      <Button type="button" size="sm" variant="outline" className="w-full" onClick={applyAiEdit}>
                        <CheckCircle2 className="size-3.5" />应用到草稿
                      </Button>
                    ) : null}
                  </>
                ) : <p className="font-mono text-[10px] text-muted-foreground">未生成可安全应用的参数变更。</p>}
              </div>
            ) : null}
          </div>
        </section>
        <section className="space-y-3 rounded-[3px] border border-[#20242a] bg-[#101216]/84 p-3">
          <div>
            <SectionCaption>业务配置</SectionCaption>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              名称和说明会直接显示在画布节点上。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-label" className="font-mono text-[10px] uppercase tracking-wider">
              节点名称
            </Label>
            <Input
              id="node-label"
              value={isBusinessLevel ? businessLabel : data.label}
              onFocus={takeSnapshot}
              onChange={(event) => update({ label: event.target.value })}
              placeholder="例如：采集 A 股市场数据"
              className={houdiniInputClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="node-desc" className="font-mono text-[10px] uppercase tracking-wider">
              节点说明
            </Label>
            <Textarea
              id="node-desc"
              rows={2}
              value={data.description ?? ""}
              onFocus={takeSnapshot}
              onChange={(event) => update({ description: event.target.value })}
              placeholder="说明这个节点为业务流程完成什么"
              className={houdiniTextareaClass}
            />
          </div>
        </section>

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

        {openCLISources ? (
          <OpenCLISourceEditor
            sources={openCLISources}
            onChange={(sources) => updateWorkflowNodeParams(configurationNodeId, { sources })}
          />
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

        {isCondition || (!nodeTemplate && data.fields && data.fields.length > 0) ? (
          <details className={houdiniDetailsClass}>
            <summary className={houdiniSummaryClass}>
              <span>高级设置</span>
              <span className="truncate text-[10px] normal-case tracking-normal">{data.label}</span>
            </summary>
            <div className="space-y-3 border-t p-3">
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
        ) : null}

        {data.nodeType !== "note" && data.nodeType !== "group" ? (
          <details className={houdiniDetailsClass}>
            <summary className={houdiniSummaryClass}>
              <span>接口</span>
              <span className="text-[10px] normal-case tracking-normal">
                {ports.filter((port) => port.dir === "input").length} IN · {ports.filter((port) => port.dir === "output").length} OUT
              </span>
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

function findImplementationNode(node: WorkflowProjectNode | undefined): WorkflowProjectNode | undefined {
  if (!node) return undefined
  const operator = node.params.operator
  if (!operator || typeof operator !== "object" || Array.isArray(operator)) return undefined
  const implementationNodeId = (operator as Record<string, unknown>).implementationNodeId
  if (typeof implementationNodeId !== "string") return undefined
  return (node.internals?.nodes ?? []).find((candidate): candidate is WorkflowProjectNode => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false
    return (candidate as { id?: unknown }).id === implementationNodeId
  })
}

function OpenCLISourceEditor({
  sources,
  onChange,
}: {
  sources: OpenCLISourceSlot[]
  onChange: (sources: OpenCLISourceSlot[]) => void
}) {
  const sourceCatalog = useSources({ enabled: true, limit: 100 })
  const registeredSources = (sourceCatalog.data?.data ?? [])
    .map(openCLISlotFromDataSource)
    .filter((source): source is OpenCLISourceSlot => Boolean(source))
  const selectedSourceKeys = new Set(sources.map(sourceSlotKey))
  const availableSources = registeredSources.filter((source) => !selectedSourceKeys.has(sourceSlotKey(source)))
  const businessQuery = sourceBusinessQuery(sources)
  const market = sourceMarket(sources)

  const updateSource = (index: number, patch: Partial<OpenCLISourceSlot>) => {
    onChange(sources.map((source, sourceIndex) => (
      sourceIndex === index ? { ...source, ...patch } : source
    )))
  }

  const addSource = (sourceId: string | null) => {
    const source = availableSources.find((candidate) => candidate.id === sourceId)
    if (!source) return
    onChange([...sources, source])
  }

  return (
    <section className="overflow-hidden rounded-[3px] border border-[#20242a] bg-[#101216]/84">
      <div className="space-y-3 border-b border-[#24282f] bg-[#171a1f] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionCaption>数据来源</SectionCaption>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              选择系统中已经连接的数据源，执行时自动并行采集。
            </p>
          </div>
          <Link
            href="/sources"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[2px] border border-[#343a43] px-2 text-[10px] text-muted-foreground transition-colors hover:border-[#5f6976] hover:text-foreground"
          >
            管理数据源
            <ExternalLink className="size-3" />
          </Link>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[3px] border border-[#2a2f36] bg-[#0b0d10] px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-[2px] bg-[#ff7a17]/12 text-[#ff9a4a]">
              <Database className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">{sources.length} 个来源</p>
              <p className="truncate text-[10px] text-muted-foreground">智能多源 · 并行执行</p>
            </div>
          </div>
          <Select onValueChange={addSource} disabled={sourceCatalog.isLoading || availableSources.length === 0}>
            <SelectTrigger
              aria-label="添加已连接的数据源"
              className="h-7 w-auto min-w-28 rounded-[2px] border-[#343a43] bg-[#111317] px-2 text-[11px] shadow-none focus:ring-0"
            >
              <Plus className="size-3" />
              <SelectValue placeholder={sourceCatalog.isLoading ? "加载中" : "添加数据源"} />
            </SelectTrigger>
            <SelectContent>
              {availableSources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sourceCatalog.isError ? (
          <p className="text-[10px] leading-relaxed text-[#fca5a5]">
            数据源目录暂时不可用。现有配置仍可使用，连接后端后即可选择其他来源。
          </p>
        ) : !sourceCatalog.isLoading && registeredSources.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            当前节点已有 {sources.length} 个来源；全局目录中暂无其他已连接的 OpenCLI 数据源。
          </p>
        ) : !sourceCatalog.isLoading && availableSources.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            所有已连接的 OpenCLI 数据源都已添加到当前节点。
          </p>
        ) : null}
      </div>

      {businessQuery !== undefined || market !== undefined ? (
        <div className="grid gap-3 border-b border-[#24282f] bg-[#0d0f12] p-3">
          {businessQuery !== undefined ? (
            <div className="space-y-1.5">
              <Label htmlFor="source-business-query" className="text-[11px] font-medium text-foreground">
                采集主题
              </Label>
              <Input
                id="source-business-query"
                value={businessQuery}
                onChange={(event) => onChange(updateSourceBusinessQuery(sources, event.target.value))}
                placeholder="例如：人工智能、贵州茅台"
                className="h-8 rounded-[3px] border-[#303640] bg-[#080a0c] text-xs focus-visible:ring-0"
              />
              <p className="text-[10px] text-muted-foreground">一次设置会同步到所有搜索型来源。</p>
            </div>
          ) : null}
          {market !== undefined ? (
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-foreground">市场范围</Label>
              <Select value={market} onValueChange={(value) => value && onChange(updateSourceMarket(sources, value))}>
                <SelectTrigger className="h-8 rounded-[3px] border-[#303640] bg-[#080a0c] text-xs focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!SOURCE_MARKET_OPTIONS.some((option) => option.value === market) ? (
                    <SelectItem value={market}>{market}</SelectItem>
                  ) : null}
                  {SOURCE_MARKET_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 p-2">
        {sources.map((source, index) => {
          const businessArguments = sourceBusinessArguments(source)
          return (
            <div key={source.id} className="rounded-[3px] border border-[#252a31] bg-[#090a0c]/70">
              <div className="flex items-center gap-2 p-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[3px] border border-[#343a43] bg-[#15181d] font-mono text-[11px] font-semibold uppercase text-[#ff9a4a]">
                  {source.site.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{source.label}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {source.site} · {source.sourceGroup || "数据采集"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`移除来源 ${source.label}`}
                  disabled={sources.length <= 1}
                  onClick={() => onChange(sources.filter((_, sourceIndex) => sourceIndex !== index))}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-[2px] border border-[#2c3036] text-muted-foreground transition-colors hover:border-[#7f1d1d] hover:text-[#f87171] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              {businessArguments.length > 0 ? (
                <details className="border-t border-[#20242a]">
                  <summary className="cursor-pointer list-none px-2.5 py-2 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                    采集选项 · {businessArguments.length} 项
                  </summary>
                  <div className="grid gap-2 border-t border-[#20242a] p-2.5">
                    {businessArguments.map(([key, value]) => (
                      <SourceBusinessArgument
                        key={key}
                        argumentKey={key}
                        value={value}
                        onChange={(nextValue) => updateSource(index, { args: { ...source.args, [key]: nextValue } })}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          )
        })}
      </div>

      <details className="border-t border-[#24282f] bg-[#111317]/74">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground">
          <span>高级设置</span>
          <span className="normal-case tracking-normal">OpenCLI 映射</span>
        </summary>
        <div className="space-y-2 border-t border-[#24282f] p-2">
          {sources.map((source, index) => (
            <div key={source.id} className="space-y-2 rounded-[3px] border border-[#252a31] bg-[#090a0c]/70 p-2.5">
              <Input
                aria-label={`来源 ${index + 1} 名称`}
                value={source.label}
                onChange={(event) => updateSource(index, { label: event.target.value })}
                className={houdiniInputClass}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">站点</Label>
                  <Input
                    aria-label={`来源 ${index + 1} 站点`}
                    value={source.site}
                    onChange={(event) => updateSource(index, { site: event.target.value })}
                    className={houdiniInputClass}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">命令</Label>
                  <Input
                    aria-label={`来源 ${index + 1} 命令`}
                    value={source.command}
                    onChange={(event) => updateSource(index, { command: event.target.value })}
                    className={houdiniInputClass}
                  />
                </div>
              </div>
              <SourceArgsEditor
                sourceId={source.id}
                value={source.args}
                onCommit={(args) => updateSource(index, { args })}
              />
            </div>
          ))}
        </div>
      </details>
      <div className="border-t border-[#24282f] bg-[#0d0f12] px-3 py-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          配置会自动保存。使用画布顶部“试运行”检查真实返回和数据新鲜度。
        </p>
      </div>
    </section>
  )
}

function SourceBusinessArgument({
  argumentKey,
  value,
  onChange,
}: {
  argumentKey: string
  value: string | number | boolean
  onChange: (value: string | number | boolean) => void
}) {
  const label = SOURCE_ARGUMENT_LABELS[argumentKey] ?? argumentKey
  if (typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[3px] border border-[#252a31] bg-[#0d0f12] px-2.5 py-2">
        <Label className="text-[11px] text-foreground">{label}</Label>
        <Switch checked={value} onCheckedChange={onChange} aria-label={label} />
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type={typeof value === "number" ? "number" : "text"}
        value={value}
        onChange={(event) => onChange(typeof value === "number" ? Number(event.target.value) : event.target.value)}
        className="h-7 rounded-[2px] border-[#2c3036] bg-[#07080a] px-2 text-[11px] focus-visible:ring-0"
      />
    </div>
  )
}

function SourceArgsEditor({
  sourceId,
  value,
  onCommit,
}: {
  sourceId: string
  value: Record<string, unknown>
  onCommit: (value: Record<string, unknown>) => void
}) {
  const serialized = JSON.stringify(value, null, 2)
  const [draft, setDraft] = useState(serialized)
  const [error, setError] = useState("")

  useEffect(() => {
    setDraft(serialized)
    setError("")
  }, [serialized])

  const commit = () => {
    try {
      const parsed = JSON.parse(draft) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("参数必须是 JSON 对象")
        return
      }
      setError("")
      onCommit(parsed as Record<string, unknown>)
    } catch {
      setError("JSON 格式不正确")
    }
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={`source-args-${sourceId}`} className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        参数
      </Label>
      <Textarea
        id={`source-args-${sourceId}`}
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className={cn(houdiniTextareaClass, error && "border-[#7f1d1d]")}
      />
      {error ? <p className="text-[10px] text-[#f87171]">{error}</p> : null}
    </div>
  )
}
