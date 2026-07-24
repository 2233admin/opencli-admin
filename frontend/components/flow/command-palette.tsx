"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReactFlow } from "@xyflow/react"
import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  FileUp,
  Globe,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Sparkles,
} from "lucide-react"

import { NODE_PALETTE } from "@/lib/flow/palette"
import { getIcon } from "@/lib/flow/icons"
import { generateWorkflowLocally } from "@/lib/flow/local-generate"
import { useSettingsStore } from "@/lib/flow/settings-store"
import { useFlowStore } from "@/lib/flow/store"
import type { PaletteItem } from "@/lib/flow/types"
import {
  featuredOpenCLIAdapterNodes,
  fetchWorkflowOpenCLIAdapterNodes,
  openCLIAdapterNodePresentation,
  workflowCatalogItemForOpenCLIAdapterNode,
  type WorkflowOpenCLIAdapterNode,
} from "@/lib/workflow/backend-opencli-adapter-nodes"
import { primitiveRuntimeCapability, runtimeStatusLabel, runtimeStatusTone } from "@/lib/workflow/capabilities"
import {
  getWorkflowNodeCatalog,
  workflowCatalogIsBackendNode,
  workflowCatalogItemLocked,
  workflowCatalogPluginProvenance,
  type WorkflowNodeCatalogItem,
} from "@/lib/workflow/node-catalog"
import { workflowNodeDepthFromNetworkStack, workflowNodeLayerAtDepth } from "@/lib/workflow/node-hierarchy"
import { localizeNodeText } from "@/lib/workflow/node-i18n"
import { groupPrimitivesForNodeMenu } from "@/lib/workflow/node-menu"
import { getWorkflowPrimitives, type WorkflowPrimitive } from "@/lib/workflow/node-primitives"
import { useWorkflowCapabilities } from "@/lib/workflow/use-workflow-capabilities"
import { cn } from "@/lib/utils"

const AI_EXAMPLES = [
  "用户注册后发送欢迎邮件，24 小时后如果未激活则再次提醒",
  "监听订单创建事件，校验库存，扣减库存并通知仓库发货",
  "收到客服工单，判断优先级，高优先级转人工，其余自动回复",
]

const CATEGORY_LABELS: Record<string, string> = {
  package: "业务能力包",
  trigger: "触发与开始",
  source: "数据来源",
  transform: "处理与转换",
  decision: "逻辑与判断",
  action: "动作",
  output: "输出",
  annotation: "注释与辅助",
  shape: "流程图形",
}

type PickerTab = "nodes" | "tools" | "start"
type ToolFilter = "all" | "opencli" | "plugin"

const TAB_META: { id: PickerTab; label: string }[] = [
  { id: "nodes", label: "节点" },
  { id: "tools", label: "工具" },
  { id: "start", label: "开始" },
]

function PickerRow({
  icon: Icon,
  label,
  description,
  trailing,
  onClick,
  disabled,
}: {
  icon: ReturnType<typeof getIcon>
  label: string
  description?: string
  trailing?: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {description ? <span className="block truncate text-[11px] text-muted-foreground">{description}</span> : null}
      </span>
      {trailing ?? <ChevronRight className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />}
    </button>
  )
}

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1 pt-4 text-xs font-medium text-muted-foreground">
      <span>{children}</span>
      {typeof count === "number" ? <span className="font-mono text-[10px]">{count}</span> : null}
    </div>
  )
}

export function CommandPalette({
  open,
  onClose,
  onMessage,
  getAnchor,
  initialTab = "nodes",
  onImportApp,
}: {
  open: boolean
  onClose: () => void
  onMessage?: (msg: string) => void
  getAnchor?: () => { x: number; y: number }
  initialTab?: PickerTab
  onImportApp?: () => void
}) {
  const [activeTab, setActiveTab] = useState<PickerTab>(initialTab)
  const [toolFilter, setToolFilter] = useState<ToolFilter>("all")
  const [query, setQuery] = useState("")
  const [aiMode, setAiMode] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [opencliLoading, setOpencliLoading] = useState(false)
  const [opencliNodes, setOpencliNodes] = useState<WorkflowOpenCLIAdapterNode[]>([])
  const [selectedOpenCLI, setSelectedOpenCLI] = useState<WorkflowOpenCLIAdapterNode | null>(null)
  const [requiredValues, setRequiredValues] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const aiRef = useRef<HTMLTextAreaElement>(null)

  const { screenToFlowPosition } = useReactFlow()
  const addNodeFromPalette = useFlowStore((state) => state.addNodeFromPalette)
  const addPrimitiveNode = useFlowStore((state) => state.addPrimitiveNode)
  const addWorkflowNodeFromCatalog = useFlowStore((state) => state.addWorkflowNodeFromCatalog)
  const applyGeneratedWorkflow = useFlowStore((state) => state.applyGeneratedWorkflow)
  const autoLayout = useFlowStore((state) => state.autoLayout)
  const save = useFlowStore((state) => state.save)
  const reset = useFlowStore((state) => state.reset)
  const workflowProfile = useFlowStore((state) => state.workflowProject.profile)
  const networkStackLength = useFlowStore((state) => state.networkStack.length)
  const inNodeNetwork = networkStackLength > 0
  const nodeDepth = workflowNodeDepthFromNetworkStack(networkStackLength)
  const nodeLayer = workflowNodeLayerAtDepth(nodeDepth)
  const language = useSettingsStore((state) => state.language)
  const { capabilities } = useWorkflowCapabilities(open)

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
    setToolFilter("all")
    setQuery("")
    setAiMode(false)
    setAiPrompt("")
    setSelectedOpenCLI(null)
    setRequiredValues({})
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [initialTab, open])

  useEffect(() => {
    if (!open || opencliNodes.length || opencliLoading) return
    setOpencliLoading(true)
    void fetchWorkflowOpenCLIAdapterNodes({ includeWrite: false, limit: 5000 })
      .then((result) => setOpencliNodes(result.nodes))
      .finally(() => setOpencliLoading(false))
  }, [open, opencliLoading, opencliNodes.length])

  useEffect(() => {
    if (aiMode) requestAnimationFrame(() => aiRef.current?.focus())
  }, [aiMode])

  const close = useCallback(() => {
    if (!loading) onClose()
  }, [loading, onClose])

  const anchorPosition = useCallback(
    () => getAnchor?.() ?? screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    [getAnchor, screenToFlowPosition],
  )

  const addOperator = useCallback(
    (item: PaletteItem) => {
      addNodeFromPalette(item, anchorPosition())
      onMessage?.(`已添加：${item.label}`)
      onClose()
    },
    [addNodeFromPalette, anchorPosition, onClose, onMessage],
  )

  const addCatalogOperator = useCallback(
    (item: WorkflowNodeCatalogItem) => {
      if (workflowCatalogItemLocked(item)) {
        onMessage?.(item.runtimeCapability?.reason ?? "该插件能力尚未绑定运行适配器")
        return
      }
      addWorkflowNodeFromCatalog(item, anchorPosition())
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      onMessage?.(`已添加业务节点：${text.label}`)
      onClose()
    },
    [addWorkflowNodeFromCatalog, anchorPosition, language, onClose, onMessage],
  )

  const addPrimitive = useCallback(
    (item: WorkflowPrimitive) => {
      addPrimitiveNode(item, anchorPosition(), primitiveRuntimeCapability(capabilities, item.id))
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      onMessage?.(`已添加执行节点：${text.label}`)
      onClose()
    },
    [addPrimitiveNode, anchorPosition, capabilities, language, onClose, onMessage],
  )

  const addOpenCLIAdapter = useCallback(
    (item: WorkflowOpenCLIAdapterNode, values: Record<string, string> = {}) => {
      if (item.requiredArgs.some((name) => !values[name]?.trim())) {
        setSelectedOpenCLI(item)
        setRequiredValues(values)
        return
      }
      addWorkflowNodeFromCatalog(workflowCatalogItemForOpenCLIAdapterNode(item, values), anchorPosition())
      onMessage?.(`已添加实时 OpenCLI 数据源：${openCLIAdapterNodePresentation(item).label}`)
      onClose()
    },
    [addWorkflowNodeFromCatalog, anchorPosition, onClose, onMessage],
  )

  const generate = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return
      setLoading(true)
      try {
        const response = await fetch("/api/generate-workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.detail ?? "failed")
        applyGeneratedWorkflow(data)
        onMessage?.(`已生成工作流：${data.title ?? "未命名"}`)
      } catch {
        const spec = generateWorkflowLocally(text)
        applyGeneratedWorkflow(spec)
        onMessage?.(`已生成工作流（本地引擎）：${spec.title}`)
      } finally {
        setLoading(false)
        onClose()
      }
    },
    [applyGeneratedWorkflow, loading, onClose, onMessage],
  )

  const queryText = query.trim().toLowerCase()
  const catalogOperators = inNodeNetwork
    ? []
    : getWorkflowNodeCatalog(workflowProfile, capabilities).filter(
        (item) => item.category === "package" || workflowCatalogIsBackendNode(item) || workflowCatalogPluginProvenance(item) !== null,
      )
  const matchesCatalog = (item: WorkflowNodeCatalogItem) => {
    if (!queryText) return true
    const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
    return `${item.label} ${text.label} ${text.description ?? ""} ${item.kind} ${item.capability} ${item.keywords.join(" ")}`
      .toLowerCase()
      .includes(queryText)
  }
  const nodeCatalogGroups = useMemo(() => {
    const groups = new Map<string, WorkflowNodeCatalogItem[]>()
    for (const item of catalogOperators.filter((item) => workflowCatalogPluginProvenance(item) === null && matchesCatalog(item))) {
      const current = groups.get(item.category) ?? []
      current.push(item)
      groups.set(item.category, current)
    }
    return [...groups.entries()]
    // catalogOperators and matchesCatalog are derived from current render inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilities, inNodeNetwork, language, queryText, workflowProfile])
  const primitiveGroups = groupPrimitivesForNodeMenu(
    (inNodeNetwork ? getWorkflowPrimitives() : []).filter((item) => {
      if (!queryText) return true
      const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language)
      return `${item.label} ${text.label} ${text.description ?? ""} ${item.category} ${item.keywords.join(" ")}`.toLowerCase().includes(queryText)
    }),
  )
  const auxiliaryOperators = NODE_PALETTE.filter((item) => item.category === "annotation" || item.category === "shape").filter(
    (item) => !queryText || `${item.label} ${item.description} ${item.nodeType}`.toLowerCase().includes(queryText),
  )
  const matchesOpenCLI = (item: WorkflowOpenCLIAdapterNode) => {
    const presentation = openCLIAdapterNodePresentation(item)
    return !queryText || `${presentation.label} ${presentation.description} ${item.site} ${item.command}`.toLowerCase().includes(queryText)
  }
  const commonOpenCLINodes = featuredOpenCLIAdapterNodes(opencliNodes).filter(matchesOpenCLI)
  const filteredOpenCLINodes = (() => {
    const matching = opencliNodes.filter(matchesOpenCLI)
    if (queryText) return matching.slice(0, 100)
    const commonIds = new Set(commonOpenCLINodes.map((item) => item.id))
    return [...commonOpenCLINodes, ...matching.filter((item) => !commonIds.has(item.id))].slice(0, 18)
  })()
  const pluginTools = catalogOperators.filter(
    (item) => matchesCatalog(item) && workflowCatalogPluginProvenance(item) !== null,
  )

  const firstNode = nodeCatalogGroups[0]?.[1][0]
  const firstPrimitive = primitiveGroups[0]?.items[0]
  const firstAuxiliary = auxiliaryOperators[0]

  if (!open) return null

  if (selectedOpenCLI) {
    const missingRequired = selectedOpenCLI.requiredArgs.filter((name) => !requiredValues[name]?.trim())
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 px-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="配置 OpenCLI 数据源">
        <form className="w-[34rem] overflow-hidden rounded-lg border bg-popover shadow-2xl" onSubmit={(event) => { event.preventDefault(); addOpenCLIAdapter(selectedOpenCLI, requiredValues) }}>
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <button type="button" className="grid size-9 place-items-center rounded-md hover:bg-accent" onClick={() => setSelectedOpenCLI(null)} aria-label="返回工具列表"><ArrowLeft className="size-4" /></button>
            <div className="min-w-0"><div className="truncate text-sm font-medium">{selectedOpenCLI.label}</div><div className="truncate text-xs text-muted-foreground">配置必填参数后加入画布</div></div>
          </div>
          <div className="grid max-h-[52vh] gap-3 overflow-y-auto p-4">
            {selectedOpenCLI.args.filter((arg) => arg.required).map((arg) => (
              <label key={arg.name} className="grid gap-1.5 text-xs"><span>{arg.name}<span className="ml-1 text-destructive">*</span></span><input value={requiredValues[arg.name] ?? ""} onChange={(event) => setRequiredValues((current) => ({ ...current, [arg.name]: event.target.value }))} placeholder={arg.help ?? `输入 ${arg.name}`} className="min-h-11 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50" autoFocus={selectedOpenCLI.requiredArgs[0] === arg.name} /></label>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t p-4"><button type="button" className="min-h-10 rounded-md border px-4 text-xs" onClick={() => setSelectedOpenCLI(null)}>取消</button><button type="submit" className="min-h-10 rounded-md bg-primary px-4 text-xs text-primary-foreground disabled:opacity-50" disabled={missingRequired.length > 0}>添加数据源</button></div>
        </form>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 px-4 pt-[7vh]" onClick={close} onKeyDown={(event) => { if (event.key === "Escape") close() }} role="dialog" aria-modal="true" aria-label="节点选择器">
      <div className="flex max-h-[82vh] w-[46rem] max-w-full flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl" onClick={(event) => event.stopPropagation()}>
        {aiMode ? (
          <div className="p-5">
            <button type="button" onClick={() => setAiMode(false)} className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回开始</button>
            <div className="mb-3 flex items-center gap-2"><Sparkles className="size-4 text-primary" /><span className="text-sm font-medium">AI 生成工作流</span></div>
            <textarea ref={aiRef} value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void generate(aiPrompt) } }} placeholder="描述你想要的流程…" className="min-h-28 w-full resize-none rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/50" disabled={loading} />
            <div className="mt-3 grid gap-1">{AI_EXAMPLES.map((example) => <button key={example} type="button" onClick={() => void generate(example)} className="truncate rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground">{example}</button>)}</div>
            <div className="mt-4 flex justify-end"><button type="button" onClick={() => void generate(aiPrompt)} disabled={loading || !aiPrompt.trim()} className="flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-40">{loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}生成</button></div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b px-4 pt-2" role="tablist" aria-label="节点选择类型">
              {TAB_META.map((tab) => (
                <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => { setActiveTab(tab.id); setQuery(""); requestAnimationFrame(() => inputRef.current?.focus()) }} className={cn("min-h-12 border-b-2 px-4 text-sm font-medium transition-colors", activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{tab.label}</button>
              ))}
              <button type="button" onClick={close} className="ml-auto rounded-md px-2 py-1 font-mono text-[10px] text-muted-foreground hover:bg-accent">ESC</button>
            </div>

            {activeTab !== "start" ? <div className="border-b p-4">
              <label className="flex min-h-12 items-center gap-3 rounded-lg border bg-background px-4 focus-within:ring-2 focus-within:ring-ring/50">
                <Search className="size-5 text-muted-foreground" />
                <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing) return; if (activeTab === "nodes") { if (firstNode) addCatalogOperator(firstNode); else if (firstPrimitive) addPrimitive(firstPrimitive); else if (firstAuxiliary) addOperator(firstAuxiliary) } else if (toolFilter !== "plugin" && filteredOpenCLINodes[0]) addOpenCLIAdapter(filteredOpenCLINodes[0]); else if (pluginTools[0]) addCatalogOperator(pluginTools[0]) }} placeholder={activeTab === "nodes" ? "搜索节点、Agent、逻辑或数据能力" : "搜索工具、插件或 OpenCLI 数据源"} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" aria-label="搜索节点选择器" />
              </label>
              {activeTab === "tools" ? (
                <div className="mt-3 flex items-center gap-2" aria-label="工具筛选">
                  {([['all', '全部'], ['opencli', 'OpenCLI'], ['plugin', '插件能力']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={toolFilter === id} onClick={() => setToolFilter(id)} className={cn("rounded-md px-3 py-1.5 text-xs", toolFilter === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
                </div>
              ) : null}
            </div> : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {activeTab === "nodes" ? (
                <>
                  {inNodeNetwork ? <div className="mb-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">L{nodeDepth} · {nodeLayer.label}</span> · 当前只展示本层可用执行节点</div> : null}
                  {!inNodeNetwork && (opencliLoading || commonOpenCLINodes.length > 0) ? <section><SectionLabel count={commonOpenCLINodes.length}>常用网站数据源</SectionLabel>{opencliLoading ? <div className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取常用网站数据源</div> : commonOpenCLINodes.map((item) => { const presentation = openCLIAdapterNodePresentation(item); return <PickerRow key={item.id} icon={Globe} label={presentation.label} description={presentation.description} onClick={() => addOpenCLIAdapter(item)} trailing={<span className="rounded border border-success/40 px-1.5 py-0.5 font-mono text-[9px] text-success">实时</span>} /> })}</section> : null}
                  {nodeCatalogGroups.map(([category, items]) => (
                    <section key={category}><SectionLabel count={items.length}>{CATEGORY_LABELS[category] ?? category}</SectionLabel>{items.map((item) => { const Icon = getIcon(item.icon); const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language); const provenance = workflowCatalogPluginProvenance(item); const locked = workflowCatalogItemLocked(item); return <PickerRow key={item.id} icon={Icon} label={text.label} description={provenance ? `${provenance.providerKey} · ${provenance.version}` : text.description} disabled={locked} onClick={() => addCatalogOperator(item)} trailing={<span className={cn("rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase", runtimeStatusTone(item.runtimeCapability?.status))}>{runtimeStatusLabel(item.runtimeCapability?.status)}</span>} /> })}</section>
                  ))}
                  {primitiveGroups.map((group) => <section key={group.category}><SectionLabel count={group.items.length}>{group.label}</SectionLabel>{group.items.map((item) => { const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language); return <PickerRow key={item.id} icon={getIcon(item.icon)} label={text.label} description={text.description} onClick={() => addPrimitive(item)} /> })}</section>)}
                  {auxiliaryOperators.length ? <section><SectionLabel count={auxiliaryOperators.length}>注释与辅助</SectionLabel>{auxiliaryOperators.map((item) => <PickerRow key={`${item.nodeType}-${item.shape ?? item.label}`} icon={getIcon(item.icon)} label={item.label} description={item.description} onClick={() => addOperator(item)} />)}</section> : null}
                  {nodeCatalogGroups.length === 0 && primitiveGroups.length === 0 && auxiliaryOperators.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">没有匹配的节点</p> : null}
                </>
              ) : null}

              {activeTab === "tools" ? (
                <>
                  {toolFilter !== "plugin" ? <section><SectionLabel count={filteredOpenCLINodes.length}>OpenCLI 实时数据源</SectionLabel>{opencliLoading ? <div className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在读取本机 OpenCLI 目录</div> : filteredOpenCLINodes.map((item) => { const presentation = openCLIAdapterNodePresentation(item); return <PickerRow key={item.id} icon={Globe} label={presentation.label} description={presentation.description} onClick={() => addOpenCLIAdapter(item)} trailing={<span className="rounded border border-success/40 px-1.5 py-0.5 font-mono text-[9px] text-success">{item.requiredArgs.length ? `${item.requiredArgs.length} 参数` : "实时"}</span>} /> })}</section> : null}
                  {toolFilter !== "opencli" ? <section><SectionLabel count={pluginTools.length}>插件与后端工具</SectionLabel>{pluginTools.map((item) => { const text = localizeNodeText(item.id, { label: item.label, description: item.description }, language); const provenance = workflowCatalogPluginProvenance(item); return <PickerRow key={`tool-${item.id}`} icon={getIcon(item.icon)} label={text.label} description={provenance ? `${provenance.providerKey} · ${provenance.version}` : text.description} disabled={workflowCatalogItemLocked(item)} onClick={() => addCatalogOperator(item)} /> })}</section> : null}
                  {!opencliLoading && ((toolFilter === "opencli" && filteredOpenCLINodes.length === 0) || (toolFilter === "plugin" && pluginTools.length === 0) || (toolFilter === "all" && filteredOpenCLINodes.length === 0 && pluginTools.length === 0)) ? <p className="py-12 text-center text-sm text-muted-foreground">没有匹配的工具</p> : null}
                </>
              ) : null}

              {activeTab === "start" ? (
                <section><SectionLabel>创建与导入</SectionLabel>
                  <PickerRow icon={Sparkles} label="AI 生成工作流" description="用自然语言生成可编辑的工作流草稿" onClick={() => setAiMode(true)} />
                  <PickerRow icon={FileUp} label="导入应用" description="支持 Dify、n8n、JSON、YAML 与 Mermaid" onClick={() => { onClose(); onImportApp?.() }} />
                  <PickerRow icon={Boxes} label="从节点开始" description="进入节点目录，手动搭建业务流程" onClick={() => { setActiveTab("nodes"); setQuery("") }} />
                  <SectionLabel>画布操作</SectionLabel>
                  <PickerRow icon={LayoutGrid} label="自动整理画布" description="按纵向业务流重新排布当前节点" onClick={() => { void autoLayout("TB", "elk", true); onMessage?.("已应用自动布局"); onClose() }} />
                  <PickerRow icon={Save} label="保存当前草稿" description="将当前工作流保存到本地状态" onClick={() => { save(); onMessage?.("已保存到本地"); onClose() }} />
                  <PickerRow icon={RotateCcw} label="恢复示例工作流" description="清空当前改动并恢复默认示例" onClick={() => { reset(); onMessage?.("已恢复示例工作流"); onClose() }} />
                </section>
              ) : null}
            </div>

            {activeTab === "tools" ? <a href="/plugins" className="flex min-h-12 items-center justify-between border-t px-5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"><span>在插件中心查找更多</span><ChevronRight className="size-4" /></a> : null}
            <div className="flex min-h-10 items-center justify-between border-t px-4 font-mono text-[10px] text-muted-foreground"><span>{activeTab === "start" ? "选择一种开始方式" : "输入搜索 · Enter 添加"}</span><span>Esc 关闭</span></div>
          </>
        )}
      </div>
    </div>
  )
}
